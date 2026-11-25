/**
 * LensOverlay — Google Lens-style interactive text & number highlighting on the image.
 * Displays OCR bounding boxes directly over the captured image; tap any highlight
 * to inspect/copy, or copy/save all extracted text & numbers.
 */
import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ConfidenceBadge } from '@/components/formlens/ConfidenceBadge';
import { Copy, Check, Save, RotateCcw, Sparkles } from 'lucide-react';
import { classifyBlockLanguage, type BlockLanguage, type OcrLine } from '@/workers/tesseract-engine';

const LANG_STYLE: Record<BlockLanguage, { label: string; idle: string; selected: string; badge: string }> = {
  en: {
    label: 'EN',
    idle: 'bg-blue-400/15 border border-blue-400/80 hover:bg-blue-400/30',
    selected: 'bg-blue-500/40 border-2 border-blue-400 ring-2 ring-blue-300/60',
    badge: 'bg-blue-600 text-white',
  },
  kn: {
    label: 'ಕನ್ನಡ',
    idle: 'bg-amber-400/15 border border-amber-400/80 hover:bg-amber-400/30',
    selected: 'bg-amber-500/40 border-2 border-amber-400 ring-2 ring-amber-300/60',
    badge: 'bg-amber-600 text-white',
  },
  mixed: {
    label: 'MIX',
    idle: 'bg-purple-400/15 border border-purple-400/80 hover:bg-purple-400/30',
    selected: 'bg-purple-500/40 border-2 border-purple-400 ring-2 ring-purple-300/60',
    badge: 'bg-purple-600 text-white',
  },
  number: {
    label: '123',
    idle: 'bg-emerald-400/15 border border-emerald-400/80 hover:bg-emerald-400/30',
    selected: 'bg-emerald-500/40 border-2 border-emerald-400 ring-2 ring-emerald-300/60',
    badge: 'bg-emerald-600 text-white',
  },
};

interface Props {
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  lines: OcrLine[];
  fullText: string;
  onSaveAndReview: () => void;
  onRetake: () => void;
  saving?: boolean;
}

export function LensOverlay({
  imageDataUrl,
  imageWidth,
  imageHeight,
  lines,
  fullText,
  onSaveAndReview,
  onRetake,
  saving = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgBox, setImgBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [langFilter, setLangFilter] = useState<'all' | BlockLanguage>('all');

  const lineLangs = useMemo(
    () => lines.map((l) => l.language ?? classifyBlockLanguage(l.text)),
    [lines],
  );

  const visibleIndices = useMemo(
    () =>
      lines
        .map((_, idx) => idx)
        .filter((idx) => langFilter === 'all' || lineLangs[idx] === langFilter),
    [lines, lineLangs, langFilter],
  );

  const updateImageBounds = useCallback(() => {
    const container = containerRef.current;
    if (!container || imageWidth === 0 || imageHeight === 0) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw === 0 || ch === 0) return;

    const imgAspect = imageWidth / imageHeight;
    const boxAspect = cw / ch;
    let width: number;
    let height: number;
    if (imgAspect > boxAspect) {
      width = cw;
      height = cw / imgAspect;
    } else {
      height = ch;
      width = ch * imgAspect;
    }
    setImgBox({
      left: (cw - width) / 2,
      top: (ch - height) / 2,
      width,
      height,
    });
  }, [imageWidth, imageHeight]);

  useEffect(() => {
    updateImageBounds();
    window.addEventListener('resize', updateImageBounds);
    return () => window.removeEventListener('resize', updateImageBounds);
  }, [updateImageBounds]);

  const toggleSelect = (idx: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIndices.size === lines.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(lines.map((_, i) => i)));
    }
  };

  const activeText = useMemo(() => {
    if (selectedIndices.size > 0) {
      return Array.from(selectedIndices)
        .sort((a, b) => a - b)
        .map((i) => lines[i]?.text ?? '')
        .filter(Boolean)
        .join('\n');
    }
    if (langFilter !== 'all') {
      return visibleIndices
        .map((i) => lines[i]?.text ?? '')
        .filter(Boolean)
        .join('\n');
    }
    return fullText;
  }, [selectedIndices, lines, fullText, langFilter, visibleIndices]);

  // Quick-extract numbers, phones, dates found anywhere in the image
  const detectedEntities = useMemo(() => {
    const text = fullText;
    const items: { label: string; value: string }[] = [];
    const seen = new Set<string>();

    const phones = text.match(/(?:\+91[\s-]?)?[6-9]\d{9}/g) ?? [];
    for (const p of phones) {
      const clean = p.replace(/[^\d]/g, '').slice(-10);
      if (!seen.has(clean)) {
        seen.add(clean);
        items.push({ label: 'Phone', value: clean });
      }
    }

    const dates = text.match(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g) ?? [];
    for (const d of dates) {
      if (!seen.has(d)) {
        seen.add(d);
        items.push({ label: 'Date', value: d });
      }
    }

    const numbers = text.match(/\b\d{4,}\b/g) ?? [];
    for (const n of numbers) {
      if (!seen.has(n)) {
        seen.add(n);
        items.push({ label: n.length === 6 ? 'Pincode/No' : 'Number', value: n });
      }
    }

    return items.slice(0, 8);
  }, [fullText]);

  const copyText = async (value: string, key: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const avgConfidence =
    lines.length > 0
      ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length
      : 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-black/90 text-white text-xs shrink-0">
        <span className="flex items-center gap-1.5 font-medium">
          <Sparkles className="h-3.5 w-3.5 text-blue-400" />
          Tap highlighted text on image ({lines.length} found)
        </span>
        <div className="flex items-center gap-2">
          {lines.length > 0 && (
            <button
              onClick={selectAll}
              className="rounded bg-white/15 px-2 py-1 text-xs hover:bg-white/25"
            >
              {selectedIndices.size === lines.length ? 'Clear' : 'Select All'}
            </button>
          )}
          <button
            onClick={onRetake}
            className="rounded bg-white/15 px-2 py-1 text-xs hover:bg-white/25 flex items-center gap-1"
          >
            <RotateCcw className="h-3 w-3" />
            New
          </button>
        </div>
      </div>

      {/* Image with interactive text highlights */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 overflow-hidden bg-black"
        onClick={() => {
          if (selectedIndices.size > 0) setSelectedIndices(new Set());
        }}
      >
        <img
          src={imageDataUrl}
          alt="Scanned"
          onLoad={updateImageBounds}
          className="h-full w-full object-contain"
          draggable={false}
        />

        {imgBox && (
          <div
            className="absolute"
            style={{
              left: imgBox.left,
              top: imgBox.top,
              width: imgBox.width,
              height: imgBox.height,
            }}
          >
            {visibleIndices.map((i) => {
              const line = lines[i]!;
              const lang = lineLangs[i] ?? 'en';
              const style = LANG_STYLE[lang];
              const xPct = (line.bbox.x0 / imageWidth) * 100;
              const yPct = (line.bbox.y0 / imageHeight) * 100;
              const wPct = ((line.bbox.x1 - line.bbox.x0) / imageWidth) * 100;
              const hPct = ((line.bbox.y1 - line.bbox.y0) / imageHeight) * 100;
              const isSelected = selectedIndices.has(i);

              return (
                <button
                  key={i}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(i);
                  }}
                  title={`[${style.label}] ${line.text}`}
                  className={`group absolute rounded-sm transition-all cursor-pointer ${
                    isSelected ? style.selected : style.idle
                  }`}
                  style={{
                    left: `${xPct}%`,
                    top: `${yPct}%`,
                    width: `${Math.max(wPct, 1)}%`,
                    height: `${Math.max(hPct, 1.5)}%`,
                  }}
                >
                  <span
                    className={`pointer-events-none absolute -top-4 left-0 rounded px-1 text-[9px] font-bold leading-tight ${style.badge} ${
                      isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {style.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom extracted text drawer */}
      <div className="bg-background border-t border-border rounded-t-2xl p-4 space-y-3 max-h-[42vh] overflow-y-auto shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">
            {selectedIndices.size > 0
              ? `Selected (${selectedIndices.size} ${selectedIndices.size === 1 ? 'line' : 'lines'})`
              : 'Extracted Text'}
          </div>
          {lines.length > 0 && <ConfidenceBadge confidence={avgConfidence} />}
        </div>

        {/* Language filter pills (auto-detected per block) */}
        {lines.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All (${lines.length})` },
                { id: 'en', label: `English (${lineLangs.filter((l) => l === 'en').length})` },
                { id: 'kn', label: `ಕನ್ನಡ (${lineLangs.filter((l) => l === 'kn').length})` },
                { id: 'mixed', label: `Mixed (${lineLangs.filter((l) => l === 'mixed').length})` },
                { id: 'number', label: `Numbers (${lineLangs.filter((l) => l === 'number').length})` },
              ] as const
            )
              .filter((p) => p.id === 'all' || !p.label.endsWith('(0)'))
              .map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setLangFilter(pill.id)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition-colors ${
                    langFilter === pill.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
          </div>
        )}

        {/* Detected quick-copy chips for phones / dates / numbers */}
        {detectedEntities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {detectedEntities.map((ent) => (
              <button
                key={ent.value}
                type="button"
                onClick={() => void copyText(ent.value, `ent-${ent.value}`)}
                className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10"
              >
                <span className="opacity-70">{ent.label}:</span>
                <span>{ent.value}</span>
                {copiedKey === `ent-${ent.value}` ? (
                  <Check className="h-3 w-3 text-green-600" />
                ) : (
                  <Copy className="h-3 w-3 opacity-60" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Extracted text box */}
        {activeText ? (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap break-words max-h-28 overflow-y-auto select-text">
            {activeText}
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground text-center">
            No readable text detected in this image. Try cropping closer or retaking in brighter light.
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={!activeText}
            onClick={() => void copyText(activeText, 'main')}
          >
            {copiedKey === 'main' ? (
              <><Check className="mr-1.5 h-4 w-4 text-green-600" /> Copied</>
            ) : (
              <><Copy className="mr-1.5 h-4 w-4" /> {selectedIndices.size > 0 ? 'Copy Selected' : 'Copy All'}</>
            )}
          </Button>
          <Button
            className="flex-1"
            disabled={lines.length === 0 || saving}
            onClick={onSaveAndReview}
          >
            <Save className="mr-1.5 h-4 w-4" />
            {saving ? 'Saving…' : 'Save & Edit'}
          </Button>
        </div>
      </div>
    </div>
  );
}

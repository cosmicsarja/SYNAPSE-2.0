/**
 * JsonToPdfDialog — lets users edit PDF content visually (fields/title/notes)
 * or as raw JSON, preview the exact rendered PDF pages, and export to PDF.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  FileJson,
  FileText,
  RotateCcw,
  Sparkles,
  Check,
  AlertCircle,
  Copy,
  Eye,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { FormField, SavedForm } from '@/db/schema';
import {
  downloadEditableJson,
  exportJsonToPdf,
  formToEditableJson,
  parseEditableJson,
  renderPdfPreviewDataUrls,
  type EditableFormJson,
  type PdfRenderMode,
} from '@/lib/formlens/jsonPdf';

type EditorTab = 'visual' | 'json' | 'preview';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: SavedForm;
  fields: FormField[];
  initialTab?: EditorTab;
  onApplyJsonValues?: (updates: Array<{ key: string; value: string }>) => Promise<void> | void;
}

export function JsonToPdfDialog({
  open,
  onOpenChange,
  form,
  fields,
  initialTab = 'visual',
  onApplyJsonValues,
}: Props) {
  const initialJson = useMemo(
    () => JSON.stringify(formToEditableJson(form, fields), null, 2),
    [form, fields],
  );

  const [tab, setTab] = useState<EditorTab>(initialTab);
  const [rawJson, setRawJson] = useState(initialJson);
  const [applied, setApplied] = useState(false);
  const [copiedKv, setCopiedKv] = useState(false);
  const [pdfMode, setPdfMode] = useState<PdfRenderMode>('layout');
  const [applicantOnly, setApplicantOnly] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  const hasPhoto = Boolean(form.imageDataUrl ?? form.thumbnailDataUrl);

  useEffect(() => {
    if (open) {
      setRawJson(initialJson);
      setTab(initialTab);
      setApplied(false);
    }
  }, [open, initialJson, initialTab]);

  const parsed = useMemo(() => parseEditableJson(rawJson), [rawJson]);
  const hasBoxes = parsed.ok && parsed.data.fields.some((f) => Boolean(f.normBbox));

  // Render live PDF preview whenever the user switches to Preview tab or changes PDF style
  useEffect(() => {
    if (!open || tab !== 'preview' || !parsed.ok) return;
    let cancelled = false;
    setPreviewLoading(true);
    void renderPdfPreviewDataUrls(parsed.data, {
      mode: hasBoxes ? pdfMode : 'table',
      backgroundImageUrl: form.imageDataUrl ?? form.thumbnailDataUrl,
      applicantOnly,
    })
      .then((urls) => {
        if (!cancelled) setPreviewUrls(urls);
      })
      .catch(() => {
        if (!cancelled) setPreviewUrls([]);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, tab, parsed, pdfMode, applicantOnly, hasBoxes, form.imageDataUrl, form.thumbnailDataUrl]);

  const updateData = (updater: (prev: EditableFormJson) => EditableFormJson) => {
    if (!parsed.ok) return;
    const next = updater(parsed.data);
    setRawJson(JSON.stringify(next, null, 2));
  };

  const handleFormat = () => {
    if (!parsed.ok) return;
    setRawJson(JSON.stringify(parsed.data, null, 2));
  };

  const handleReset = () => {
    setRawJson(initialJson);
    setApplied(false);
  };

  const handleDownloadPdf = async () => {
    if (!parsed.ok) return;
    setGenerating(true);
    try {
      await exportJsonToPdf(parsed.data, `formlens-${form.id ?? 'form'}.pdf`, {
        mode: hasBoxes ? pdfMode : 'table',
        backgroundImageUrl: form.imageDataUrl ?? form.thumbnailDataUrl,
        applicantOnly,
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadJson = () => {
    downloadEditableJson(rawJson, `formlens-${form.id ?? 'form'}.json`);
  };

  const handleCopyKeyValue = async () => {
    if (!parsed.ok) return;
    const text = parsed.data.fields
      .map((f) => `${f.label || f.key} : ${f.value}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
    setCopiedKv(true);
    setTimeout(() => setCopiedKv(false), 2000);
  };

  const handleApplyToFields = async () => {
    if (!parsed.ok || !onApplyJsonValues) return;
    await onApplyJsonValues(
      parsed.data.fields.map((f) => ({ key: f.key, value: f.value })),
    );
    setApplied(true);
    setTimeout(() => setApplied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary" />
            Edit &amp; Preview PDF (JSON → PDF)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Edit any field or JSON before exporting, preview the exact PDF page, and download.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs + PDF layout mode selector */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex rounded-md border bg-muted/40 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setTab('visual')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium ${
                tab === 'visual' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
              }`}
            >
              <Pencil className="h-3 w-3" />
              Edit PDF
            </button>
            <button
              type="button"
              onClick={() => setTab('json')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium ${
                tab === 'json' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
              }`}
            >
              <FileJson className="h-3 w-3" />
              Edit JSON
            </button>
            <button
              type="button"
              onClick={() => setTab('preview')}
              disabled={!parsed.ok}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-medium disabled:opacity-50 ${
                tab === 'preview' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'
              }`}
            >
              <Eye className="h-3 w-3" />
              Preview PDF
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              variant={pdfMode === 'layout' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs px-2"
              disabled={!hasBoxes}
              onClick={() => setPdfMode('layout')}
            >
              Match Image
            </Button>
            {hasPhoto && (
              <Button
                type="button"
                variant={pdfMode === 'overlay' ? 'default' : 'outline'}
                size="sm"
                className="h-7 text-xs px-2"
                disabled={!hasBoxes}
                onClick={() => setPdfMode('overlay')}
              >
                Over Photo
              </Button>
            )}
            <Button
              type="button"
              variant={pdfMode === 'table' || !hasBoxes ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => setPdfMode('table')}
            >
              Table
            </Button>
            {(pdfMode === 'table' || !hasBoxes) && (
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground ml-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={applicantOnly}
                  onChange={(e) => setApplicantOnly(e.target.checked)}
                  className="rounded border-border"
                />
                Applicant only
              </label>
            )}
          </div>
        </div>

        {/* Validation status + toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            {parsed.ok ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                Valid · {parsed.data.fields.length} fields
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-0.5 font-medium text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {parsed.error}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {tab === 'json' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                disabled={!parsed.ok}
                onClick={handleFormat}
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                Format
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleReset}
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset
            </Button>
          </div>
        </div>

        {/* Tab 1: Visual PDF Field Editor */}
        {tab === 'visual' && parsed.ok && (
          <div className="flex-1 min-h-[280px] max-h-[48vh] overflow-y-auto space-y-3 pr-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-md border bg-muted/20 p-2.5">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">PDF Title</label>
                <Input
                  value={parsed.data.title}
                  onChange={(e) => updateData((d) => ({ ...d, title: e.target.value }))}
                  className="h-8 text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Template</label>
                <Input
                  value={parsed.data.template}
                  onChange={(e) => updateData((d) => ({ ...d, template: e.target.value }))}
                  className="h-8 text-xs mt-0.5"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">Date</label>
                <Input
                  value={parsed.data.date}
                  onChange={(e) => updateData((d) => ({ ...d, date: e.target.value }))}
                  className="h-8 text-xs mt-0.5"
                />
              </div>
            </div>

            <div className="space-y-2">
              {parsed.data.fields.map((f, idx) => (
                <div
                  key={`${f.key}-${idx}`}
                  className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr_auto] gap-2 items-center rounded-md border p-2"
                >
                  <Input
                    value={f.label}
                    onChange={(e) =>
                      updateData((d) => ({
                        ...d,
                        fields: d.fields.map((it, i) =>
                          i === idx ? { ...it, label: e.target.value } : it,
                        ),
                      }))
                    }
                    placeholder="Field label"
                    className="h-8 text-xs font-medium"
                  />
                  <Input
                    value={f.value}
                    onChange={(e) =>
                      updateData((d) => ({
                        ...d,
                        fields: d.fields.map((it, i) =>
                          i === idx ? { ...it, value: e.target.value } : it,
                        ),
                      }))
                    }
                    placeholder="Value"
                    className="h-8 text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      updateData((d) => ({
                        ...d,
                        fields: d.fields.filter((_, i) => i !== idx),
                      }))
                    }
                    aria-label="Remove field"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  updateData((d) => ({
                    ...d,
                    fields: [
                      ...d.fields,
                      {
                        key: `custom_${d.fields.length + 1}`,
                        label: `Field ${d.fields.length + 1}`,
                        value: '',
                      },
                    ],
                  }))
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Field
              </Button>
            </div>

            <div>
              <label className="text-[11px] font-medium text-muted-foreground">Notes (Table PDF)</label>
              <Input
                value={parsed.data.notes ?? ''}
                onChange={(e) => updateData((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Optional notes at bottom of PDF..."
                className="h-8 text-xs mt-0.5"
              />
            </div>
          </div>
        )}

        {/* Tab 2: Raw JSON Editor */}
        {tab === 'json' && (
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            spellCheck={false}
            aria-label="Editable JSON"
            className="w-full min-h-[280px] flex-1 rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary"
          />
        )}

        {/* Tab 3: Live PDF Preview */}
        {tab === 'preview' && (
          <div className="flex-1 min-h-[280px] max-h-[48vh] overflow-y-auto rounded-md border bg-muted/30 p-3 flex flex-col items-center gap-3">
            {previewLoading ? (
              <div className="text-xs text-muted-foreground py-12">Rendering PDF preview…</div>
            ) : previewUrls.length === 0 ? (
              <div className="text-xs text-muted-foreground py-12">Fix JSON errors to preview PDF.</div>
            ) : (
              previewUrls.map((url, idx) => (
                <img
                  key={idx}
                  src={url}
                  alt={`PDF page ${idx + 1} preview`}
                  className="w-full max-w-md rounded border bg-white shadow-sm"
                />
              ))
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadJson}
            >
              <FileJson className="h-4 w-4 mr-1.5" />
              Download .json
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!parsed.ok}
              onClick={() => void handleCopyKeyValue()}
            >
              <Copy className="h-4 w-4 mr-1.5" />
              {copiedKv ? 'Copied ✓' : 'Copy Key : Value'}
            </Button>
            {onApplyJsonValues && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!parsed.ok}
                onClick={() => void handleApplyToFields()}
              >
                {applied ? 'Applied ✓' : 'Sync to Fields'}
              </Button>
            )}
          </div>

          <Button
            type="button"
            size="sm"
            disabled={!parsed.ok || generating}
            onClick={() => void handleDownloadPdf()}
          >
            <FileText className="h-4 w-4 mr-1.5" />
            {generating ? 'Generating PDF…' : 'Download PDF'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Interactive bounding-box review overlay for /review/$id:
 * - Confidence color-coding from CONFIDENCE_THRESHOLDS (green >= 85%, amber 60-85%, red < 60%)
 * - Box numbers, tap-to-select synced with field list
 * - Zoom/pan for phones, Add Box (drag rectangle), Delete box, Re-run single-box OCR
 * - Show/hide boxes and Low-confidence-only toggles
 */
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CONFIDENCE_THRESHOLDS } from '@/config/ocrModels';
import type { FormField } from '@/db/schema';
import { Eye, EyeOff, Plus, Trash2, RefreshCw, ZoomIn, ZoomOut, AlertTriangle } from 'lucide-react';

interface Props {
  imageDataUrl: string;
  fields: FormField[];
  selectedFieldId: number | null;
  onSelectField: (fieldId: number) => void;
  onAddBox: (normBbox: [number, number, number, number]) => Promise<void>;
  onDeleteBox: (fieldId: number) => Promise<void>;
  onRerunBox: (field: FormField) => Promise<void>;
  rerunningId: number | null;
}

export function getConfidenceColor(conf: number): { stroke: string; fill: string; badge: string } {
  if (conf >= CONFIDENCE_THRESHOLDS.high) {
    return { stroke: '#16a34a', fill: 'rgba(22,163,74,0.16)', badge: 'bg-green-600 text-white' };
  }
  if (conf >= CONFIDENCE_THRESHOLDS.medium) {
    return { stroke: '#d97706', fill: 'rgba(217,119,6,0.18)', badge: 'bg-amber-600 text-white' };
  }
  return { stroke: '#dc2626', fill: 'rgba(220,38,38,0.22)', badge: 'bg-red-600 text-white' };
}

export function BoxReviewOverlay({
  imageDataUrl,
  fields,
  selectedFieldId,
  onSelectField,
  onAddBox,
  onDeleteBox,
  onRerunBox,
  rerunningId,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showBoxes, setShowBoxes] = useState(true);
  const [lowConfOnly, setLowConfOnly] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ nx: number; ny: number } | null>(null);
  const [dragCur, setDragCur] = useState<{ nx: number; ny: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const visibleFields = fields.filter(
    (f) => f.normBbox && (!lowConfOnly || f.confidence < CONFIDENCE_THRESHOLDS.medium),
  );

  const toNorm = (clientX: number, clientY: number): { nx: number; ny: number } => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { nx: 0, ny: 0 };
    return {
      nx: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      ny: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (addMode) {
      const p = toNorm(e.clientX, e.clientY);
      setDragStart(p);
      setDragCur(p);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } else if (zoom > 1) {
      panStartRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (addMode && dragStart) {
      setDragCur(toNorm(e.clientX, e.clientY));
    } else if (panStartRef.current) {
      setPan({
        x: panStartRef.current.px + (e.clientX - panStartRef.current.x),
        y: panStartRef.current.py + (e.clientY - panStartRef.current.y),
      });
    }
  };

  const handlePointerUp = () => {
    panStartRef.current = null;
    if (addMode && dragStart && dragCur) {
      const x0 = Math.min(dragStart.nx, dragCur.nx);
      const y0 = Math.min(dragStart.ny, dragCur.ny);
      const x1 = Math.max(dragStart.nx, dragCur.nx);
      const y1 = Math.max(dragStart.ny, dragCur.ny);
      setDragStart(null);
      setDragCur(null);
      setAddMode(false);
      if (x1 - x0 >= 0.02 && y1 - y0 >= 0.015) {
        void onAddBox([x0, y0, x1, y1]);
      }
    }
  };

  const selectedField = fields.find((f) => f.id === selectedFieldId) ?? null;

  return (
    <div className="border-b bg-muted/20">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 px-3 py-2 border-b bg-background">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={showBoxes ? 'secondary' : 'outline'}
            className="h-7 text-xs px-2"
            onClick={() => setShowBoxes((v) => !v)}
          >
            {showBoxes ? <Eye className="h-3.5 w-3.5 mr-1" /> : <EyeOff className="h-3.5 w-3.5 mr-1" />}
            Boxes
          </Button>
          <Button
            size="sm"
            variant={lowConfOnly ? 'default' : 'outline'}
            className="h-7 text-xs px-2"
            onClick={() => setLowConfOnly((v) => !v)}
          >
            <AlertTriangle className="h-3.5 w-3.5 mr-1" />
            Low &lt;{Math.round(CONFIDENCE_THRESHOLDS.medium * 100)}%
          </Button>
          <Button
            size="sm"
            variant={addMode ? 'default' : 'outline'}
            className="h-7 text-xs px-2"
            onClick={() => setAddMode((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            {addMode ? 'Drag Box…' : 'Add Box'}
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
            onClick={() => {
              const next = Math.max(1, zoom - 0.5);
              setZoom(next);
              if (next === 1) setPan({ x: 0, y: 0 });
            }}
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-[11px] w-9 text-center font-mono">{zoom.toFixed(1)}x</span>
          <Button
            size="icon"
            variant="outline"
            className="h-7 w-7"
            onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Image + SVG box overlay */}
      <div className="relative overflow-hidden bg-black/95 flex items-center justify-center max-h-[38vh]">
        <div
          ref={containerRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          className={`relative inline-block select-none ${addMode ? 'cursor-crosshair' : zoom > 1 ? 'cursor-grab' : ''}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
            touchAction: addMode || zoom > 1 ? 'none' : 'auto',
          }}
        >
          <img
            src={imageDataUrl}
            alt="Scanned form"
            className="max-h-[36vh] w-auto block object-contain"
            draggable={false}
          />

          {showBoxes && (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full pointer-events-none"
            >
              {visibleFields.map((field) => {
                const idx = fields.indexOf(field);
                const [x0, y0, x1, y1] = field.normBbox!;
                const colors = getConfidenceColor(field.confidence);
                const isSel = field.id === selectedFieldId;

                return (
                  <g
                    key={field.id ?? idx}
                    className="pointer-events-auto cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (field.id !== undefined) onSelectField(field.id);
                    }}
                  >
                    <rect
                      x={x0 * 100}
                      y={y0 * 100}
                      width={Math.max(1, (x1 - x0) * 100)}
                      height={Math.max(1.2, (y1 - y0) * 100)}
                      fill={colors.fill}
                      stroke={isSel ? '#2563eb' : colors.stroke}
                      strokeWidth={isSel ? 0.9 : 0.45}
                    />
                    <rect
                      x={x0 * 100}
                      y={Math.max(0, y0 * 100 - 3)}
                      width={3.5}
                      height={3}
                      fill={isSel ? '#2563eb' : colors.stroke}
                    />
                    <text
                      x={x0 * 100 + 0.6}
                      y={Math.max(2.2, y0 * 100 - 0.7)}
                      fontSize="2.3"
                      fill="#ffffff"
                      fontWeight="bold"
                    >
                      {idx + 1}
                    </text>
                  </g>
                );
              })}

              {dragStart && dragCur && (
                <rect
                  x={Math.min(dragStart.nx, dragCur.nx) * 100}
                  y={Math.min(dragStart.ny, dragCur.ny) * 100}
                  width={Math.abs(dragCur.nx - dragStart.nx) * 100}
                  height={Math.abs(dragCur.ny - dragStart.ny) * 100}
                  fill="rgba(37,99,235,0.2)"
                  stroke="#3b82f6"
                  strokeWidth={0.6}
                  strokeDasharray="1.5 1"
                />
              )}
            </svg>
          )}
        </div>
      </div>

      {/* Selected box quick actions */}
      {selectedField && (
        <div className="px-3 py-2 bg-background border-t flex items-center justify-between gap-2 text-xs">
          <div className="min-w-0">
            <span className="font-semibold">
              #{fields.indexOf(selectedField) + 1} {selectedField.labelEn}
            </span>
            <span className="ml-2 text-muted-foreground">
              {selectedField.script ? `Script: ${selectedField.script}` : ''}{' '}
              {selectedField.model ? `· ${selectedField.model}` : ''}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {selectedField.normBbox && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2"
                disabled={rerunningId === selectedField.id}
                onClick={() => void onRerunBox(selectedField)}
              >
                <RefreshCw className={`h-3 w-3 mr-1 ${rerunningId === selectedField.id ? 'animate-spin' : ''}`} />
                Re-OCR
              </Button>
            )}
            {selectedField.id !== undefined && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2 text-red-600 hover:text-red-700"
                onClick={() => void onDeleteBox(selectedField.id!)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

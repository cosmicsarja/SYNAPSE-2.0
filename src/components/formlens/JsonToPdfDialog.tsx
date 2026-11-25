/**
 * JsonToPdfDialog — lets users inspect/edit extracted OCR text in JSON format
 * and convert that edited JSON directly into a layout-matching Kannada + English PDF.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FileJson, FileText, RotateCcw, Sparkles, Check, AlertCircle } from 'lucide-react';
import type { FormField, SavedForm } from '@/db/schema';
import {
  downloadEditableJson,
  exportJsonToPdf,
  formToEditableJson,
  parseEditableJson,
  type PdfRenderMode,
} from '@/lib/formlens/jsonPdf';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: SavedForm;
  fields: FormField[];
  onApplyJsonValues?: (updates: Array<{ key: string; value: string }>) => Promise<void> | void;
}

export function JsonToPdfDialog({
  open,
  onOpenChange,
  form,
  fields,
  onApplyJsonValues,
}: Props) {
  const initialJson = useMemo(
    () => JSON.stringify(formToEditableJson(form, fields), null, 2),
    [form, fields],
  );

  const [rawJson, setRawJson] = useState(initialJson);
  const [applied, setApplied] = useState(false);
  const [pdfMode, setPdfMode] = useState<PdfRenderMode>('layout');
  const [generating, setGenerating] = useState(false);

  const hasPhoto = Boolean(form.imageDataUrl ?? form.thumbnailDataUrl);

  useEffect(() => {
    if (open) {
      setRawJson(initialJson);
      setApplied(false);
    }
  }, [open, initialJson]);

  const parsed = useMemo(() => parseEditableJson(rawJson), [rawJson]);
  const hasBoxes = parsed.ok && parsed.data.fields.some((f) => Boolean(f.normBbox));

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
      });
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadJson = () => {
    downloadEditableJson(rawJson, `formlens-${form.id ?? 'form'}.json`);
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
            <FileJson className="h-4 w-4 text-primary" />
            Editable JSON → PDF
          </DialogTitle>
          <DialogDescription className="text-xs">
            Edit the extracted text in JSON format, then convert it into a PDF matching the original image layout (or as a table).
          </DialogDescription>
        </DialogHeader>

        {/* PDF layout mode selector */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">PDF Style:</span>
          <Button
            type="button"
            variant={pdfMode === 'layout' ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            disabled={!hasBoxes}
            onClick={() => setPdfMode('layout')}
          >
            Match Image Layout
          </Button>
          {hasPhoto && (
            <Button
              type="button"
              variant={pdfMode === 'overlay' ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs"
              disabled={!hasBoxes}
              onClick={() => setPdfMode('overlay')}
            >
              Over Original Photo
            </Button>
          )}
          <Button
            type="button"
            variant={pdfMode === 'table' || !hasBoxes ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs"
            onClick={() => setPdfMode('table')}
          >
            Table
          </Button>
        </div>

        {/* Validation status + toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs">
            {parsed.ok ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-medium text-emerald-700 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                Valid JSON · {parsed.data.fields.length} fields
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2.5 py-0.5 font-medium text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {parsed.error}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
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

        {/* Editable JSON textarea */}
        <textarea
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
          spellCheck={false}
          aria-label="Editable JSON"
          className="w-full min-h-[280px] flex-1 rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary"
        />

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadJson}
            >
              <FileJson className="h-4 w-4 mr-1.5" />
              Download .json
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
            {generating ? 'Generating PDF…' : 'Convert JSON → PDF'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Review route — editable field-by-field OCR review with exports.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { FieldCard } from '@/components/formlens/FieldCard';
import { BoxReviewOverlay } from '@/components/formlens/BoxReviewOverlay';
import { BottomNav } from '@/components/formlens/BottomNav';
import { OfflineStatusBar } from '@/components/formlens/OfflineStatusBar';
import { ConfidenceBadge } from '@/components/formlens/ConfidenceBadge';
import { CONFIDENCE_THRESHOLDS } from '@/config/ocrModels';
import { useOcrWorker } from '@/hooks/formlens/useOcrWorker';
import { getFormWithFields, updateFormField, markFormReviewed, saveCorrection, db } from '@/db';
import type { SavedForm, FormField } from '@/db/schema';
import type { FieldType } from '@/config/model';
import { exportJson, exportCsv, exportPdf, exportAnnotatedPng } from '@/lib/formlens/exports';
import { JsonToPdfDialog } from '@/components/formlens/JsonToPdfDialog';
import { findFormNameEdgeCases } from '@/lib/formlens/nameValidation';
import { dataUrlToPngBlob } from '@/lib/formlens/corrections';
import { enqueueSyncForm } from '@/lib/formlens/syncQueue';
import { ChevronLeft, Download, FileJson } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export const Route = createFileRoute('/review/$id')({
  head: () => ({ meta: [{ title: 'Review – FormLens' }] }),
  component: ReviewPage,
});

async function extractNormCrop(
  imageSrc: string,
  normBbox: [number, number, number, number],
): Promise<{ imageData: ImageData; cropDataUrl: string }> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load form image'));
    img.src = imageSrc;
  });
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const sx = Math.max(0, Math.floor(normBbox[0] * w));
  const sy = Math.max(0, Math.floor(normBbox[1] * h));
  const sw = Math.max(4, Math.min(w - sx, Math.ceil((normBbox[2] - normBbox[0]) * w)));
  const sh = Math.max(4, Math.min(h - sy, Math.ceil((normBbox[3] - normBbox[1]) * h)));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return {
    imageData: ctx.getImageData(0, 0, sw, sh),
    cropDataUrl: canvas.toDataURL('image/jpeg', 0.78),
  };
}

function ReviewPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const formId = parseInt(id, 10);
  const { initialize, recognize } = useOcrWorker();

  const [form, setForm] = useState<SavedForm | null>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null);
  const [rerunningId, setRerunningId] = useState<number | null>(null);
  const [jsonDialogOpen, setJsonDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    getFormWithFields(formId).then((result) => {
      if (result) {
        setForm(result.form);
        setFields(result.fields);
      }
      setLoading(false);
    });
  }, [formId]);

  const handleValueChange = useCallback(async (fieldId: number, value: string) => {
    const targetField = fields.find((f) => f.id === fieldId);
    setFields((prev) => prev.map((f) => f.id === fieldId ? { ...f, textValue: value, wasEdited: true } : f));
    if (fieldId !== undefined) {
      await updateFormField(fieldId, value);
    }
    if (targetField) {
      const cropBlob = await dataUrlToPngBlob(targetField.cropDataUrl);
      await saveCorrection({
        formId,
        fieldName: targetField.fieldId || targetField.labelEn || `field_${fieldId}`,
        originalText: targetField.originalText,
        correctedText: value,
        confidence: targetField.confidence,
        ...(cropBlob ? { cropBlob } : {}),
        templateId: form?.templateId ?? 'auto-extract',
        timestamp: Date.now(),
      });
    }
  }, [fields, form?.templateId, formId]);

  const handleAccept = useCallback((fieldId: number) => {
    setAccepted((prev) => new Set([...prev, fieldId]));
  }, []);

  const handleAcceptAll = () => {
    setAccepted(new Set(fields.map((f) => f.id!).filter((id) => id !== undefined)));
  };

  const handleSelectField = useCallback((fieldId: number) => {
    setSelectedFieldId(fieldId);
    const el = cardRefs.current.get(fieldId);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  const handleRerunBox = useCallback(async (field: FormField) => {
    const imgSrc = form?.imageDataUrl ?? form?.thumbnailDataUrl;
    if (!imgSrc || !field.normBbox || field.id === undefined) return;
    setRerunningId(field.id);
    try {
      await initialize('paddle', 'eng+kan');
      const { imageData, cropDataUrl } = await extractNormCrop(imgSrc, field.normBbox);
      const res = await recognize({
        imageData,
        fieldType: (field.fieldType as FieldType) || 'text',
        fieldIndex: 0,
        totalFields: 1,
      });
      await db.formFields.update(field.id, {
        textValue: res.text,
        originalText: res.text,
        confidence: res.confidence,
        script: res.script,
        wasEdited: false,
        cropDataUrl,
      });
      setFields((prev) =>
        prev.map((f) =>
          f.id === field.id
            ? {
                ...f,
                textValue: res.text,
                originalText: res.text,
                confidence: res.confidence,
                script: res.script,
                wasEdited: false,
                cropDataUrl,
              }
            : f,
        ),
      );
    } finally {
      setRerunningId(null);
    }
  }, [form, initialize, recognize]);

  const handleAddBox = useCallback(async (normBbox: [number, number, number, number]) => {
    const imgSrc = form?.imageDataUrl ?? form?.thumbnailDataUrl;
    if (!imgSrc) return;
    await initialize('paddle', 'eng+kan');
    const { imageData, cropDataUrl } = await extractNormCrop(imgSrc, normBbox);
    const res = await recognize({
      imageData,
      fieldType: 'text',
      fieldIndex: 0,
      totalFields: 1,
    });
    const newField: Omit<FormField, 'id'> = {
      formId,
      fieldId: `manual_${Date.now()}`,
      labelEn: `Manual Box ${fields.length + 1}`,
      labelKn: `ಹಸ್ತಚಾಲಿತ ಬಾಕ್ಸ್ ${fields.length + 1}`,
      fieldType: 'text',
      textValue: res.text,
      originalText: res.text,
      confidence: res.confidence,
      wasEdited: false,
      cropDataUrl,
      normBbox,
      script: res.script,
      model: 'paddle',
      category: 'other',
    };
    const newId = (await db.formFields.add(newField)) as number;
    setFields((prev) => [...prev, { ...newField, id: newId }]);
    setSelectedFieldId(newId);
  }, [form, formId, fields.length, initialize, recognize]);

  const handleDeleteBox = useCallback(async (fieldId: number) => {
    await db.formFields.delete(fieldId);
    setFields((prev) => prev.filter((f) => f.id !== fieldId));
    if (selectedFieldId === fieldId) setSelectedFieldId(null);
  }, [selectedFieldId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updatedFields = await db.formFields.where('formId').equals(formId).toArray();
      const avg = updatedFields.reduce((s, f) => s + f.confidence, 0) / (updatedFields.length || 1);
      await markFormReviewed(formId, avg);
      await enqueueSyncForm(formId);
      void navigate({ to: '/forms' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground text-sm">Form not found</div>
      </div>
    );
  }

  // Split fields: low confidence or name edge-case warnings first
  const nameWarnings = findFormNameEdgeCases(fields);
  const needsReview = fields.filter(
    (f) =>
      (f.confidence < CONFIDENCE_THRESHOLDS.medium || nameWarnings.has(f.id!)) &&
      !accepted.has(f.id!),
  );
  const others = fields.filter(
    (f) =>
      (f.confidence >= CONFIDENCE_THRESHOLDS.medium && !nameWarnings.has(f.id!)) ||
      accepted.has(f.id!),
  );

  const avgConf = fields.reduce((s, f) => s + f.confidence, 0) / (fields.length || 1);
  const pageImgSrc = form.imageDataUrl ?? form.thumbnailDataUrl;

  return (
    <div className="flex h-screen flex-col bg-background">
      <OfflineStatusBar />

      {/* Header */}
      <div className="flex items-center gap-2 border-b px-4 py-3 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => void navigate({ to: '/forms' })}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate">{form.templateName}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
            <span>{fields.length} fields ·</span>
            <ConfidenceBadge confidence={avgConf} />
            {nameWarnings.size > 0 && (
              <span className="text-amber-600 font-medium">
                · ⚠ {nameWarnings.size} name {nameWarnings.size === 1 ? 'warning' : 'warnings'}
              </span>
            )}
          </div>
        </div>
        {/* Editable JSON -> PDF */}
        <Button variant="outline" size="sm" onClick={() => setJsonDialogOpen(true)}>
          <FileJson className="h-4 w-4 mr-1" />
          JSON → PDF
        </Button>

        {/* Export dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => exportJson(form, fields)}>
              Export JSON (with bboxes)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportCsv(form, fields)}>
              Export CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exportPdf(form, fields)}>
              Export PDF
            </DropdownMenuItem>
            {pageImgSrc && (
              <DropdownMenuItem onClick={() => void exportAnnotatedPng(form, fields)}>
                Export Annotated PNG
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Interactive bounding-box overlay */}
      {pageImgSrc && (
        <BoxReviewOverlay
          imageDataUrl={pageImgSrc}
          fields={fields}
          selectedFieldId={selectedFieldId}
          onSelectField={handleSelectField}
          onAddBox={handleAddBox}
          onDeleteBox={handleDeleteBox}
          onRerunBox={handleRerunBox}
          rerunningId={rerunningId}
        />
      )}

      {/* Fields */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 pb-36">

        {needsReview.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-red-600 uppercase mb-3">
              ⚠ Needs Review ({needsReview.length})
            </h2>
            <div className="space-y-3">
              {needsReview.map((field) => (
                <div
                  key={field.id}
                  ref={(el) => {
                    if (el && field.id !== undefined) cardRefs.current.set(field.id, el);
                  }}
                  onClick={() => field.id !== undefined && setSelectedFieldId(field.id)}
                  className={field.id === selectedFieldId ? 'ring-2 ring-primary rounded-xl' : ''}
                >
                  <FieldCard
                    fieldId={field.fieldId}
                    labelEn={field.labelEn}
                    labelKn={field.labelKn}
                    fieldType={field.fieldType as FieldType}
                    value={field.textValue}
                    confidence={field.confidence}
                    cropDataUrl={field.cropDataUrl}
                    onValueChange={(v) => void handleValueChange(field.id!, v)}
                    onAccept={() => handleAccept(field.id!)}
                    accepted={accepted.has(field.id!)}
                    warnings={field.id !== undefined ? nameWarnings.get(field.id) : undefined}
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {others.length > 0 && (
          <section>
            {needsReview.length > 0 && (
              <h2 className="text-xs font-semibold text-muted-foreground uppercase mb-3">
                Other Fields
              </h2>
            )}
            <div className="space-y-3">
              {others.map((field) => (
                <div
                  key={field.id}
                  ref={(el) => {
                    if (el && field.id !== undefined) cardRefs.current.set(field.id, el);
                  }}
                  onClick={() => field.id !== undefined && setSelectedFieldId(field.id)}
                  className={field.id === selectedFieldId ? 'ring-2 ring-primary rounded-xl' : ''}
                >
                  <FieldCard
                    fieldId={field.fieldId}
                    labelEn={field.labelEn}
                    labelKn={field.labelKn}
                    fieldType={field.fieldType as FieldType}
                    value={field.textValue}
                    confidence={field.confidence}
                    cropDataUrl={field.cropDataUrl}
                    onValueChange={(v) => void handleValueChange(field.id!, v)}
                    onAccept={() => handleAccept(field.id!)}
                    accepted={accepted.has(field.id!)}
                    warnings={field.id !== undefined ? nameWarnings.get(field.id) : undefined}
                  />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 border-t bg-background px-4 py-3 flex gap-3 pb-safe">
        <Button variant="outline" onClick={handleAcceptAll} className="flex-1" disabled={accepted.size === fields.length}>
          Accept All
        </Button>
        <Button onClick={handleSave} className="flex-1" disabled={saving}>
          {saving ? 'Saving…' : 'Save & Done'}
        </Button>
      </div>

      <JsonToPdfDialog
        open={jsonDialogOpen}
        onOpenChange={setJsonDialogOpen}
        form={form}
        fields={fields}
        onApplyJsonValues={async (updates) => {
          for (let i = 0; i < updates.length; i++) {
            const upd = updates[i]!;
            const target = fields.find((f) => f.fieldId === upd.key) ?? fields[i];
            if (target?.id !== undefined && target.textValue !== upd.value) {
              await handleValueChange(target.id, upd.value);
            }
          }
        }}
      />
    </div>
  );
}


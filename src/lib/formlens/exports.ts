/**
 * Export utilities: JSON, CSV, printable PDF.
 */
import type { SavedForm, FormField } from '@/db/schema';
import { CONFIDENCE_THRESHOLDS } from '@/config/ocrModels';
import { exportJsonToPdf, formToEditableJson } from '@/lib/formlens/jsonPdf';

export function exportJson(form: SavedForm, fields: FormField[]): void {
  const data = {
    id: form.id,
    template: form.templateName,
    scanMode: form.scanMode ?? 'auto',
    status: form.status,
    createdAt: new Date(form.createdAt).toISOString(),
    avgConfidence: Math.round(form.avgConfidence * 100),
    fields: fields.map((f, idx) => ({
      boxNumber: idx + 1,
      fieldId: f.fieldId,
      labelEn: f.labelEn,
      value: f.textValue,
      originalText: f.originalText,
      confidence: Math.round(f.confidence * 100),
      script: f.script ?? 'en',
      model: f.model ?? 'unknown',
      normBbox: f.normBbox ?? null,
      wasEdited: f.wasEdited,
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `formlens-${form.id ?? 'form'}.json`);
}

export async function exportAnnotatedPng(form: SavedForm, fields: FormField[]): Promise<void> {
  const src = form.imageDataUrl ?? form.thumbnailDataUrl;
  if (!src) return;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load form image'));
    img.src = src;
  });

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || form.imageWidth || 800;
  canvas.height = img.naturalHeight || form.imageHeight || 600;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  fields.forEach((f, idx) => {
    if (!f.normBbox) return;
    const [nx0, ny0, nx1, ny1] = f.normBbox;
    const x = nx0 * canvas.width;
    const y = ny0 * canvas.height;
    const w = (nx1 - nx0) * canvas.width;
    const h = (ny1 - ny0) * canvas.height;
    const color =
      f.confidence >= CONFIDENCE_THRESHOLDS.high
        ? '#16a34a'
        : f.confidence >= CONFIDENCE_THRESHOLDS.medium
          ? '#d97706'
          : '#dc2626';

    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, canvas.width * 0.003);
    ctx.strokeRect(x, y, w, h);

    ctx.fillStyle = color;
    ctx.fillRect(x, Math.max(0, y - 18), 26, 18);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(String(idx + 1), x + 4, Math.max(13, y - 4));
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (blob) downloadBlob(blob, `formlens-${form.id ?? 'form'}-annotated.png`);
}

export function exportCsv(form: SavedForm, fields: FormField[]): void {
  const header = ['Field ID', 'Label', 'Value', 'Confidence %', 'Was Edited'];
  const rows = fields.map((f) => [
    f.fieldId,
    f.labelEn,
    `"${f.textValue.replace(/"/g, '""')}"`,
    Math.round(f.confidence * 100),
    f.wasEdited ? 'Yes' : 'No',
  ]);
  const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  downloadBlob(blob, `formlens-${form.id ?? 'form'}.csv`);
}

export function exportPdf(form: SavedForm, fields: FormField[]): void {
  const editable = formToEditableJson(form, fields);
  void exportJsonToPdf(editable, `formlens-${form.id ?? 'form'}.pdf`);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}


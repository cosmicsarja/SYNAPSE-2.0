/**
 * Export utilities: JSON, CSV, printable PDF.
 */
import type { SavedForm, FormField } from '@/db/schema';
import { jsPDF } from 'jspdf';

export function exportJson(form: SavedForm, fields: FormField[]): void {
  const data = {
    id: form.id,
    template: form.templateName,
    status: form.status,
    createdAt: new Date(form.createdAt).toISOString(),
    avgConfidence: Math.round(form.avgConfidence * 100),
    fields: fields.map((f) => ({
      fieldId: f.fieldId,
      labelEn: f.labelEn,
      value: f.textValue,
      confidence: Math.round(f.confidence * 100),
      wasEdited: f.wasEdited,
    })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `formlens-${form.id ?? 'form'}.json`);
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
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Header
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('FormLens Export', 15, 20);

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Template: ${form.templateName}`, 15, 30);
  doc.text(`Date: ${new Date(form.createdAt).toLocaleDateString('en-IN')}`, 15, 37);
  doc.text(`Status: ${form.status}`, 15, 44);
  doc.text(`Avg Confidence: ${Math.round(form.avgConfidence * 100)}%`, 15, 51);

  // Divider
  doc.setDrawColor(180);
  doc.line(15, 56, 195, 56);

  // Fields table
  let y = 64;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Field', 15, y);
  doc.text('Value', 80, y);
  doc.text('Conf%', 170, y);
  y += 6;
  doc.setFont('helvetica', 'normal');

  for (const f of fields) {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
    doc.text(f.labelEn, 15, y, { maxWidth: 60 });
    doc.text(f.textValue || '—', 80, y, { maxWidth: 85 });
    doc.text(`${Math.round(f.confidence * 100)}%`, 170, y);
    y += 8;
  }

  doc.save(`formlens-${form.id ?? 'form'}.pdf`);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}


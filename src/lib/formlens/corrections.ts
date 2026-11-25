/**
 * Offline corrections dataset utilities:
 * - Convert field crop data URLs to PNG blobs for Dexie storage
 * - Export stored corrections as a ZIP (crops/*.png + labels.csv) using JSZip
 */
import JSZip from 'jszip';
import { getAllCorrections, type CorrectionRecord } from '@/db';

function escapeCsvCell(value: string): string {
  const str = String(value ?? '');
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function dataUrlToPngBlob(dataUrl?: string): Promise<Blob | undefined> {
  if (!dataUrl || typeof document === 'undefined') return undefined;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to decode crop image'));
      img.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, img.naturalWidth || img.width);
    canvas.height = Math.max(1, img.naturalHeight || img.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    return blob ?? undefined;
  } catch {
    return undefined;
  }
}

export async function buildCorrectionsDatasetZip(
  records: CorrectionRecord[],
): Promise<Blob> {
  const zip = new JSZip();
  const cropsFolder = zip.folder('crops');
  const rows: string[] = ['filename,corrected_text,original_text,confidence'];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    let filename = '';
    if (rec.cropBlob && cropsFolder) {
      filename = `crops/crop_${String(i + 1).padStart(4, '0')}.png`;
      cropsFolder.file(`crop_${String(i + 1).padStart(4, '0')}.png`, rec.cropBlob);
    }
    rows.push(
      [
        escapeCsvCell(filename),
        escapeCsvCell(rec.correctedText),
        escapeCsvCell(rec.originalText),
        rec.confidence.toFixed(4),
      ].join(','),
    );
  }

  zip.file('labels.csv', rows.join('\n'));
  return zip.generateAsync({ type: 'blob' });
}

export async function exportCorrectionsDataset(): Promise<number> {
  const records = await getAllCorrections();
  if (records.length === 0) return 0;
  const blob = await buildCorrectionsDatasetZip(records);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `formlens-corrections-${stamp}.zip`;
  a.click();
  URL.revokeObjectURL(url);
  return records.length;
}

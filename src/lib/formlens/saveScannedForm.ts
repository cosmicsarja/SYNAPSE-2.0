/**
 * Shared helper to assign OCR boxes to template/auto fields and persist
 * the SavedForm + FormFields into Dexie (used by both Single and Batch scan).
 */
import { saveFormWithFields } from '@/db';
import type { FormField, ScanMode } from '@/db/schema';
import type { PipelineTimings } from '@/workers/pipeline/paddle-engine';
import {
  assignBoxesToTemplateFields,
  pairLabelsAndValues,
  type PositionedBox,
  type TemplateFieldDef,
} from '@/lib/formlens/boxAssignment';

interface TemplateJson {
  id: string;
  name: string;
  fields: TemplateFieldDef[];
}

export function inferFieldType(text: string): string {
  const digits = text.replace(/[\s\-()]/g, '');
  if (/(?:\+91)?[6-9]\d{9}/.test(digits)) return 'phone';
  if (/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/.test(text)) return 'date';
  if (/^\d[\d,.\s]*$/.test(text.trim())) return 'number';
  return 'text';
}

export function cropBoxUrl(
  srcCanvas: HTMLCanvasElement,
  bbox: { x0: number; y0: number; x1: number; y1: number },
): string {
  const x = Math.max(0, Math.floor(bbox.x0) - 4);
  const y = Math.max(0, Math.floor(bbox.y0) - 4);
  const w = Math.max(1, Math.min(srcCanvas.width - x, Math.ceil(bbox.x1) - x + 4));
  const h = Math.max(1, Math.min(srcCanvas.height - y, Math.ceil(bbox.y1) - y + 4));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);
  return out.toDataURL('image/jpeg', 0.78);
}

export async function dataUrlToImageData(dataUrl: string): Promise<ImageData> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load queued image'));
    img.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, img.naturalWidth || img.width);
  canvas.height = Math.max(1, img.naturalHeight || img.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export interface SaveScannedFormInput {
  imageData: ImageData;
  imageDataUrl: string;
  boxes: PositionedBox[];
  scanMode: ScanMode;
  selectedTemplateId: string;
  timings?: PipelineTimings | null;
}

export async function saveScannedForm(input: SaveScannedFormInput): Promise<number> {
  const { imageData, imageDataUrl, boxes, scanMode, selectedTemplateId, timings } = input;

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = imageData.width;
  srcCanvas.height = imageData.height;
  srcCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

  const positionedBoxes = boxes.map((item) => ({
    ...item,
    cropDataUrl: item.cropDataUrl ?? cropBoxUrl(srcCanvas, item.bbox),
  }));

  let fields: Omit<FormField, 'id' | 'formId'>[] = [];
  let templateId = 'auto-extract';
  let templateName = 'Auto Detect (Kannada + English)';

  if (scanMode === 'template') {
    const tplRes = await fetch(`/templates/${selectedTemplateId}.json`);
    if (!tplRes.ok) throw new Error(`Template /templates/${selectedTemplateId}.json not found`);
    const tpl = (await tplRes.json()) as TemplateJson;
    templateId = tpl.id;
    templateName = tpl.name;
    const assigned = assignBoxesToTemplateFields(
      positionedBoxes,
      tpl.fields,
      imageData.width,
      imageData.height,
    );
    fields = assigned.map((a) => ({
      fieldId: a.fieldId,
      labelEn: a.labelEn,
      labelKn: a.labelKn,
      fieldType: a.fieldType,
      textValue: a.textValue,
      originalText: a.originalText,
      confidence: a.confidence,
      wasEdited: false,
      normBbox: a.normBbox,
      category: 'template' as const,
      ...(a.boxIndices[0] !== undefined && positionedBoxes[a.boxIndices[0]]?.cropDataUrl
        ? { cropDataUrl: positionedBoxes[a.boxIndices[0]]!.cropDataUrl! }
        : {}),
    }));
  } else if (positionedBoxes.some((b) => Boolean(b.label))) {
    // Structured key-value extraction (e.g., Gemini Vision form parser)
    const imgW = Math.max(1, imageData.width);
    const imgH = Math.max(1, imageData.height);
    fields = positionedBoxes.map((b, idx) => {
      const label = b.label?.trim() || `Field ${idx + 1}`;
      const fieldId =
        label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '') || `field_${idx + 1}`;
      return {
        fieldId,
        labelEn: label,
        labelKn: label,
        fieldType: inferFieldType(b.text),
        textValue: b.text,
        originalText: b.text,
        confidence: b.confidence,
        wasEdited: false,
        normBbox: [b.bbox.x0 / imgW, b.bbox.y0 / imgH, b.bbox.x1 / imgW, b.bbox.y1 / imgH] as [
          number,
          number,
          number,
          number,
        ],
        ...(b.script ? { script: b.script } : {}),
        ...(b.model ? { model: b.model } : {}),
        category: 'paired' as const,
        ...(b.cropDataUrl ? { cropDataUrl: b.cropDataUrl } : {}),
      };
    });
  } else {
    const knownLabels: Array<{ id: string; labelEn: string; labelKn: string }> = [];
    for (const tid of ['ration-card', 'income-certificate']) {
      try {
        const res = await fetch(`/templates/${tid}.json`);
        if (res.ok) {
          const tpl = (await res.json()) as TemplateJson;
          for (const f of tpl.fields) {
            knownLabels.push({ id: f.id, labelEn: f.labelEn, labelKn: f.labelKn });
          }
        }
      } catch {
        /* ignore if offline and not cached */
      }
    }
    const paired = pairLabelsAndValues(
      positionedBoxes,
      knownLabels,
      imageData.width,
      imageData.height,
    );
    fields = paired.map((p) => ({
      fieldId: p.fieldId,
      labelEn: p.labelEn,
      labelKn: p.labelKn,
      fieldType: inferFieldType(p.textValue),
      textValue: p.textValue,
      originalText: p.originalText,
      confidence: p.confidence,
      wasEdited: false,
      normBbox: p.normBbox,
      ...(p.script ? { script: p.script } : {}),
      ...(p.model ? { model: p.model } : {}),
      category: p.kind,
      ...(p.cropDataUrl ? { cropDataUrl: p.cropDataUrl } : {}),
    }));
  }

  const avgConfidence =
    fields.length > 0
      ? fields.reduce((s, f) => s + f.confidence, 0) / fields.length
      : 0;

  return saveFormWithFields(
    {
      templateId,
      templateName,
      status: 'draft',
      avgConfidence,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      thumbnailDataUrl: imageDataUrl,
      imageDataUrl,
      imageWidth: imageData.width,
      imageHeight: imageData.height,
      scanMode,
      ...(timings ? { timingsJson: JSON.stringify(timings) } : {}),
    },
    fields,
  );
}

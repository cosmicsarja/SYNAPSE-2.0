/**
 * TesseractOcrClient — real on-device offline OCR for English + Kannada.
 * Uses tesseract.js with local worker, WASM core, and traineddata from
 * /tesseract/ and /tessdata/ (zero external CDN calls).
 */
import type { FieldType, OcrResult, OcrScript } from '@/config/model';

export type OcrLangMode = 'eng+kan' | 'eng' | 'kan';
export type BlockLanguage = 'kn' | 'en' | 'mixed' | 'number';

export interface OcrLine {
  text: string;
  label?: string;
  confidence: number; // 0–1
  language?: BlockLanguage;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export function classifyBlockLanguage(text: string): BlockLanguage {
  const hasKannada = /[\u0C80-\u0CFF]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  const hasDigit = /\d/.test(text);
  if (hasKannada && hasLatin) return 'mixed';
  if (hasKannada) return 'kn';
  if (hasLatin) return 'en';
  if (hasDigit) return 'number';
  return 'en';
}

export interface FullPageOcrResult {
  fullText: string;
  confidence: number; // 0–1
  lines: OcrLine[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharedWorker: any = null;
let currentLangMode: OcrLangMode = 'eng+kan';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let initPromise: Promise<any> | null = null;

function detectScript(text: string): OcrScript {
  const hasKannada = /[\u0C80-\u0CFF]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  if (hasKannada && hasLatin) return 'mixed';
  if (hasKannada) return 'kn';
  return 'en';
}

/**
 * Preprocess ImageData for Tesseract without destructive thresholding:
 * - Converts to clean grayscale with gentle auto-contrast stretch (preserves anti-aliased ink for LSTM)
 * - Upscales small crops so line height >= minHeight, caps max dimension at 2000px
 * - Adds 16px white padding around edges (prevents edge-clipping in LSTM)
 * - Returns { blob, scale, pad } so bounding boxes map back 1:1 to original ImageData
 */
async function preprocessToPngBlob(
  crop: ImageData,
  minHeight = 96,
): Promise<{ blob: Blob; scale: number; pad: number }> {
  const srcW = Math.max(1, crop.width);
  const srcH = Math.max(1, crop.height);

  let scale = srcH < minHeight ? Math.min(3, minHeight / srcH) : 1;
  const maxDim = 2000;
  if (srcW * scale > maxDim) scale = maxDim / srcW;
  if (srcH * scale > maxDim) scale = Math.min(scale, maxDim / srcH);
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));
  const pad = 16;

  // Convert to grayscale and find 2nd/98th percentile for gentle contrast stretch
  const total = srcW * srcH;
  const gray = new Uint8Array(total);
  const hist = new Uint32Array(256);

  for (let i = 0; i < total; i++) {
    const idx = i * 4;
    const g = Math.round(
      0.299 * (crop.data[idx] ?? 255) +
      0.587 * (crop.data[idx + 1] ?? 255) +
      0.114 * (crop.data[idx + 2] ?? 255),
    );
    gray[i] = g;
    hist[g] = (hist[g] ?? 0) + 1;
  }

  let low = 0;
  let high = 255;
  let acc = 0;
  const lowTarget = total * 0.01;
  const highTarget = total * 0.99;
  for (let v = 0; v < 256; v++) {
    acc += hist[v] ?? 0;
    if (acc >= lowTarget) { low = v; break; }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v] ?? 0;
    if (total - acc <= highTarget) { high = v; break; }
  }

  const range = high - low;
  const outImg = new ImageData(srcW, srcH);
  const stretch = range > 20 && range < 220;

  for (let i = 0; i < total; i++) {
    const g = gray[i] ?? 255;
    const val = stretch
      ? Math.max(0, Math.min(255, Math.round(((g - low) * 255) / range)))
      : g;
    const idx = i * 4;
    outImg.data[idx] = val;
    outImg.data[idx + 1] = val;
    outImg.data[idx + 2] = val;
    outImg.data[idx + 3] = 255;
  }

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  srcCanvas.getContext('2d')!.putImageData(outImg, 0, 0);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = targetW + pad * 2;
  outCanvas.height = targetH + pad * 2;
  const octx = outCanvas.getContext('2d')!;
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, outCanvas.width, outCanvas.height);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(srcCanvas, 0, 0, srcW, srcH, pad, pad, targetW, targetH);

  const blob = await new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to encode crop image'));
    }, 'image/png');
  });

  return { blob, scale, pad };
}

function recognizeCheckbox(crop: ImageData): OcrResult {
  // Inspect only central 55% so outer printed box border does not count as check ink
  const xStart = Math.floor(crop.width * 0.22);
  const xEnd = Math.ceil(crop.width * 0.78);
  const yStart = Math.floor(crop.height * 0.22);
  const yEnd = Math.ceil(crop.height * 0.78);

  let darkPixels = 0;
  let totalPixels = 0;
  for (let y = yStart; y < yEnd; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const idx = (y * crop.width + x) * 4;
      const lum = (0.299 * (crop.data[idx] ?? 255) + 0.587 * (crop.data[idx + 1] ?? 255) + 0.114 * (crop.data[idx + 2] ?? 255)) / 255;
      if (lum < 0.55) darkPixels++;
      totalPixels++;
    }
  }
  const inkRatio = totalPixels > 0 ? darkPixels / totalPixels : 0;
  const isChecked = inkRatio > 0.08;
  return {
    text: isChecked ? 'yes' : 'no',
    confidence: 0.75,
    script: 'en',
  };
}

export async function initTesseract(langMode: OcrLangMode = 'eng+kan'): Promise<void> {
  if (sharedWorker) {
    if (currentLangMode !== langMode) {
      const langs = langMode.split('+');
      await sharedWorker.reinitialize(langs);
      currentLangMode = langMode;
    }
    return;
  }
  if (initPromise) {
    await initPromise;
    if (sharedWorker && currentLangMode !== langMode) {
      await sharedWorker.reinitialize(langMode.split('+'));
      currentLangMode = langMode;
    }
    return;
  }

  initPromise = (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const worker = await createWorker(langMode.split('+'), OEM.LSTM_ONLY, {
      workerBlobURL: false,
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/',
      langPath: '/tessdata',
      cacheMethod: 'write',
    });
    sharedWorker = worker;
    currentLangMode = langMode;
    return worker;
  })();

  try {
    await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

export async function recognizeWithTesseract(
  crop: ImageData,
  fieldType: FieldType,
): Promise<OcrResult> {
  if (fieldType === 'checkbox') {
    return recognizeCheckbox(crop);
  }
  await initTesseract();
  const { PSM } = await import('tesseract.js');

  await sharedWorker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
  });

  const { blob } = await preprocessToPngBlob(crop, 96);
  const result = await sharedWorker.recognize(blob, {}, { text: true });
  let text = (result.data.text ?? '').replace(/\s+/g, ' ').trim();

  if (fieldType === 'phone') {
    const digits = text.replace(/[^\d]/g, '');
    const m = digits.match(/[6-9]\d{9}/);
    if (m) text = m[0];
  }

  const confidence = Math.max(0, Math.min(1, (result.data.confidence ?? 0) / 100));
  return {
    text,
    confidence,
    script: detectScript(text),
  };
}

export async function recognizeFullPageWithTesseract(
  imageData: ImageData,
  langMode: OcrLangMode = 'eng+kan',
): Promise<FullPageOcrResult> {
  await initTesseract(langMode);
  const { PSM } = await import('tesseract.js');

  await sharedWorker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
  });

  const { blob, scale, pad } = await preprocessToPngBlob(imageData, 600);

  const result = await sharedWorker.recognize(blob, {}, { text: true, blocks: true });
  const lines: OcrLine[] = [];

  if (result.data.blocks) {
    for (const block of result.data.blocks) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const t = line.text.replace(/\s+/g, ' ').trim();
          if (!t) continue;
          // Map bbox coordinates back from padded/scaled image to original imageData space
          lines.push({
            text: t,
            confidence: Math.max(0, Math.min(1, (line.confidence ?? 0) / 100)),
            language: classifyBlockLanguage(t),
            bbox: {
              x0: Math.max(0, Math.round((line.bbox.x0 - pad) / scale)),
              y0: Math.max(0, Math.round((line.bbox.y0 - pad) / scale)),
              x1: Math.min(imageData.width, Math.round((line.bbox.x1 - pad) / scale)),
              y1: Math.min(imageData.height, Math.round((line.bbox.y1 - pad) / scale)),
            },
          });
        }
      }
    }
  }

  return {
    fullText: (result.data.text ?? '').trim(),
    confidence: Math.max(0, Math.min(1, (result.data.confidence ?? 0) / 100)),
    lines,
  };
}

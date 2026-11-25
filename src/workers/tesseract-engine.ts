/**
 * TesseractOcrClient — real on-device offline OCR for English + Kannada.
 * Uses tesseract.js with local worker, WASM core, and traineddata from
 * /tesseract/ and /tessdata/ (zero external CDN calls).
 */
import type { FieldType, OcrResult, OcrScript } from '@/config/model';

export interface OcrLine {
  text: string;
  confidence: number; // 0–1
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface FullPageOcrResult {
  fullText: string;
  confidence: number; // 0–1
  lines: OcrLine[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sharedWorker: any = null;
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
 * Preprocess ImageData for Tesseract:
 * - Convert to contrast-stretched grayscale so dim/uneven lighting reads crisply
 * - Upscale small crops so line height >= 96px
 * - Add 16px white padding around edges (prevents edge-clipping in LSTM)
 */
async function preprocessToPngBlob(crop: ImageData, minHeight = 96): Promise<Blob> {
  const srcW = Math.max(1, crop.width);
  const srcH = Math.max(1, crop.height);

  // Scale up small crops (up to 3x, capping width at 1800px)
  let scale = srcH < minHeight ? Math.min(3, minHeight / srcH) : 1;
  if (srcW * scale > 1800) scale = 1800 / srcW;
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));
  const pad = 16;

  // Build contrast-stretched grayscale buffer on source
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const sctx = srcCanvas.getContext('2d')!;
  const gray = new ImageData(new Uint8ClampedArray(crop.data), srcW, srcH);

  let minLum = 255;
  let maxLum = 0;
  for (let i = 0; i < gray.data.length; i += 4) {
    const lum = 0.299 * (gray.data[i] ?? 0) + 0.587 * (gray.data[i + 1] ?? 0) + 0.114 * (gray.data[i + 2] ?? 0);
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }
  const range = maxLum - minLum;
  if (range > 20) {
    for (let i = 0; i < gray.data.length; i += 4) {
      const lum = 0.299 * (gray.data[i] ?? 0) + 0.587 * (gray.data[i + 1] ?? 0) + 0.114 * (gray.data[i + 2] ?? 0);
      const norm = Math.round(((lum - minLum) / range) * 255);
      gray.data[i] = norm;
      gray.data[i + 1] = norm;
      gray.data[i + 2] = norm;
      gray.data[i + 3] = 255;
    }
  }
  sctx.putImageData(gray, 0, 0);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = targetW + pad * 2;
  outCanvas.height = targetH + pad * 2;
  const octx = outCanvas.getContext('2d')!;
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, outCanvas.width, outCanvas.height);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(srcCanvas, 0, 0, srcW, srcH, pad, pad, targetW, targetH);

  return new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode crop image'));
    }, 'image/png');
  });
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

export async function initTesseract(): Promise<void> {
  if (sharedWorker) return;
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const worker = await createWorker(['eng', 'kan'], OEM.LSTM_ONLY, {
      workerBlobURL: false,
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/',
      langPath: '/tessdata',
      cacheMethod: 'write',
    });
    sharedWorker = worker;
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

  const blob = await preprocessToPngBlob(crop, 96);
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
): Promise<FullPageOcrResult> {
  await initTesseract();
  const { PSM } = await import('tesseract.js');

  await sharedWorker.setParameters({
    tessedit_pageseg_mode: PSM.AUTO,
  });

  const pad = 16;
  const blob = await preprocessToPngBlob(imageData, 600);
  const scale = imageData.height < 600 ? Math.min(3, 600 / Math.max(1, imageData.height)) : (imageData.width > 1800 ? 1800 / imageData.width : 1);

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

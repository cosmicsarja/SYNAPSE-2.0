/**
 * CloudOcrClient — connects to an optional Python Handwritten-Form-OCR FastAPI
 * backend (EasyOCR / TrOCR / PaddleOCR) when online, with automatic fallback
 * to local offline Tesseract OCR.
 */
import { getSetting } from '@/db';
import {
  classifyBlockLanguage,
  type BlockLanguage,
  type FullPageOcrResult,
  type OcrLangMode,
  type OcrLine,
} from '@/workers/tesseract-engine';

export interface CloudOcrResponse {
  usedCloud: boolean;
  result: FullPageOcrResult;
  fallbackReason?: string;
}

export async function getCloudOcrUrl(): Promise<string> {
  const saved = await getSetting<string>('cloud_ocr_url', '');
  if (saved && saved.trim()) return saved.trim().replace(/\/$/, '');
  const envUrl = import.meta.env.VITE_OCR_API_URL as string | undefined;
  return envUrl ? envUrl.trim().replace(/\/$/, '') : '';
}

async function imageDataToJpegBlob(imageData: ImageData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, imageData.width);
  canvas.height = Math.max(1, imageData.height);
  canvas.getContext('2d')!.putImageData(imageData, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
      'image/jpeg',
      0.92,
    );
  });
}

function normalizeResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  imgW: number,
  imgH: number,
): FullPageOcrResult {
  // Format 1: Lens line-box format { fullText, lines: [{ text, confidence, bbox }] }
  if (Array.isArray(data?.lines)) {
    const lines: OcrLine[] = data.lines
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((l: any) => typeof l?.text === 'string' && l.text.trim())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((l: any) => {
        const text = String(l.text).trim();
        const lang = (['kn', 'en', 'mixed', 'number'].includes(l.language)
          ? l.language
          : classifyBlockLanguage(text)) as BlockLanguage;
        return {
          text,
          language: lang,
          confidence: typeof l.confidence === 'number'
            ? (l.confidence > 1 ? l.confidence / 100 : l.confidence)
            : 0.9,
          bbox: {
            x0: Number(l.bbox?.x0 ?? 0),
            y0: Number(l.bbox?.y0 ?? 0),
            x1: Number(l.bbox?.x1 ?? imgW),
            y1: Number(l.bbox?.y1 ?? Math.min(imgH, 60)),
          },
        };
      });
    const fullText = typeof data.fullText === 'string'
      ? data.fullText.trim()
      : lines.map((l) => l.text).join('\n');
    const avg = lines.length > 0
      ? lines.reduce((s, l) => s + l.confidence, 0) / lines.length
      : 0;
    return { fullText, confidence: avg, lines };
  }

  // Format 2: Handwritten-Form-OCR /extract response { fields: Record<string, string>, metadata: { avg_confidence } }
  if (data?.fields && typeof data.fields === 'object') {
    const entries = Object.entries(data.fields as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
    const avgConf = typeof data?.metadata?.avg_confidence === 'number'
      ? (data.metadata.avg_confidence > 1 ? data.metadata.avg_confidence / 100 : data.metadata.avg_confidence)
      : 0.9;
    const stepH = Math.max(24, Math.floor(imgH / Math.max(entries.length, 1)));
    const lines: OcrLine[] = entries.map(([k, v], i) => ({
      text: `${k}: ${String(v).trim()}`,
      confidence: avgConf,
      bbox: {
        x0: Math.round(imgW * 0.05),
        y0: Math.min(imgH - 20, i * stepH + 8),
        x1: Math.round(imgW * 0.95),
        y1: Math.min(imgH, (i + 1) * stepH - 4),
      },
    }));
    return {
      fullText: lines.map((l) => l.text).join('\n'),
      confidence: avgConf,
      lines,
    };
  }

  throw new Error('Unexpected response format from Cloud OCR API');
}

export async function recognizeWithCloudBackend(
  imageData: ImageData,
  langMode: OcrLangMode = 'eng+kan',
): Promise<FullPageOcrResult> {
  if (!navigator.onLine) {
    throw new Error('Offline');
  }
  const baseUrl = await getCloudOcrUrl();
  if (!baseUrl) {
    throw new Error('Cloud OCR URL not configured');
  }

  const blob = await imageDataToJpegBlob(imageData);
  const form = new FormData();
  form.append('file', blob, 'scan.jpg');
  form.append('ocr_backend', 'easyocr');
  form.append('layout_mode', 'heuristic');
  form.append('lang', langMode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(`${baseUrl}/extract`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Cloud OCR HTTP ${res.status}`);
    }
    const json = await res.json();
    return normalizeResponse(json, imageData.width, imageData.height);
  } finally {
    clearTimeout(timer);
  }
}

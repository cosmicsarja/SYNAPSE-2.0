/**
 * GeminiVisionOcrEngine — optional online high-accuracy Kannada + English OCR
 * using Google Gemini Vision API (`VITE_GEMINI_API_KEY` from `.env` or Settings override).
 * Returns bounding boxes (`box_2d` 0..1000 -> pixel `bbox`) so LensOverlay,
 * Template/Auto mode, BoxReviewOverlay, and Editable JSON -> PDF all work seamlessly.
 */
import { getSetting } from '@/db';
import { normalizeKannadaText } from '@/lib/formlens/kannadaNormalize';
import {
  classifyBlockLanguage,
  type BlockLanguage,
  type FullPageOcrResult,
  type OcrLangMode,
  type OcrLine,
} from '@/workers/tesseract-engine';

const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
const MAX_UPLOAD_SIDE = 1600;

export function hasEnvGeminiKey(): boolean {
  const envKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  return Boolean(envKey && envKey.trim().length > 0);
}

export async function getGeminiConfig(): Promise<{ apiKey: string; model: string }> {
  const savedKey = await getSetting<string>('gemini_api_key', '');
  const envKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '';
  const apiKey = (savedKey && savedKey.trim()) || envKey.trim();

  const savedModel = await getSetting<string>('gemini_model', '');
  const cleanSavedModel = savedModel && savedModel.trim() !== 'gemini-2.5-flash' ? savedModel.trim() : '';
  const envModel = (import.meta.env.VITE_GEMINI_MODEL as string | undefined) ?? '';
  const model = cleanSavedModel || envModel.trim() || DEFAULT_GEMINI_MODEL;

  return { apiKey, model };
}

async function imageDataToBase64Jpeg(imageData: ImageData): Promise<string> {
  const srcW = Math.max(1, imageData.width);
  const srcH = Math.max(1, imageData.height);
  const longest = Math.max(srcW, srcH);
  const scale = longest > MAX_UPLOAD_SIDE ? MAX_UPLOAD_SIDE / longest : 1;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  srcCanvas.getContext('2d')!.putImageData(imageData, 0, 0);

  let targetCanvas = srcCanvas;
  if (scale < 1) {
    targetCanvas = document.createElement('canvas');
    targetCanvas.width = dstW;
    targetCanvas.height = dstH;
    const dctx = targetCanvas.getContext('2d')!;
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(srcCanvas, 0, 0, srcW, srcH, 0, 0, dstW, dstH);
  }

  const dataUrl = targetCanvas.toDataURL('image/jpeg', 0.9);
  const commaIdx = dataUrl.indexOf(',');
  return commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
}

interface GeminiRawBlock {
  text?: unknown;
  script?: unknown;
  confidence?: unknown;
  box_2d?: unknown;
}

/**
 * Pure parser for Gemini Vision OCR JSON output.
 * Converts Gemini's [ymin, xmin, ymax, xmax] (0..1000) into pixel bbox { x0, y0, x1, y1 }.
 */
export function parseGeminiOcrResponse(
  rawText: string,
  imgW: number,
  imgH: number,
): FullPageOcrResult {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Gemini returned non-JSON output: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const rawBlocks: GeminiRawBlock[] = Array.isArray(parsed)
    ? (parsed as GeminiRawBlock[])
    : Array.isArray((parsed as { blocks?: unknown })?.blocks)
      ? ((parsed as { blocks: GeminiRawBlock[] }).blocks)
      : [];

  const lines: OcrLine[] = [];

  for (let i = 0; i < rawBlocks.length; i++) {
    const b = rawBlocks[i];
    if (!b || typeof b.text !== 'string') continue;
    const text = normalizeKannadaText(b.text.trim());
    if (!text) continue;

    let x0 = 10;
    let y0 = Math.min(imgH - 30, 10 + i * 32);
    let x1 = Math.max(50, imgW - 10);
    let y1 = Math.min(imgH - 4, y0 + 28);

    if (Array.isArray(b.box_2d) && b.box_2d.length === 4) {
      const [ymin, xmin, ymax, xmax] = b.box_2d.map(Number);
      if ([ymin, xmin, ymax, xmax].every((n) => Number.isFinite(n))) {
        x0 = Math.max(0, Math.min(imgW - 1, Math.round((xmin! / 1000) * imgW)));
        y0 = Math.max(0, Math.min(imgH - 1, Math.round((ymin! / 1000) * imgH)));
        x1 = Math.max(x0 + 4, Math.min(imgW, Math.round((xmax! / 1000) * imgW)));
        y1 = Math.max(y0 + 4, Math.min(imgH, Math.round((ymax! / 1000) * imgH)));
      }
    }

    const rawConf = typeof b.confidence === 'number' && Number.isFinite(b.confidence)
      ? b.confidence
      : 0.94;
    const confidence = rawConf > 1 ? Math.min(1, rawConf / 100) : Math.max(0, Math.min(1, rawConf));

    const script = (
      b.script === 'kn' || b.script === 'en' || b.script === 'mixed' || b.script === 'number'
        ? b.script
        : classifyBlockLanguage(text)
    ) as BlockLanguage;

    lines.push({
      text,
      confidence,
      language: script,
      bbox: { x0, y0, x1, y1 },
    });
  }

  return {
    fullText: lines.map((l) => l.text).join('\n'),
    lines,
  };
}

export async function recognizeWithGemini(
  imageData: ImageData,
  langMode: OcrLangMode = 'eng+kan',
): Promise<FullPageOcrResult> {
  const { apiKey, model } = await getGeminiConfig();
  if (!apiKey) {
    throw new Error(
      'Gemini API key not configured. Add VITE_GEMINI_API_KEY in .env or enter it in Settings.',
    );
  }
  if (!navigator.onLine) {
    throw new Error('Device is offline — cannot reach Gemini API.');
  }

  const base64Jpeg = await imageDataToBase64Jpeg(imageData);
  const langHint =
    langMode === 'kan'
      ? 'Focus on Kannada script (ಕನ್ನಡ) and numbers.'
      : langMode === 'eng'
        ? 'Focus on English/Latin text and numbers.'
        : 'Read both Kannada (ಕನ್ನಡ) and English/Latin text, including handwritten text, numbers, and dates.';

  const prompt = [
    'You are an exact OCR engine for Indian documents and forms.',
    langHint,
    'Detect every visible text line or field block in reading order (top-to-bottom, left-to-right).',
    'Preserve exact Kannada Unicode spelling (including vowel signs and ottaksharas), English words, and digits without translating.',
    'Return ONLY a JSON object with shape:',
    '{"blocks":[{"text":"string","script":"kn|en|mixed|number","confidence":0.95,"box_2d":[ymin,xmin,ymax,xmax]}]}',
    'where box_2d coordinates are integers normalized 0..1000.',
  ].join(' ');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: 'image/jpeg',
                data: base64Jpeg,
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API HTTP ${res.status}: ${errText.slice(0, 200) || res.statusText}`);
  }

  const payload = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const rawContent = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawContent) {
    throw new Error('Gemini API returned an empty response.');
  }

  return parseGeminiOcrResponse(rawContent, imageData.width, imageData.height);
}

export async function testGeminiConnection(
  overrideKey?: string,
  overrideModel?: string,
): Promise<{ ok: boolean; model: string; message: string }> {
  const cfg = await getGeminiConfig();
  const apiKey = overrideKey?.trim() || cfg.apiKey;
  const model = overrideModel?.trim() || cfg.model;

  if (!apiKey) {
    return { ok: false, model, message: 'No API key found in .env (VITE_GEMINI_API_KEY) or Settings.' };
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, model, message: `HTTP ${res.status}: ${txt.slice(0, 120) || res.statusText}` };
    }
    return { ok: true, model, message: `Connected (${model})` };
  } catch (err) {
    return { ok: false, model, message: err instanceof Error ? err.message : 'Network error' };
  }
}

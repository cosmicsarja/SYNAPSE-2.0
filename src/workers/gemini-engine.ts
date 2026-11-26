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

const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';
const FALLBACK_GEMINI_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
] as const;
const DEPRECATED_MODELS = new Set(['gemini-2.5-flash', 'gemini-3.8-flash']);
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
  const cleanSavedModel =
    savedModel && !DEPRECATED_MODELS.has(savedModel.trim()) ? savedModel.trim() : '';
  const envModel = (import.meta.env.VITE_GEMINI_MODEL as string | undefined) ?? '';
  const cleanEnvModel =
    envModel && !DEPRECATED_MODELS.has(envModel.trim()) ? envModel.trim() : '';
  const model = cleanSavedModel || cleanEnvModel || DEFAULT_GEMINI_MODEL;

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
  label?: unknown;
  key?: unknown;
  value?: unknown;
  text?: unknown;
  script?: unknown;
  confidence?: unknown;
  box_2d?: unknown;
}

/**
 * Pure parser for Gemini Vision OCR JSON output.
 * Supports structured { fields: [{ label, value, box_2d }] } and legacy { blocks: [{ text, box_2d }] }.
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

  const obj = parsed as { fields?: unknown; blocks?: unknown };
  const rawBlocks: GeminiRawBlock[] = Array.isArray(parsed)
    ? (parsed as GeminiRawBlock[])
    : Array.isArray(obj?.fields)
      ? (obj.fields as GeminiRawBlock[])
      : Array.isArray(obj?.blocks)
        ? (obj.blocks as GeminiRawBlock[])
        : [];

  const lines: OcrLine[] = [];

  for (let i = 0; i < rawBlocks.length; i++) {
    const b = rawBlocks[i];
    if (!b) continue;
    const rawValue =
      typeof b.value === 'string'
        ? b.value
        : typeof b.text === 'string'
          ? b.text
          : '';
    const text = normalizeKannadaText(rawValue.trim());
    if (!text) continue;

    const rawLabel =
      typeof b.label === 'string'
        ? b.label.trim()
        : typeof b.key === 'string'
          ? b.key.trim()
          : '';
    const label = rawLabel ? normalizeKannadaText(rawLabel) : undefined;

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
      : 0.95;
    const confidence = rawConf > 1 ? Math.min(1, rawConf / 100) : Math.max(0, Math.min(1, rawConf));

    const script = (
      b.script === 'kn' || b.script === 'en' || b.script === 'mixed' || b.script === 'number'
        ? b.script
        : classifyBlockLanguage(text)
    ) as BlockLanguage;

    lines.push({
      text,
      ...(label ? { label } : {}),
      confidence,
      language: script,
      bbox: { x0, y0, x1, y1 },
    });
  }

  return {
    fullText: lines
      .map((l) => (l.label ? `${l.label} : ${l.text}` : l.text))
      .join('\n'),
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
    'You are an exact OCR and structured form-extraction engine for Indian government/application forms.',
    langHint,
    'Extract all filled form fields (and any standalone key-value pairs) as clean label + value pairs in reading order.',
    'RULES:',
    '1) IGNORE any crossed-out, struck-through, or scribbled-out handwriting — only extract the valid uncrossed value.',
    '2) JOIN character-by-character grid boxes into complete words or numbers (e.g. [R][O][H][A][N] -> "ROHAN", [9][8][4][5][1][2][3][4][9][0] -> "9845123490", [ರೋ][ಹ][ನ್] -> "ರೋಹನ್").',
    '3) Format dates cleanly (e.g. 15/08/2001).',
    '4) For ticked checkboxes (✓), output the selected option as the value (e.g. label "Gender", value "Male"; label "Document for Proof of DOB", value "PAN Card").',
    '5) Preserve exact Kannada Unicode spelling (including all vowel signs like ೋ, ಾ, ಿ, ು and ottaksharas like ರ್, ನ್, ಕ್) without translating.',
    '6) Skip empty/unfilled boilerplate instructions and disclaimers.',
    'Return ONLY a JSON object with shape:',
    '{"fields":[{"label":"string","value":"string","script":"kn|en|mixed|number","confidence":0.96,"box_2d":[ymin,xmin,ymax,xmax]}]}',
    'where box_2d is the bounding box of the filled value (integers 0..1000).',
  ].join('\n');

  const candidates = [model, ...FALLBACK_GEMINI_MODELS.filter((m) => m !== model)];
  let lastStatus = 0;
  let lastErrText = '';
  let payload: {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  } | null = null;

  for (const candidateModel of candidates) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
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

    if (res.ok) {
      payload = (await res.json()) as typeof payload;
      break;
    }

    lastStatus = res.status;
    lastErrText = await res.text().catch(() => res.statusText);
    // Retry next fallback model only on 404 (not found/deprecated) or 503 (temporary overload)
    if (res.status !== 404 && res.status !== 503) {
      throw new Error(`Gemini API HTTP ${res.status}: ${lastErrText.slice(0, 220)}`);
    }
  }

  if (!payload) {
    throw new Error(`Gemini API HTTP ${lastStatus}: ${lastErrText.slice(0, 220)}`);
  }
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

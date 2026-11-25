/**
 * PaddleOcrEngine — fully offline Kannada + English PP-OCR recognition engine
 * implementing the existing OcrEngine interface plus batched full-page box recognition.
 */
import * as ort from 'onnxruntime-web';
import type { FieldType, OcrEngine, OcrResult, OcrScript } from '@/config/model';
import {
  ORT_CONFIG,
  REC_MODELS,
  buildCtcVocab,
  type RecModelSpec,
} from '@/config/ocrModels';
import {
  cropBoxFromImageData,
  detectTextBoxes,
  type DetectedBox,
} from '@/workers/pipeline/detect';

export interface RecognizedBoxResult {
  box: DetectedBox;
  text: string;
  confidence: number;
  script: OcrScript;
  model: string;
  cropDataUrl?: string;
}

export interface PipelineTimings {
  detLoadMs: number;
  recLoadMs: number;
  detectMs: number;
  recognizeMs: number;
  avgRecPerBoxMs: number;
  peakMemoryMB: number | null;
}

export interface FullPipelineOutput {
  results: RecognizedBoxResult[];
  timings: PipelineTimings;
}

interface LoadedRecModel {
  spec: RecModelSpec;
  session: ort.InferenceSession;
  vocab: string[];
}

let cachedModels: { kn: LoadedRecModel; en: LoadedRecModel; loadMs: number } | null = null;

export function detectDecodedScript(text: string): OcrScript {
  const hasKn = /[\u0C80-\u0CFF]/.test(text);
  const hasEn = /[A-Za-z]/.test(text);
  if (hasKn && hasEn) return 'mixed';
  if (hasKn) return 'kn';
  return 'en';
}

/**
 * Pure CTC greedy decoder exported for unit testing.
 * Handles both raw logits (applies softmax) and pre-softmax probabilities.
 */
export function ctcGreedyDecode(
  data: Float32Array,
  T: number,
  C: number,
  vocab: string[],
  blankIndex: number,
  isProbabilities: boolean,
): { text: string; confidence: number } {
  let text = '';
  let prevIdx = blankIndex;
  const charProbs: number[] = [];

  for (let t = 0; t < T; t++) {
    const offset = t * C;
    let bestIdx = 0;
    let bestProb = 0;

    if (isProbabilities) {
      for (let c = 0; c < C; c++) {
        const p = data[offset + c] ?? 0;
        if (p > bestProb) {
          bestProb = p;
          bestIdx = c;
        }
      }
    } else {
      let maxVal = -Infinity;
      for (let c = 0; c < C; c++) {
        const v = data[offset + c] ?? -Infinity;
        if (v > maxVal) maxVal = v;
      }
      let sum = 0;
      for (let c = 0; c < C; c++) {
        sum += Math.exp((data[offset + c] ?? -Infinity) - maxVal);
      }
      let maxLogitIdx = 0;
      let maxLogit = -Infinity;
      for (let c = 0; c < C; c++) {
        const v = data[offset + c] ?? -Infinity;
        if (v > maxLogit) {
          maxLogit = v;
          maxLogitIdx = c;
        }
      }
      bestIdx = maxLogitIdx;
      bestProb = sum > 0 ? Math.exp(maxLogit - maxVal) / sum : 0;
    }

    if (bestIdx !== blankIndex && bestIdx !== prevIdx) {
      const ch = vocab[bestIdx];
      if (ch !== undefined) {
        text += ch;
        charProbs.push(Math.max(bestProb, 1e-6));
      }
    }
    prevIdx = bestIdx;
  }

  const confidence =
    charProbs.length > 0
      ? Math.exp(charProbs.reduce((s, p) => s + Math.log(p), 0) / charProbs.length)
      : 0;

  return { text: text.trim(), confidence };
}

async function loadSingleRecModel(spec: RecModelSpec): Promise<LoadedRecModel> {
  const dictRes = await fetch(spec.dictPath);
  if (!dictRes.ok) {
    throw new Error(`Missing dictionary file ${spec.dictPath} (HTTP ${dictRes.status})`);
  }
  const dictText = await dictRes.text();
  const vocab = buildCtcVocab(dictText, spec);

  let lastErr: unknown = null;
  for (const provider of ORT_CONFIG.PROVIDERS) {
    try {
      const session = await ort.InferenceSession.create(spec.modelPath, {
        executionProviders: [provider],
      });
      return { spec, session, vocab };
    } catch (err) {
      lastErr = err;
      console.warn(`[PaddleRec:${spec.id}] Provider ${provider} failed:`, err);
    }
  }
  throw new Error(
    `Failed to load recognition model ${spec.modelPath}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

export async function getRecModels(): Promise<{ kn: LoadedRecModel; en: LoadedRecModel; loadMs: number }> {
  if (cachedModels) return cachedModels;
  const t0 = performance.now();
  // Note: ort.env.wasm is configured once in ocr.worker.ts at module load time.

  const [kn, en] = await Promise.all([
    loadSingleRecModel(REC_MODELS.kn),
    loadSingleRecModel(REC_MODELS.en),
  ]);
  const loadMs = Math.round(performance.now() - t0);
  cachedModels = { kn, en, loadMs };
  return cachedModels;
}

/** Resize crops to spec.inputHeight, pad to batch max width, BGR normalized [N, 3, H, W]. */
function preprocessRecBatch(crops: ImageData[], spec: RecModelSpec): ort.Tensor {
  const H = spec.inputHeight;
  const maxW = spec.maxWidth;
  const targetWidths = crops.map((c) => {
    const ratio = c.width / Math.max(1, c.height);
    return Math.max(8, Math.min(maxW, Math.round(H * ratio)));
  });
  const batchW = Math.max(...targetWidths, 32);
  const N = crops.length;
  const plane = H * batchW;
  const batchData = new Float32Array(N * 3 * plane);
  // Fill padding with 0.0 (neutral grey under (x - 0.5)/0.5)
  const [m0, m1, m2] = spec.mean;
  const [s0, s1, s2] = spec.std;

  for (let n = 0; n < N; n++) {
    const crop = crops[n]!;
    const tw = targetWidths[n]!;
    const srcCanvas = new OffscreenCanvas(crop.width, crop.height);
    srcCanvas.getContext('2d')!.putImageData(crop, 0, 0);

    const dstCanvas = new OffscreenCanvas(tw, H);
    const dctx = dstCanvas.getContext('2d')!;
    dctx.imageSmoothingEnabled = true;
    dctx.imageSmoothingQuality = 'high';
    dctx.drawImage(srcCanvas, 0, 0, crop.width, crop.height, 0, 0, tw, H);

    const px = dctx.getImageData(0, 0, tw, H).data;
    const baseOffset = n * 3 * plane;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < tw; x++) {
        const idx = (y * tw + x) * 4;
        const r = (px[idx] ?? 255) / 255;
        const g = (px[idx + 1] ?? 255) / 255;
        const b = (px[idx + 2] ?? 255) / 255;
        const outPos = y * batchW + x;
        batchData[baseOffset + outPos] = (b - m0) / s0;
        batchData[baseOffset + plane + outPos] = (g - m1) / s1;
        batchData[baseOffset + 2 * plane + outPos] = (r - m2) / s2;
      }
    }
  }

  return new ort.Tensor('float32', batchData, [N, 3, H, batchW]);
}

async function runRecBatch(
  crops: ImageData[],
  loaded: LoadedRecModel,
): Promise<Array<{ text: string; confidence: number }>> {
  if (crops.length === 0) return [];
  const tensor = preprocessRecBatch(crops, loaded.spec);
  let outTensor: ort.Tensor | undefined;
  try {
    const outputs = await loaded.session.run({ [loaded.spec.inputName]: tensor });
    outTensor = outputs[loaded.spec.outputName] ?? Object.values(outputs)[0];
    if (!outTensor) {
      throw new Error(`Recognition model ${loaded.spec.id} returned no output.`);
    }
    const dims = outTensor.dims;
    const N = Number(dims[0] ?? crops.length);
    const T = Number(dims[1] ?? 0);
    const C = Number(dims[2] ?? loaded.spec.numClasses);
    const raw = outTensor.data as Float32Array;
    const stride = T * C;
    const results: Array<{ text: string; confidence: number }> = [];
    for (let n = 0; n < N; n++) {
      const slice = raw.subarray(n * stride, (n + 1) * stride);
      results.push(
        ctcGreedyDecode(
          slice,
          T,
          C,
          loaded.vocab,
          loaded.spec.blankIndex,
          loaded.spec.outputIsProbabilities,
        ),
      );
    }
    return results;
  } finally {
    tensor.dispose();
    outTensor?.dispose();
  }
}

export class PaddleOcrEngine implements OcrEngine {
  private models: { kn: LoadedRecModel; en: LoadedRecModel; loadMs: number } | null = null;

  async init(): Promise<void> {
    this.models = await getRecModels();
  }

  async recognize(crop: ImageData, fieldType: FieldType): Promise<OcrResult> {
    if (!this.models) await this.init();
    const models = this.models!;

    if (fieldType === 'checkbox') {
      return this.recognizeCheckbox(crop);
    }

    // Numeric / date / phone fields route directly to Latin model
    if (fieldType === 'number' || fieldType === 'date' || fieldType === 'phone') {
      const [res] = await runRecBatch([crop], models.en);
      const text = res?.text ?? '';
      return {
        text,
        confidence: res?.confidence ?? 0,
        script: detectDecodedScript(text),
      };
    }

    // General text/name: run Kannada & Latin and pick higher confidence
    const [[knRes], [enRes]] = await Promise.all([
      runRecBatch([crop], models.kn),
      runRecBatch([crop], models.en),
    ]);
    const winner =
      (knRes?.confidence ?? 0) >= (enRes?.confidence ?? 0) && (knRes?.text.length ?? 0) > 0
        ? knRes
        : enRes;
    const text = winner?.text ?? '';
    return {
      text,
      confidence: winner?.confidence ?? 0,
      script: detectDecodedScript(text),
    };
  }

  /**
   * Full-page DBNet detection + width-bucketed small-batch Kannada & Latin recognition.
   */
  async detectAndRecognizePage(
    pageImage: ImageData,
    options?: {
      maxSideLen?: number;
      langMode?: 'eng+kan' | 'eng' | 'kan';
      onProgress?: (stage: string, done: number, total: number) => void;
    },
  ): Promise<FullPipelineOutput> {
    if (!this.models) await this.init();
    const models = this.models!;
    const langMode = options?.langMode ?? 'eng+kan';

    options?.onProgress?.('Detecting text…', 0, 1);
    const det = await detectTextBoxes(pageImage, options?.maxSideLen);

    const tRecStart = performance.now();
    const crops = det.boxes.map((b) => cropBoxFromImageData(pageImage, b.quad));

    // Bucket indices by quantized aspect-ratio width, process in small batches of 4
    const BATCH_SIZE = 4;
    const indices = det.boxes.map((_, i) => i);
    indices.sort((a, b) => {
      const ra = crops[a]!.crop.width / Math.max(1, crops[a]!.crop.height);
      const rb = crops[b]!.crop.width / Math.max(1, crops[b]!.crop.height);
      return ra - rb;
    });

    const results: RecognizedBoxResult[] = new Array(det.boxes.length);
    let processed = 0;

    for (let start = 0; start < indices.length; start += BATCH_SIZE) {
      const batchIdx = indices.slice(start, start + BATCH_SIZE);
      const batchCrops = batchIdx.map((i) => crops[i]!.crop);

      const knPreds =
        langMode === 'eng'
          ? batchCrops.map(() => ({ text: '', confidence: 0 }))
          : await runRecBatch(batchCrops, models.kn);
      const enPreds =
        langMode === 'kan'
          ? batchCrops.map(() => ({ text: '', confidence: 0 }))
          : await runRecBatch(batchCrops, models.en);

      for (let k = 0; k < batchIdx.length; k++) {
        const origIdx = batchIdx[k]!;
        const box = det.boxes[origIdx]!;
        const knP = knPreds[k]!;
        const enP = enPreds[k]!;

        let chosenText = '';
        let chosenConf = 0;
        let chosenModel = '';

        if (langMode === 'kan') {
          chosenText = knP.text;
          chosenConf = knP.confidence;
          chosenModel = models.kn.spec.id;
        } else if (langMode === 'eng') {
          chosenText = enP.text;
          chosenConf = enP.confidence;
          chosenModel = models.en.spec.id;
        } else {
          // Script routing: pick higher confidence non-empty prediction
          const knOk = knP.text.length > 0;
          const enOk = enP.text.length > 0;
          if (knOk && (!enOk || knP.confidence > enP.confidence)) {
            chosenText = knP.text;
            chosenConf = knP.confidence;
            chosenModel = models.kn.spec.id;
          } else {
            chosenText = enP.text;
            chosenConf = enP.confidence;
            chosenModel = models.en.spec.id;
          }
        }

        results[origIdx] = {
          box: { ...box, rotated90: crops[origIdx]!.rotated90 },
          text: chosenText,
          confidence: chosenConf,
          script: detectDecodedScript(chosenText),
          model: chosenModel,
        };
      }

      processed += batchIdx.length;
      options?.onProgress?.(`Reading box ${processed} of ${det.boxes.length}`, processed, det.boxes.length);
    }

    const recognizeMs = Math.round(performance.now() - tRecStart);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const peakMemoryMB = mem ? Math.round((mem.usedJSHeapSize / (1024 * 1024)) * 10) / 10 : null;

    return {
      results,
      timings: {
        detLoadMs: det.loadMs,
        recLoadMs: models.loadMs,
        detectMs: det.detectMs,
        recognizeMs,
        avgRecPerBoxMs: det.boxes.length > 0 ? Math.round(recognizeMs / det.boxes.length) : 0,
        peakMemoryMB,
      },
    };
  }

  private recognizeCheckbox(crop: ImageData): OcrResult {
    const x0 = Math.floor(crop.width * 0.22);
    const x1 = Math.ceil(crop.width * 0.78);
    const y0 = Math.floor(crop.height * 0.22);
    const y1 = Math.ceil(crop.height * 0.78);
    let dark = 0;
    let total = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * crop.width + x) * 4;
        const lum =
          (0.299 * (crop.data[idx] ?? 255) +
            0.587 * (crop.data[idx + 1] ?? 255) +
            0.114 * (crop.data[idx + 2] ?? 255)) /
          255;
        if (lum < 0.55) dark++;
        total++;
      }
    }
    const checked = total > 0 && dark / total > 0.08;
    return { text: checked ? 'yes' : 'no', confidence: 0.75, script: 'en' };
  }
}

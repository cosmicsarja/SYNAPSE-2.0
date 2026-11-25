/**
 * OnnxOcrEngine — on-device inference with onnxruntime-web.
 *
 * Model contract (see src/config/model.ts for the canonical spec):
 *   Input:  float32 [1, 1, 32, W]  — grayscale, normalized 0-1, height=32, width=variable
 *   Output: float32 [T, 1, C] or [1, T, C]  — CTC logits
 *   Blank:  index 0
 *   Chars:  /models/charset.json (array of strings)
 *
 * TODO (plug in when trained model is available):
 *   1. Verify input tensor name matches the exported ONNX model
 *      (check with Netron or model.inputNames[0])
 *   2. Verify output tensor name (model.outputNames[0])
 *   3. Adjust WIDTH_SCALE if model was trained with a different aspect ratio
 *   4. Adjust preprocessing if model was trained with mean/std normalization
 */
import * as ort from 'onnxruntime-web';
import { MODEL_CONFIG } from '@/config/model';
import type { OcrEngine, OcrResult, FieldType } from '@/config/model';

export class OnnxOcrEngine implements OcrEngine {
  private session: ort.InferenceSession | null = null;
  private charset: string[] = [];

  async init(): Promise<void> {
    // Set WASM path to local origin (never CDN)
    ort.env.wasm.wasmPaths = MODEL_CONFIG.WASM_PATH;
    ort.env.wasm.numThreads = 1; // single thread for reliability

    // Load charset
    const charsetRes = await fetch(MODEL_CONFIG.CHARSET_PATH);
    if (!charsetRes.ok) throw new Error('Failed to load charset.json');
    this.charset = await charsetRes.json() as string[];

    // Load ONNX model with provider fallback
    for (const provider of MODEL_CONFIG.PROVIDERS) {
      try {
        this.session = await ort.InferenceSession.create(MODEL_CONFIG.MODEL_PATH, {
          executionProviders: [provider],
        });
        console.log(`[OnnxOcrEngine] Loaded with provider: ${provider}`);
        return;
      } catch (err) {
        console.warn(`[OnnxOcrEngine] Provider ${provider} failed:`, err);
      }
    }
    throw new Error('All ONNX execution providers failed');
  }

  async recognize(crop: ImageData, fieldType: FieldType): Promise<OcrResult> {
    if (!this.session) throw new Error('OnnxOcrEngine not initialized');

    if (fieldType === 'checkbox') {
      return this.recognizeCheckbox(crop);
    }

    const tensor = preprocessImage(crop);
    // TODO: replace 'input' with actual input tensor name from the trained model
    const feeds: Record<string, ort.Tensor> = { input: tensor };
    const output = await this.session.run(feeds);

    // TODO: replace 'output' with actual output tensor name from the trained model
    const logits = output['output'] ?? Object.values(output)[0];
    if (!logits) throw new Error('No output tensor from model');

    return this.ctcDecode(logits);
  }

  private ctcDecode(logits: ort.Tensor): OcrResult {
    // logits shape: [T, 1, C] or [1, T, C]
    const dims = logits.dims;
    let T: number, C: number;

    if (dims.length === 3) {
      // Determine layout
      if (dims[1] === 1) {
        // [T, 1, C]
        T = dims[0] as number;
        C = dims[2] as number;
      } else {
        // [1, T, C]
        T = dims[1] as number;
        C = dims[2] as number;
      }
    } else {
      throw new Error(`Unexpected logits shape: ${dims.join('x')}`);
    }

    const data = logits.data as Float32Array;
    let text = '';
    let prevChar = MODEL_CONFIG.CTC_BLANK;
    const charConfidences: number[] = [];

    for (let t = 0; t < T; t++) {
      // Softmax over C for this time step
      const offset = t * C;
      let maxVal = -Infinity;
      for (let c = 0; c < C; c++) {
        const v = data[offset + c];
        if (v !== undefined && v > maxVal) maxVal = v;
      }
      let sum = 0;
      const probs = new Float32Array(C);
      for (let c = 0; c < C; c++) {
        const v = data[offset + c] ?? 0;
        probs[c] = Math.exp(v - maxVal);
        sum += probs[c] ?? 0;
      }
      for (let c = 0; c < C; c++) {
        probs[c] = (probs[c] ?? 0) / sum;
      }

      // Greedy: pick argmax
      let argmax = 0;
      let maxProb = 0;
      for (let c = 0; c < C; c++) {
        if ((probs[c] ?? 0) > maxProb) { maxProb = probs[c] ?? 0; argmax = c; }
      }

      if (argmax !== MODEL_CONFIG.CTC_BLANK && argmax !== prevChar) {
        const ch = this.charset[argmax];
        if (ch) {
          text += ch;
          charConfidences.push(maxProb);
        }
      }
      prevChar = argmax;
    }

    // Field confidence = geometric mean of per-character max probabilities
    const confidence = charConfidences.length > 0
      ? Math.exp(charConfidences.reduce((s, p) => s + Math.log(Math.max(p, 1e-10)), 0) / charConfidences.length)
      : 0;

    const script = detectScript(text);
    return { text, confidence, script };
  }

  /** Simple checkbox classifier: average grayscale brightness threshold. */
  private async recognizeCheckbox(crop: ImageData): Promise<OcrResult> {
    const data = crop.data;
    let totalBrightness = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      totalBrightness += (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    const avgBrightness = totalBrightness / (data.length / 4);
    // Checked boxes are darker (more ink)
    const isChecked = avgBrightness < 0.6;
    return {
      text: isChecked ? 'yes' : 'no',
      confidence: 0.75, // Heuristic
      script: 'en',
    };
  }
}

/**
 * Preprocess an ImageData region for the ONNX model.
 * See MODEL_CONFIG and README for the full contract.
 */
export function preprocessImage(crop: ImageData): ort.Tensor {
  const H = MODEL_CONFIG.INPUT_HEIGHT;
  const maxW = MODEL_CONFIG.MAX_WIDTH;

  // Convert to grayscale and resize
  const canvas = new OffscreenCanvas(crop.width, crop.height);
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
  ctx.putImageData(crop, 0, 0);

  // Calculate target width preserving aspect ratio (minimum 16px for VGG convs)
  const scale = H / Math.max(1, crop.height);
  const targetW = Math.max(16, Math.min(Math.round(crop.width * scale), maxW));

  const resized = new OffscreenCanvas(targetW, H);
  const rctx = resized.getContext('2d') as OffscreenCanvasRenderingContext2D;
  rctx.drawImage(canvas, 0, 0, targetW, H);

  const imageData = rctx.getImageData(0, 0, targetW, H);
  const floatData = new Float32Array(H * targetW);

  for (let i = 0; i < H * targetW; i++) {
    const idx = i * 4;
    const r = imageData.data[idx] ?? 0;
    const g = imageData.data[idx + 1] ?? 0;
    const b = imageData.data[idx + 2] ?? 0;
    const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    floatData[i] = (gray - 0.5) / 0.5;
  }

  return new ort.Tensor('float32', floatData, [1, 1, H, targetW]);
}

function detectScript(text: string): OcrResult['script'] {
  const hasKannada = /[\u0C80-\u0CFF]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  if (hasKannada && hasLatin) return 'mixed';
  if (hasKannada) return 'kn';
  return 'en';
}


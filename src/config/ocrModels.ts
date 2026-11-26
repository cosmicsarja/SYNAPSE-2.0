/**
 * Canonical PP-OCR ONNX model contracts derived from scripts/inspect_onnx.py.
 * Do NOT hardcode class counts, blank indices, or tensor names elsewhere —
 * always import from here.
 */

export const ORT_CONFIG = {
  /**
   * Provider order: use 'wasm' only so WebGPU init failure in a Worker
   * never poisons the global WASM init state.
   */
  PROVIDERS: ['wasm'] as const,
  WASM_PATH: '/ort/',
  /**
   * Pass an object with only `wasm` (omitting `mjs`) so onnxruntime-web/wasm
   * uses its bundled JS glue instead of dynamically importing `/ort/*.mjs`
   * (which Vite dev server blocks because `/public` files cannot be imported as modules).
   */
  WASM_PATHS: {
    wasm: '/ort/ort-wasm-simd-threaded.wasm',
  },
  NUM_THREADS: 1,
} as const;

export const DET_MODEL_CONFIG = {
  id: 'openocr-repvit-det',
  modelPath: '/models/openocr_det.v1.onnx',
  inputName: 'input',
  outputName: 'output',
  /** Input layout: [N=1, C=3, H, W], H & W must be multiples of 32. */
  channels: 3,
  channelOrder: 'BGR' as const,
  strideMultiple: 32,
  /** Longest side limit for detection (keeps RAM low on 2-3 GB phones). */
  maxSideLen: 960,
  /** ImageNet normalization applied after / 255.0 in BGR order: (x - mean) / std. */
  mean: [0.485, 0.456, 0.406] as const,
  std: [0.229, 0.224, 0.225] as const,
  /** Output is [1, 1, H, W] probability map in [0, 1]. */
  outputIsProbability: true,
  /** DBNet post-processing defaults */
  thresh: 0.3,
  boxThresh: 0.5,
  minBoxSize: 4,
  unclipRatio: 1.5,
  maxCandidates: 1000,
} as const;

export const PPOCR_DET_FALLBACK_CONFIG = {
  id: 'ppocrv4-mobile-det',
  modelPath: '/models/ppocrv4_det.v1.onnx',
  inputName: 'x',
  outputName: 'sigmoid_0.tmp_0',
} as const;

export interface RecModelSpec {
  readonly id: string;
  readonly scriptLabel: 'kn' | 'en';
  readonly modelPath: string;
  readonly dictPath: string;
  readonly inputName: string;
  readonly outputName: string;
  readonly inputHeight: number;
  readonly maxWidth: number;
  readonly channels: number;
  readonly channelOrder: 'BGR';
  /** Normalization: (pixel / 255.0 - mean) / std */
  readonly mean: readonly [number, number, number];
  readonly std: readonly [number, number, number];
  /** Output shape layout: [N, T, C] */
  readonly outputLayout: 'NTC';
  /** Inspected trailing Softmax: true -> outputs are already probabilities */
  readonly outputIsProbabilities: boolean;
  readonly blankIndex: number;
  /** Inspected output class count C from ONNX model */
  readonly numClasses: number;
  /** Inspected dictionary line count + 2 (index 0 = blank, last = space) */
  readonly expectedDictLines: number;
  readonly appendSpace: boolean;
}

export const REC_MODELS = {
  kn: {
    id: 'ppocrv4-kannada',
    scriptLabel: 'kn',
    modelPath: '/models/ppocrv4_rec_kannada.v1.onnx',
    dictPath: '/models/ppocrv4_dict_kannada.v1.txt',
    inputName: 'x',
    outputName: 'softmax_2.tmp_0',
    inputHeight: 48,
    maxWidth: 640,
    channels: 3,
    channelOrder: 'BGR',
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5],
    outputLayout: 'NTC',
    outputIsProbabilities: true,
    blankIndex: 0,
    numClasses: 155,
    expectedDictLines: 153,
    appendSpace: true,
  },
  en: {
    id: 'ppocrv5-latin',
    scriptLabel: 'en',
    modelPath: '/models/ppocrv5_rec_latin.v1.onnx',
    dictPath: '/models/ppocrv5_dict_latin.v1.txt',
    inputName: 'x',
    outputName: 'fetch_name_0',
    inputHeight: 48,
    maxWidth: 640,
    channels: 3,
    channelOrder: 'BGR',
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5],
    outputLayout: 'NTC',
    outputIsProbabilities: true,
    blankIndex: 0,
    numClasses: 504,
    expectedDictLines: 502,
    appendSpace: true,
  },
} as const satisfies Record<'kn' | 'en', RecModelSpec>;

export const CONFIDENCE_THRESHOLDS = {
  high: 0.85,
  medium: 0.60,
} as const;

/**
 * Builds the CTC vocabulary array from a PaddleOCR dictionary file and asserts
 * that its length matches the inspected model output class count C.
 */
export function buildCtcVocab(dictText: string, spec: RecModelSpec): string[] {
  const lines = dictText.replace(/\r\n/g, '\n').split('\n');
  // Trim trailing empty line caused by final newline in file
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const vocab: string[] = ['<blank>', ...lines];
  if (spec.appendSpace) {
    vocab.push(' ');
  }
  if (vocab.length !== spec.numClasses) {
    throw new Error(
      `Dictionary class count mismatch for ${spec.id}: expected ${spec.numClasses} classes (dict=${spec.expectedDictLines} + blank + space), got ${vocab.length} (dict lines=${lines.length}).`,
    );
  }
  return vocab;
}

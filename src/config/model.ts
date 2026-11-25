/**
 * FormLens Model Contract
 *
 * This file is the single source of truth for the ONNX model interface.
 * Both the web app and training code must agree on these values.
 *
 * Input tensor:
 *   name:  "input"
 *   dtype: float32
 *   shape: [1, 1, 32, W]   — batch=1, channels=1 (grayscale), height=32px fixed, width=variable
 *   range: [0.0, 1.0]       — pixel value / 255.0, NO further normalization
 *
 * Output tensor:
 *   name:  "output" (or first output of the model)
 *   shape: [T, 1, C] or [1, T, C]   — T = time steps, C = num_classes
 *   CTC blank index: 0
 *   Characters: /public/models/charset.json (index = class id, index 0 = blank)
 *
 * Preprocessing pipeline (see src/workers/onnx-engine.ts → preprocessImage):
 *   1. Crop the ImageData region for the field bounding box
 *   2. Convert to grayscale: gray = 0.299*R + 0.587*G + 0.114*B
 *   3. Resize height to MODEL_INPUT_HEIGHT (32px), preserve aspect ratio
 *   4. Normalize: float_pixel = pixel_value / 255.0
 *   5. Pad width to MODEL_MAX_WIDTH if needed (pad with 1.0 = white)
 *   6. Layout as [1, 1, H, W] float32 tensor
 */

export const MODEL_CONFIG = {
  /** Fixed input height in pixels. */
  INPUT_HEIGHT: 32,

  /** Maximum width — wider crops are scaled down before padding. */
  MAX_WIDTH: 512,

  /** ONNX model path (relative to origin, served from public/). */
  MODEL_PATH: '/models/ocr_crnn_int8.onnx',

  /** Character set path (array of strings, index = class id). */
  CHARSET_PATH: '/models/charset.json',

  /** CTC blank token index. */
  CTC_BLANK: 0,

  /** Preferred execution providers in priority order. */
  PROVIDERS: ['webgpu', 'wasm'] as const,

  /** WebGPU WASM fallback files are served from /ort/ (never from CDN). */
  WASM_PATH: '/ort/',
} as const;

export type OcrScript = 'kn' | 'en' | 'mixed';

export interface OcrResult {
  text: string;
  confidence: number;   // 0–1 geometric mean of per-character max probability
  script: OcrScript;
}

export type FieldType = 'text' | 'name' | 'date' | 'phone' | 'number' | 'checkbox';

export interface OcrEngine {
  init(): Promise<void>;
  recognize(crop: ImageData, fieldType: FieldType): Promise<OcrResult>;
}


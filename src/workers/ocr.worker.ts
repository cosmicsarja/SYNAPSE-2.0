/**
 * OCR Web Worker
 * All ONNX / PP-OCR inference runs here, off the main thread.
 *
 * IMPORTANT: ort.env.wasm must be configured ONCE before any InferenceSession.create()
 * call, and initWasm() must only ever succeed once per Worker lifetime.
 * We configure it here at module load time so the detection + recognition sessions
 * share the same already-initialized WASM runtime.
 */
import * as ort from 'onnxruntime-web';
import { ORT_CONFIG } from '@/config/ocrModels';
import { MockOcrEngine } from './mock-engine';
import { OnnxOcrEngine } from './onnx-engine';
import { PaddleOcrEngine } from './pipeline/paddle-engine';
import type { OcrEngine, FieldType } from '@/config/model';

// Configure ORT WASM once at module load — before any session is created.
ort.env.wasm.wasmPaths = ORT_CONFIG.WASM_PATH;
ort.env.wasm.numThreads = ORT_CONFIG.NUM_THREADS;

let engine: OcrEngine | null = null;
let paddleEngine: PaddleOcrEngine | null = null;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'init': {
      try {
        if (msg.engine === 'paddle') {
          if (!paddleEngine) paddleEngine = new PaddleOcrEngine();
          engine = paddleEngine;
        } else if (msg.engine === 'onnx') {
          engine = new OnnxOcrEngine();
        } else {
          engine = new MockOcrEngine();
        }
        await engine.init();
        self.postMessage({ type: 'init-done' });
      } catch (err) {
        self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }

    case 'recognize': {
      if (!engine) {
        self.postMessage({ type: 'error', id: msg.id, message: 'Engine not initialized' });
        return;
      }
      self.postMessage({ type: 'progress', fieldIndex: msg.fieldIndex, totalFields: msg.totalFields });
      try {
        const result = await engine.recognize(msg.imageData, msg.fieldType as FieldType);
        self.postMessage({ type: 'result', id: msg.id, ...result });
      } catch (err) {
        self.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }

    case 'detect-and-recognize': {
      try {
        if (!paddleEngine) {
          paddleEngine = new PaddleOcrEngine();
          await paddleEngine.init();
        }
        const out = await paddleEngine.detectAndRecognizePage(msg.imageData, {
          maxSideLen: msg.maxSideLen,
          langMode: msg.langMode,
          onProgress: (stage, done, total) => {
            self.postMessage({ type: 'pipeline-progress', id: msg.id, stage, done, total });
          },
        });
        self.postMessage({ type: 'pipeline-result', id: msg.id, ...out });
      } catch (err) {
        self.postMessage({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
      }
      break;
    }
  }
};

type WorkerMessage =
  | { type: 'init'; engine: 'mock' | 'onnx' | 'paddle' }
  | { type: 'recognize'; id: string; imageData: ImageData; fieldType: string; fieldIndex: number; totalFields: number }
  | { type: 'detect-and-recognize'; id: string; imageData: ImageData; maxSideLen?: number; langMode?: 'eng+kan' | 'eng' | 'kan' };

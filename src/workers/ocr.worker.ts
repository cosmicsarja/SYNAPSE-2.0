/**
 * OCR Web Worker
 * All inference runs here, off the main thread.
 *
 * Message protocol:
 *   → { type: 'init', engine: 'mock' | 'onnx' }
 *   ← { type: 'init-done' } | { type: 'error', message }
 *
 *   → { type: 'recognize', id: string, imageData: ImageData, fieldType: string, fieldIndex: number, totalFields: number }
 *   ← { type: 'progress', fieldIndex: number, totalFields: number }
 *   ← { type: 'result', id: string, text: string, confidence: number, script: string }
 *   ← { type: 'error', id: string, message: string }
 */

import { MockOcrEngine } from './mock-engine';
import { OnnxOcrEngine } from './onnx-engine';
import type { OcrEngine, FieldType } from '@/config/model';

let engine: OcrEngine | null = null;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'init': {
      try {
        engine = msg.engine === 'onnx' ? new OnnxOcrEngine() : new MockOcrEngine();
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
  }
};

// ─── Types ───────────────────────────────────────────────────────────────────

type WorkerMessage =
  | { type: 'init'; engine: 'mock' | 'onnx' }
  | { type: 'recognize'; id: string; imageData: ImageData; fieldType: string; fieldIndex: number; totalFields: number };


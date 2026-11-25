/**
 * React hook wrapping OCR inference (off the main thread via Web Workers).
 * Supports:
 *   - 'tesseract': Tesseract.js WASM worker (/tesseract/worker.min.js + /tessdata/)
 *   - 'onnx':      Custom CRNN ONNX model via ocr.worker.ts
 *   - 'mock':      Simulated demo engine via ocr.worker.ts
 */
import { useRef, useState, useCallback } from 'react';
import type { OcrResult, FieldType } from '@/config/model';
import type { OcrEngine } from '@/db/schema';
import {
  initTesseract,
  recognizeWithTesseract,
  recognizeFullPageWithTesseract,
  type FullPageOcrResult,
} from '@/workers/tesseract-engine';

export interface OcrProgress {
  fieldIndex: number;
  totalFields: number;
}

interface UseOcrWorkerReturn {
  ready: boolean;
  error: string | null;
  progress: OcrProgress | null;
  engineType: OcrEngine;
  initialize: (engine: OcrEngine) => Promise<void>;
  recognize: (params: RecognizeParams) => Promise<OcrResult>;
  recognizeFullPage: (imageData: ImageData) => Promise<FullPageOcrResult>;
}

interface RecognizeParams {
  imageData: ImageData;
  fieldType: FieldType;
  fieldIndex: number;
  totalFields: number;
}

export function useOcrWorker(): UseOcrWorkerReturn {
  const workerRef = useRef<Worker | null>(null);
  const engineRef = useRef<OcrEngine>('tesseract');
  const [engineType, setEngineType] = useState<OcrEngine>('tesseract');
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const pendingRef = useRef<Map<string, { resolve: (r: OcrResult) => void; reject: (e: Error) => void }>>(new Map());

  const handleMessage = useCallback((event: MessageEvent<WorkerResponse>) => {
    const msg = event.data;
    switch (msg.type) {
      case 'init-done':
        setReady(true);
        setError(null);
        break;
      case 'progress':
        setProgress({ fieldIndex: msg.fieldIndex, totalFields: msg.totalFields });
        break;
      case 'result': {
        const pending = pendingRef.current.get(msg.id);
        if (pending) {
          pending.resolve({ text: msg.text, confidence: msg.confidence, script: msg.script as OcrResult['script'] });
          pendingRef.current.delete(msg.id);
        }
        break;
      }
      case 'error': {
        if (msg.id) {
          const pending = pendingRef.current.get(msg.id);
          if (pending) {
            pending.reject(new Error(msg.message));
            pendingRef.current.delete(msg.id);
          }
        } else {
          setError(msg.message);
        }
        break;
      }
    }
  }, []);

  const initialize = useCallback(async (engine: OcrEngine) => {
    engineRef.current = engine;
    setEngineType(engine);
    setReady(false);
    setError(null);

    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    if (engine === 'tesseract') {
      try {
        await initTesseract();
        setReady(true);
        setError(null);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      }
    }

    const worker = new Worker(
      new URL('../../workers/ocr.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;
    worker.onmessage = handleMessage;
    worker.onerror = (e) => setError(e.message);

    await new Promise<void>((resolve, reject) => {
      const originalHandler = worker.onmessage;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'init-done') resolve();
        else if (event.data.type === 'error' && !('id' in event.data)) reject(new Error(event.data.message));
        if (originalHandler) originalHandler.call(worker, event);
      };
      worker.postMessage({ type: 'init', engine });
    });
  }, [handleMessage]);

  const recognize = useCallback(
    async ({ imageData, fieldType, fieldIndex, totalFields }: RecognizeParams): Promise<OcrResult> => {
      setProgress({ fieldIndex, totalFields });

      if (engineRef.current === 'tesseract') {
        return recognizeWithTesseract(imageData, fieldType);
      }

      if (!workerRef.current) return Promise.reject(new Error('Worker not initialized'));
      const id = `${Date.now()}-${Math.random()}`;
      return new Promise((resolve, reject) => {
        pendingRef.current.set(id, { resolve, reject });
        workerRef.current!.postMessage({ type: 'recognize', id, imageData, fieldType, fieldIndex, totalFields });
      });
    },
    [],
  );

  const recognizeFullPage = useCallback(
    async (imageData: ImageData): Promise<FullPageOcrResult> => {
      setProgress({ fieldIndex: 0, totalFields: 1 });
      return recognizeFullPageWithTesseract(imageData);
    },
    [],
  );

  return { ready, error, progress, engineType, initialize, recognize, recognizeFullPage };
}

type WorkerResponse =
  | { type: 'init-done' }
  | { type: 'progress'; fieldIndex: number; totalFields: number }
  | { type: 'result'; id: string; text: string; confidence: number; script: string }
  | { type: 'error'; id?: string; message: string };

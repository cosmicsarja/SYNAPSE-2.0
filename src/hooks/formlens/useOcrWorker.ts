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
  type OcrLangMode,
} from '@/workers/tesseract-engine';
import { recognizeWithCloudBackend, getCloudOcrUrl } from '@/workers/cloud-engine';
import type { FullPipelineOutput } from '@/workers/pipeline/paddle-engine';

export interface OcrProgress {
  fieldIndex: number;
  totalFields: number;
  stage?: string;
}

interface UseOcrWorkerReturn {
  ready: boolean;
  error: string | null;
  progress: OcrProgress | null;
  engineType: OcrEngine;
  initialize: (engine: OcrEngine, langMode?: OcrLangMode) => Promise<void>;
  recognize: (params: RecognizeParams) => Promise<OcrResult>;
  recognizeFullPage: (imageData: ImageData, langMode?: OcrLangMode) => Promise<FullPageOcrResult>;
  runPaddlePipeline: (
    imageData: ImageData,
    langMode?: OcrLangMode,
    maxSideLen?: number,
    onProgress?: (stage: string, done: number, total: number) => void,
  ) => Promise<FullPipelineOutput>;
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
  const pipelinePendingRef = useRef<
    Map<string, { resolve: (r: FullPipelineOutput) => void; reject: (e: Error) => void; onProgress?: (stage: string, done: number, total: number) => void }>
  >(new Map());

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
      case 'pipeline-progress': {
        setProgress({ fieldIndex: msg.done, totalFields: msg.total, stage: msg.stage });
        pipelinePendingRef.current.get(msg.id)?.onProgress?.(msg.stage, msg.done, msg.total);
        break;
      }
      case 'pipeline-result': {
        const pending = pipelinePendingRef.current.get(msg.id);
        if (pending) {
          pending.resolve({ results: msg.results, timings: msg.timings });
          pipelinePendingRef.current.delete(msg.id);
        }
        break;
      }
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
          const pPending = pipelinePendingRef.current.get(msg.id);
          if (pPending) {
            pPending.reject(new Error(msg.message));
            pipelinePendingRef.current.delete(msg.id);
          }
        } else {
          setError(msg.message);
        }
        break;
      }
    }
  }, []);

  const initialize = useCallback(async (engine: OcrEngine, langMode: OcrLangMode = 'eng+kan') => {
    engineRef.current = engine;
    setEngineType(engine);
    setReady(false);
    setError(null);

    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
    }

    if (engine === 'cloud') {
      const url = await getCloudOcrUrl();
      if (navigator.onLine && url) {
        setReady(true);
        setError(null);
        return;
      }
      // Offline or no URL configured -> prepare local Tesseract fallback
      try {
        await initTesseract(langMode);
        setReady(true);
        setError(null);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        throw err;
      }
    }

    if (engine === 'tesseract') {
      try {
        await initTesseract(langMode);
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
    async (imageData: ImageData, langMode: OcrLangMode = 'eng+kan'): Promise<FullPageOcrResult> => {
      setProgress({ fieldIndex: 0, totalFields: 1 });
      if (engineRef.current === 'cloud') {
        try {
          return await recognizeWithCloudBackend(imageData, langMode);
        } catch (err) {
          console.warn('[HybridOCR] Cloud OCR unavailable, falling back to offline Tesseract:', err);
        }
      }
      return recognizeFullPageWithTesseract(imageData, langMode);
    },
    [],
  );

  const runPaddlePipeline = useCallback(
    async (
      imageData: ImageData,
      langMode: OcrLangMode = 'eng+kan',
      maxSideLen?: number,
      onProgress?: (stage: string, done: number, total: number) => void,
    ): Promise<FullPipelineOutput> => {
      if (!workerRef.current) {
        return Promise.reject(new Error('Paddle worker not initialized'));
      }
      const id = `${Date.now()}-${Math.random()}`;
      return new Promise((resolve, reject) => {
        pipelinePendingRef.current.set(id, { resolve, reject, onProgress });
        workerRef.current!.postMessage({
          type: 'detect-and-recognize',
          id,
          imageData,
          maxSideLen,
          langMode,
        });
      });
    },
    [],
  );

  return { ready, error, progress, engineType, initialize, recognize, recognizeFullPage, runPaddlePipeline };
}

type WorkerResponse =
  | { type: 'init-done' }
  | { type: 'progress'; fieldIndex: number; totalFields: number }
  | { type: 'pipeline-progress'; id: string; stage: string; done: number; total: number }
  | { type: 'pipeline-result'; id: string; results: FullPipelineOutput['results']; timings: FullPipelineOutput['timings'] }
  | { type: 'result'; id: string; text: string; confidence: number; script: string }
  | { type: 'error'; id?: string; message: string };

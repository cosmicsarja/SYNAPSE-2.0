/**
 * Scan route — camera/image capture, perspective crop, Auto/Template mode switch,
 * offline PP-OCR detection + Kannada/English recognition, and Lens highlight overlay.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CameraCapture } from '@/components/formlens/CameraCapture';
import { ManualCrop } from '@/components/formlens/ManualCrop';
import { LensOverlay } from '@/components/formlens/LensOverlay';
import { BottomNav } from '@/components/formlens/BottomNav';
import { OfflineStatusBar } from '@/components/formlens/OfflineStatusBar';
import { useOcrWorker } from '@/hooks/formlens/useOcrWorker';
import {
  getSetting,
  setSetting,
  enqueueBatchItem,
  getBatchQueue,
  updateBatchItem,
  deleteBatchItem,
  resetStuckReadingBatchItems,
} from '@/db';
import type { BatchQueueItem, OcrEngine, ScanMode } from '@/db/schema';
import type { OcrLine, OcrLangMode } from '@/workers/tesseract-engine';
import type { PipelineTimings, RecognizedBoxResult } from '@/workers/pipeline/paddle-engine';
import {
  saveScannedForm,
  dataUrlToImageData,
} from '@/lib/formlens/saveScannedForm';
import {
  assessImageQuality,
  getQualityWarningMessages,
  type ImageQualityReport,
} from '@/lib/formlens/imageQuality';
import { QUALITY_MESSAGES } from '@/config/quality';

export const Route = createFileRoute('/scan')({
  head: () => ({ meta: [{ title: 'Scan – FormLens' }] }),
  component: ScanPage,
});

type ScanStep = 'camera' | 'quality-warning' | 'crop' | 'processing' | 'lens';
type CaptureMode = 'single' | 'batch';

function ScanPage() {
  const navigate = useNavigate();
  const { initialize, recognize, recognizeFullPage, runPaddlePipeline } = useOcrWorker();

  const [step, setStep] = useState<ScanStep>('camera');
  const [langMode, setLangMode] = useState<OcrLangMode>('eng+kan');
  const [scanMode, setScanMode] = useState<ScanMode>('auto');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('ration-card');
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedImageData, setCapturedImageData] = useState<ImageData | null>(null);

  const [lensImageUrl, setLensImageUrl] = useState<string | null>(null);
  const [lensImageData, setLensImageData] = useState<ImageData | null>(null);
  const [lines, setLines] = useState<OcrLine[]>([]);
  const [paddleBoxes, setPaddleBoxes] = useState<RecognizedBoxResult[] | null>(null);
  const [timings, setTimings] = useState<PipelineTimings | null>(null);
  const [fullText, setFullText] = useState('');
  const [statusMsg, setStatusMsg] = useState('Initializing on-device OCR…');
  const [progressPct, setProgressPct] = useState(15);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [qualityReport, setQualityReport] = useState<ImageQualityReport | null>(null);
  const [saving, setSaving] = useState(false);

  const [captureMode, setCaptureMode] = useState<CaptureMode>('single');
  const [ocrEngine, setOcrEngine] = useState<OcrEngine>('paddle');
  const [batchQueue, setBatchQueue] = useState<BatchQueueItem[]>([]);
  const [batchStageMsg, setBatchStageMsg] = useState<string>('');
  const batchProcessingRef = useRef(false);

  const refreshBatchQueue = useCallback(async () => {
    const items = await getBatchQueue();
    setBatchQueue(items);
    return items;
  }, []);

  const processBatchQueue = useCallback(async () => {
    if (batchProcessingRef.current) return;
    batchProcessingRef.current = true;
    try {
      while (true) {
        const items = await getBatchQueue();
        setBatchQueue(items);
        const next = items.find((it) => it.status === 'queued');
        if (!next || next.id === undefined) break;

        await updateBatchItem(next.id, { status: 'reading' });
        await refreshBatchQueue();
        setBatchStageMsg(`Reading page #${next.id}…`);

        try {
          const imgData = await dataUrlToImageData(next.imageDataUrl);
          const engine = await getSetting<OcrEngine>('ocr_engine', 'paddle');
          await initialize(engine, next.langMode);

          let boxes: Array<{
            bbox: { x0: number; y0: number; x1: number; y1: number };
            text: string;
            confidence: number;
            script?: 'kn' | 'en' | 'mixed';
            model?: string;
          }> = [];
          let itemTimings: PipelineTimings | null = null;

          if (engine === 'paddle') {
            const maxSide = await getSetting<number>('det_max_side', 960);
            const out = await runPaddlePipeline(imgData, next.langMode, maxSide, (stage) => {
              setBatchStageMsg(`#${next.id}: ${stage}`);
            });
            itemTimings = out.timings;
            boxes = out.results.map((r) => ({
              bbox: r.box.bbox,
              text: r.text,
              confidence: r.confidence,
              script: r.script,
              model: r.model,
            }));
          } else if (engine === 'tesseract' || engine === 'cloud' || engine === 'gemini') {
            const res = await recognizeFullPage(imgData, next.langMode);
            boxes = res.lines.map((l) => ({
              bbox: l.bbox,
              text: l.text,
              ...(l.label ? { label: l.label } : {}),
              confidence: l.confidence,
              script: l.language === 'kn' ? 'kn' : l.language === 'mixed' ? 'mixed' : 'en',
              model: engine,
            }));
          } else {
            const res = await recognize({
              imageData: imgData,
              fieldType: 'text',
              fieldIndex: 0,
              totalFields: 1,
            });
            boxes = res.text
              ? [{
                  bbox: { x0: 10, y0: 10, x1: imgData.width - 10, y1: Math.min(imgData.height - 10, 80) },
                  text: res.text,
                  confidence: res.confidence,
                  script: 'en',
                  model: engine,
                }]
              : [];
          }

          const formId = await saveScannedForm({
            imageData: imgData,
            imageDataUrl: next.imageDataUrl,
            boxes,
            scanMode: next.scanMode,
            selectedTemplateId: next.templateId,
            timings: itemTimings,
          });

          await updateBatchItem(next.id, { status: 'ready', formId });
        } catch (err) {
          await updateBatchItem(next.id, {
            status: 'failed',
            error: err instanceof Error ? err.message : 'Batch OCR failed',
          });
        }
        await refreshBatchQueue();
      }
    } finally {
      batchProcessingRef.current = false;
      setBatchStageMsg('');
    }
  }, [initialize, recognize, recognizeFullPage, refreshBatchQueue, runPaddlePipeline]);

  // Restore persisted scan mode, template choice & batch queue from Dexie (survives restarts)
  useEffect(() => {
    void getSetting<ScanMode>('scan_mode', 'auto').then(setScanMode);
    void getSetting<string>('selected_template', 'ration-card').then(setSelectedTemplateId);
    void getSetting<CaptureMode>('capture_mode', 'single').then(setCaptureMode);
    void getSetting<OcrEngine>('ocr_engine', 'paddle').then(setOcrEngine);
    void resetStuckReadingBatchItems()
      .then(() => refreshBatchQueue())
      .then((items) => {
        if (items.some((it) => it.status === 'queued')) {
          void processBatchQueue();
        }
      });
  }, [processBatchQueue, refreshBatchQueue]);

  const handleModeChange = (mode: ScanMode) => {
    setScanMode(mode);
    void setSetting('scan_mode', mode);
  };

  const handleTemplateChange = (id: string) => {
    setSelectedTemplateId(id);
    void setSetting('selected_template', id);
  };

  const runLensOcr = useCallback(async (croppedData: ImageData, croppedUrl: string, mode: OcrLangMode = langMode) => {
    setStep('processing');
    setOcrError(null);
    setProgressPct(10);
    setLensImageData(croppedData);
    setLensImageUrl(croppedUrl);
    setPaddleBoxes(null);
    setTimings(null);

    try {
      const engine = await getSetting<OcrEngine>('ocr_engine', 'paddle');
      setStatusMsg(
        engine === 'paddle'
          ? 'Loading offline PP-OCR detection + Kannada/English models…'
          : engine === 'gemini'
            ? 'Detecting & reading Kannada/English with Gemini AI…'
            : engine === 'tesseract'
              ? `Loading offline Tesseract OCR (${mode})…`
              : `Starting ${engine} OCR…`,
      );
      await initialize(engine, mode);

      if (engine === 'paddle') {
        const maxSide = await getSetting<number>('det_max_side', 960);
        const out = await runPaddlePipeline(croppedData, mode, maxSide, (stage, done, total) => {
          setStatusMsg(stage);
          setProgressPct(total > 0 ? Math.min(98, 20 + Math.round((done / total) * 78)) : 25);
        });
        const detectedLines: OcrLine[] = out.results.map((r) => ({
          text: r.text,
          confidence: r.confidence,
          language: r.script === 'kn' ? 'kn' : r.script === 'mixed' ? 'mixed' : 'en',
          bbox: r.box.bbox,
        }));
        setPaddleBoxes(out.results);
        setTimings(out.timings);
        setLines(detectedLines);
        setFullText(detectedLines.map((l) => l.text).filter(Boolean).join('\n'));
      } else if (engine === 'tesseract' || engine === 'cloud' || engine === 'gemini') {
        setStatusMsg(
          engine === 'gemini'
            ? 'Extracting text & bounding boxes with Gemini Vision…'
            : 'Reading text and numbers from image…',
        );
        setProgressPct(55);
        const res = await recognizeFullPage(croppedData, mode);
        setLines(res.lines);
        setFullText(res.fullText);
      } else {
        setStatusMsg('Running single-block recognition…');
        const res = await recognize({
          imageData: croppedData,
          fieldType: 'text',
          fieldIndex: 0,
          totalFields: 1,
        });
        setLines(
          res.text
            ? [{ text: res.text, confidence: res.confidence, bbox: { x0: 10, y0: 10, x1: croppedData.width - 10, y1: Math.min(croppedData.height - 10, 80) } }]
            : [],
        );
        setFullText(res.text);
      }

      setProgressPct(100);
      setStep('lens');
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'OCR failed');
      setStep('crop');
    }
  }, [initialize, recognize, recognizeFullPage, runPaddlePipeline, langMode]);

  const handleCapture = useCallback((imageData: ImageData, dataUrl: string) => {
    if (captureMode === 'batch') {
      void enqueueBatchItem({
        imageDataUrl: dataUrl,
        width: imageData.width,
        height: imageData.height,
        scanMode,
        templateId: selectedTemplateId,
        langMode,
      })
        .then(() => refreshBatchQueue())
        .then(() => processBatchQueue());
      return;
    }

    setCapturedImageData(imageData);
    setCapturedDataUrl(dataUrl);
    setOcrError(null);
    const report = assessImageQuality(imageData);
    if (report.hasIssue) {
      setQualityReport(report);
      setStep('quality-warning');
      return;
    }
    setQualityReport(null);
    // Auto-trigger detection immediately — skip the manual crop step
    void runLensOcr(imageData, dataUrl);
  }, [captureMode, langMode, processBatchQueue, refreshBatchQueue, runLensOcr, scanMode, selectedTemplateId]);

  const handleSkipCrop = useCallback(() => {
    if (!capturedImageData || !capturedDataUrl) return;
    void runLensOcr(capturedImageData, capturedDataUrl);
  }, [capturedImageData, capturedDataUrl, runLensOcr]);

  const handleSaveAndReview = async () => {
    if (!lensImageData || !lensImageUrl) return;
    setSaving(true);
    try {
      const boxes = (paddleBoxes ?? lines.map((l) => ({
        box: { bbox: l.bbox },
        text: l.text,
        label: l.label,
        confidence: l.confidence,
        script: (l.language === 'kn' ? 'kn' : l.language === 'mixed' ? 'mixed' : 'en') as 'kn' | 'en' | 'mixed',
        model: ocrEngine === 'gemini' ? 'gemini' : 'tesseract',
      }))).map((item) => ({
        bbox: item.box.bbox,
        text: item.text,
        ...('label' in item && item.label ? { label: item.label } : {}),
        confidence: item.confidence,
        script: item.script,
        model: item.model,
      }));

      const formId = await saveScannedForm({
        imageData: lensImageData,
        imageDataUrl: lensImageUrl,
        boxes,
        scanMode,
        selectedTemplateId,
        timings,
      });

      void navigate({ to: '/review/$id', params: { id: String(formId) } });
    } finally {
      setSaving(false);
    }
  };

  const resetToCamera = () => {
    setCapturedDataUrl(null);
    setCapturedImageData(null);
    setLensImageUrl(null);
    setLensImageData(null);
    setLines([]);
    setPaddleBoxes(null);
    setTimings(null);
    setFullText('');
    setOcrError(null);
    setQualityReport(null);
    setStep('camera');
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <OfflineStatusBar />

      {/* Step 1: Camera / Upload + Single/Batch Mode */}
      {step === 'camera' && (
        <div className="flex-1 relative flex flex-col min-h-0 pb-16">
          {/* Top mode & template bar */}
          <div className="bg-black/95 px-3 py-2 flex flex-wrap items-center justify-between gap-2 border-b border-white/10">
            <div className="flex rounded bg-white/10 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => {
                  setCaptureMode('single');
                  void setSetting('capture_mode', 'single');
                }}
                className={`rounded px-2.5 py-1 font-medium ${
                  captureMode === 'single' ? 'bg-primary text-primary-foreground' : 'text-white/80'
                }`}
              >
                Single
              </button>
              <button
                type="button"
                onClick={() => {
                  setCaptureMode('batch');
                  void setSetting('capture_mode', 'batch');
                }}
                className={`rounded px-2.5 py-1 font-medium ${
                  captureMode === 'batch' ? 'bg-primary text-primary-foreground' : 'text-white/80'
                }`}
              >
                Batch {batchQueue.length > 0 ? `(${batchQueue.length})` : ''}
              </button>
            </div>

            {captureMode === 'batch' && (
              <div className="flex items-center gap-1.5">
                <div className="flex rounded bg-white/10 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setOcrEngine('paddle');
                      void setSetting('ocr_engine', 'paddle');
                    }}
                    className={`rounded px-2 py-0.5 font-medium ${
                      ocrEngine !== 'gemini' ? 'bg-white text-black' : 'text-white/80'
                    }`}
                  >
                    Offline
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOcrEngine('gemini');
                      void setSetting('ocr_engine', 'gemini');
                    }}
                    className={`rounded px-2 py-0.5 font-medium ${
                      ocrEngine === 'gemini' ? 'bg-emerald-400 text-black' : 'text-white/80'
                    }`}
                  >
                    Gemini AI
                  </button>
                </div>
                <div className="flex rounded bg-white/10 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => handleModeChange('auto')}
                    className={`rounded px-2 py-0.5 font-medium ${
                      scanMode === 'auto' ? 'bg-white text-black' : 'text-white/80'
                    }`}
                  >
                    Auto
                  </button>
                  <button
                    type="button"
                    onClick={() => handleModeChange('template')}
                    className={`rounded px-2 py-0.5 font-medium ${
                      scanMode === 'template' ? 'bg-white text-black' : 'text-white/80'
                    }`}
                  >
                    Template
                  </button>
                </div>
                {scanMode === 'template' && (
                  <select
                    value={selectedTemplateId}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                    className="rounded bg-white/15 text-white text-xs px-2 py-1 border border-white/20"
                  >
                    <option value="ration-card" className="text-black">Ration Card</option>
                    <option value="income-certificate" className="text-black">Income Cert</option>
                  </select>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 relative">
            <CameraCapture
              onCapture={handleCapture}
              onCancel={resetToCamera}
              batchMode={captureMode === 'batch'}
              batchCount={batchQueue.filter((b) => b.status === 'queued' || b.status === 'reading').length}
            />
          </div>

          {/* Batch Queue & Ready for Review panel */}
          {captureMode === 'batch' && batchQueue.length > 0 && (
            <div className="max-h-60 overflow-y-auto border-t bg-background px-3 py-2.5 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold">
                  Batch Queue ({batchQueue.filter((i) => i.status === 'ready').length}/{batchQueue.length} ready)
                </span>
                {batchStageMsg && (
                  <span className="text-primary font-medium truncate max-w-[55%]">{batchStageMsg}</span>
                )}
              </div>

              {/* Progress list */}
              <div className="space-y-1.5">
                {batchQueue.map((item, idx) => (
                  <div
                    key={item.id ?? idx}
                    className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={item.imageDataUrl}
                        alt={`Batch page ${idx + 1}`}
                        className="h-8 w-8 rounded object-cover shrink-0 border"
                      />
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          Page {idx + 1} · {item.scanMode === 'template' ? item.templateId : 'auto'}
                        </div>
                        {item.error && (
                          <div className="text-[11px] text-red-600 truncate">{item.error}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          item.status === 'ready'
                            ? 'bg-green-100 text-green-800'
                            : item.status === 'reading'
                              ? 'bg-blue-100 text-blue-800'
                              : item.status === 'failed'
                                ? 'bg-red-100 text-red-800'
                                : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {item.status}
                      </span>
                      {item.status === 'failed' && item.id !== undefined && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          onClick={async () => {
                            await updateBatchItem(item.id!, { status: 'queued', error: '' });
                            await refreshBatchQueue();
                            void processBatchQueue();
                          }}
                        >
                          Retry
                        </Button>
                      )}
                      {item.status !== 'reading' && item.id !== undefined && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[11px] text-muted-foreground"
                          onClick={async () => {
                            await deleteBatchItem(item.id!);
                            await refreshBatchQueue();
                          }}
                        >
                          ×
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Ready for review list */}
              {batchQueue.some((i) => i.status === 'ready' && i.formId !== undefined) && (
                <div className="pt-1 border-t space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-green-700 dark:text-green-400">
                      Ready for review
                    </span>
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:underline"
                      onClick={async () => {
                        const readyIds = batchQueue
                          .filter((i) => i.status === 'ready' && i.id !== undefined)
                          .map((i) => i.id!);
                        await Promise.all(readyIds.map((id) => deleteBatchItem(id)));
                        await refreshBatchQueue();
                      }}
                    >
                      Clear ready
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {batchQueue
                      .filter((i) => i.status === 'ready' && i.formId !== undefined)
                      .map((item, idx) => (
                        <Button
                          key={item.id ?? idx}
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs"
                          onClick={() =>
                            void navigate({ to: '/review/$id', params: { id: String(item.formId!) } })
                          }
                        >
                          Review Form #{item.formId} →
                        </Button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <BottomNav />
        </div>
      )}

      {/* Step 1.5: Image Quality Warning */}
      {step === 'quality-warning' && capturedDataUrl && capturedImageData && qualityReport && (() => {
        const msg = getQualityWarningMessages(qualityReport);
        return (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 py-4">
            <div className="w-full max-w-sm overflow-hidden rounded-xl border bg-black/5">
              <img
                src={capturedDataUrl}
                alt="Captured form preview"
                className="max-h-60 w-full object-contain"
              />
            </div>

            <div className="max-w-sm text-center space-y-2">
              <div className="text-lg font-semibold text-amber-700 dark:text-amber-400">
                {msg.titleEn}
              </div>
              <div className="text-base font-medium text-amber-700/90 dark:text-amber-300">
                {msg.titleKn}
              </div>
              <p className="text-xs text-muted-foreground">
                {QUALITY_MESSAGES.hintEn}
                <br />
                {QUALITY_MESSAGES.hintKn}
              </p>
              <div className="flex justify-center gap-4 pt-1 text-xs text-muted-foreground font-mono">
                <span>Blur: {qualityReport.blurScore}</span>
                <span>Brightness: {qualityReport.brightnessScore}/255</span>
              </div>
            </div>

            <div className="flex w-full max-w-sm gap-3">
              <Button
                variant="outline"
                className="flex-1 h-auto py-2.5 flex-col gap-0.5"
                onClick={resetToCamera}
              >
                <span>{QUALITY_MESSAGES.retakeEn}</span>
                <span className="text-[11px] font-normal opacity-80">{QUALITY_MESSAGES.retakeKn}</span>
              </Button>
              <Button
                className="flex-1 h-auto py-2.5 flex-col gap-0.5"
                onClick={() => {
                  setQualityReport(null);
                  void runLensOcr(capturedImageData, capturedDataUrl);
                }}
              >
                <span>{QUALITY_MESSAGES.useAnywayEn}</span>
                <span className="text-[11px] font-normal opacity-80">{QUALITY_MESSAGES.useAnywayKn}</span>
              </Button>
            </div>
          </div>
        );
      })()}

      {/* Step 2: 4-corner perspective crop + Mode & Language selectors */}
      {step === 'crop' && capturedDataUrl && capturedImageData && (
        <div className="flex-1 relative flex flex-col min-h-0">
          <div className="bg-black px-3 pt-2 pb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1">
              {(
                [
                  { id: 'eng+kan' as const, label: 'EN + ಕನ್ನಡ' },
                  { id: 'eng' as const, label: 'English' },
                  { id: 'kan' as const, label: 'ಕನ್ನಡ' },
                ]
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setLangMode(m.id)}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    langMode === m.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-white/15 text-white hover:bg-white/25'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <div className="flex rounded bg-white/10 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => handleModeChange('auto')}
                  className={`rounded px-2 py-0.5 font-medium ${
                    scanMode === 'auto' ? 'bg-white text-black' : 'text-white/80'
                  }`}
                >
                  Auto
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange('template')}
                  className={`rounded px-2 py-0.5 font-medium ${
                    scanMode === 'template' ? 'bg-white text-black' : 'text-white/80'
                  }`}
                >
                  Template
                </button>
              </div>
              {scanMode === 'template' && (
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleTemplateChange(e.target.value)}
                  className="rounded bg-white/15 text-white text-xs px-2 py-1 border border-white/20"
                >
                  <option value="ration-card" className="text-black">Ration Card</option>
                  <option value="income-certificate" className="text-black">Income Cert</option>
                </select>
              )}
              <Button size="sm" variant="secondary" onClick={handleSkipCrop}>
                Scan Full Image →
              </Button>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <ManualCrop
              imageDataUrl={capturedDataUrl}
              imageData={capturedImageData}
              onCrop={(cropped, url) => void runLensOcr(cropped, url)}
              onCancel={resetToCamera}
            />
          </div>
          {ocrError && (
            <div className="absolute bottom-20 left-4 right-4 rounded-lg bg-red-100 border border-red-300 p-3 text-sm text-red-700">
              {ocrError}
            </div>
          )}
        </div>
      )}

      {/* Step 3: Processing */}
      {step === 'processing' && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <div className="text-center space-y-2">
            <div className="text-lg font-semibold">Scanning image…</div>
            <div className="text-sm text-muted-foreground">{statusMsg}</div>
          </div>
          <Progress value={progressPct} className="w-full max-w-xs h-2" />
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={() => setStep('crop')}
          >
            ← Adjust crop / Retake
          </Button>
        </div>
      )}

      {/* Step 4: Interactive Bounding-Box Overlay */}
      {step === 'lens' && lensImageUrl && lensImageData && (
        <LensOverlay
          imageDataUrl={lensImageUrl}
          imageWidth={lensImageData.width}
          imageHeight={lensImageData.height}
          lines={lines}
          fullText={fullText}
          onSaveAndReview={() => void handleSaveAndReview()}
          onRetake={resetToCamera}
          saving={saving}
        />
      )}
    </div>
  );
}

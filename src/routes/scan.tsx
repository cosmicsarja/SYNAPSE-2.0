/**
 * Scan route — camera/image capture, perspective crop, Auto/Template mode switch,
 * offline PP-OCR detection + Kannada/English recognition, and Lens highlight overlay.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CameraCapture } from '@/components/formlens/CameraCapture';
import { ManualCrop } from '@/components/formlens/ManualCrop';
import { LensOverlay } from '@/components/formlens/LensOverlay';
import { BottomNav } from '@/components/formlens/BottomNav';
import { OfflineStatusBar } from '@/components/formlens/OfflineStatusBar';
import { useOcrWorker } from '@/hooks/formlens/useOcrWorker';
import { getSetting, setSetting, saveFormWithFields } from '@/db';
import type { FormField, OcrEngine, ScanMode } from '@/db/schema';
import type { OcrLine, OcrLangMode } from '@/workers/tesseract-engine';
import type { PipelineTimings, RecognizedBoxResult } from '@/workers/pipeline/paddle-engine';
import {
  assignBoxesToTemplateFields,
  pairLabelsAndValues,
  type TemplateFieldDef,
} from '@/lib/formlens/boxAssignment';

export const Route = createFileRoute('/scan')({
  head: () => ({ meta: [{ title: 'Scan – FormLens' }] }),
  component: ScanPage,
});

type ScanStep = 'camera' | 'crop' | 'processing' | 'lens';

interface TemplateJson {
  id: string;
  name: string;
  fields: TemplateFieldDef[];
}

function inferFieldType(text: string): string {
  const digits = text.replace(/[\s\-()]/g, '');
  if (/(?:\+91)?[6-9]\d{9}/.test(digits)) return 'phone';
  if (/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/.test(text)) return 'date';
  if (/^\d[\d,.\s]*$/.test(text.trim())) return 'number';
  return 'text';
}

function cropBoxUrl(srcCanvas: HTMLCanvasElement, bbox: { x0: number; y0: number; x1: number; y1: number }): string {
  const x = Math.max(0, Math.floor(bbox.x0) - 4);
  const y = Math.max(0, Math.floor(bbox.y0) - 4);
  const w = Math.max(1, Math.min(srcCanvas.width - x, Math.ceil(bbox.x1) - x + 4));
  const h = Math.max(1, Math.min(srcCanvas.height - y, Math.ceil(bbox.y1) - y + 4));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);
  return out.toDataURL('image/jpeg', 0.78);
}

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
  const [saving, setSaving] = useState(false);

  // Restore persisted scan mode & template choice from Dexie
  useEffect(() => {
    void getSetting<ScanMode>('scan_mode', 'auto').then(setScanMode);
    void getSetting<string>('selected_template', 'ration-card').then(setSelectedTemplateId);
  }, []);

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
      } else if (engine === 'tesseract' || engine === 'cloud') {
        setStatusMsg('Reading text and numbers from image…');
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
    setCapturedImageData(imageData);
    setCapturedDataUrl(dataUrl);
    setOcrError(null);
    // Auto-trigger detection immediately — skip the manual crop step
    void runLensOcr(imageData, dataUrl);
  }, [runLensOcr]);

  const handleSkipCrop = useCallback(() => {
    if (!capturedImageData || !capturedDataUrl) return;
    void runLensOcr(capturedImageData, capturedDataUrl);
  }, [capturedImageData, capturedDataUrl, runLensOcr]);

  const handleSaveAndReview = async () => {
    if (!lensImageData || !lensImageUrl) return;
    setSaving(true);
    try {
      const srcCanvas = document.createElement('canvas');
      srcCanvas.width = lensImageData.width;
      srcCanvas.height = lensImageData.height;
      srcCanvas.getContext('2d')!.putImageData(lensImageData, 0, 0);

      const positionedBoxes = (paddleBoxes ?? lines.map((l) => ({
        box: { bbox: l.bbox },
        text: l.text,
        confidence: l.confidence,
        script: (l.language === 'kn' ? 'kn' : l.language === 'mixed' ? 'mixed' : 'en') as 'kn' | 'en' | 'mixed',
        model: 'tesseract',
      }))).map((item) => ({
        bbox: item.box.bbox,
        text: item.text,
        confidence: item.confidence,
        script: item.script,
        model: item.model,
        cropDataUrl: cropBoxUrl(srcCanvas, item.box.bbox),
      }));

      let fields: Omit<FormField, 'id' | 'formId'>[] = [];
      let templateId = 'auto-extract';
      let templateName = 'Auto Detect (Kannada + English)';

      if (scanMode === 'template') {
        const tplRes = await fetch(`/templates/${selectedTemplateId}.json`);
        if (!tplRes.ok) throw new Error(`Template /templates/${selectedTemplateId}.json not found`);
        const tpl = (await tplRes.json()) as TemplateJson;
        templateId = tpl.id;
        templateName = tpl.name;
        const assigned = assignBoxesToTemplateFields(
          positionedBoxes,
          tpl.fields,
          lensImageData.width,
          lensImageData.height,
        );
        fields = assigned.map((a) => ({
          fieldId: a.fieldId,
          labelEn: a.labelEn,
          labelKn: a.labelKn,
          fieldType: a.fieldType,
          textValue: a.textValue,
          originalText: a.originalText,
          confidence: a.confidence,
          wasEdited: false,
          normBbox: a.normBbox,
          category: 'template',
          cropDataUrl: a.boxIndices[0] !== undefined ? positionedBoxes[a.boxIndices[0]]?.cropDataUrl : undefined,
        }));
      } else {
        // Load known labels from both government templates for fuzzy label/value pairing
        const knownLabels: Array<{ id: string; labelEn: string; labelKn: string }> = [];
        for (const tid of ['ration-card', 'income-certificate']) {
          try {
            const res = await fetch(`/templates/${tid}.json`);
            if (res.ok) {
              const tpl = (await res.json()) as TemplateJson;
              for (const f of tpl.fields) {
                knownLabels.push({ id: f.id, labelEn: f.labelEn, labelKn: f.labelKn });
              }
            }
          } catch { /* ignore if offline and not cached */ }
        }
        const paired = pairLabelsAndValues(
          positionedBoxes,
          knownLabels,
          lensImageData.width,
          lensImageData.height,
        );
        fields = paired.map((p) => ({
          fieldId: p.fieldId,
          labelEn: p.labelEn,
          labelKn: p.labelKn,
          fieldType: inferFieldType(p.textValue),
          textValue: p.textValue,
          originalText: p.originalText,
          confidence: p.confidence,
          wasEdited: false,
          normBbox: p.normBbox,
          script: p.script,
          model: p.model,
          category: p.kind,
          cropDataUrl: p.cropDataUrl,
        }));
      }

      const avgConfidence =
        fields.length > 0
          ? fields.reduce((s, f) => s + f.confidence, 0) / fields.length
          : 0;

      const formId = await saveFormWithFields(
        {
          templateId,
          templateName,
          status: 'draft',
          avgConfidence,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          thumbnailDataUrl: lensImageUrl,
          imageDataUrl: lensImageUrl,
          imageWidth: lensImageData.width,
          imageHeight: lensImageData.height,
          scanMode,
          timingsJson: timings ? JSON.stringify(timings) : undefined,
        },
        fields,
      );

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
    setStep('camera');
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <OfflineStatusBar />

      {/* Step 1: Camera / Upload */}
      {step === 'camera' && (
        <div className="flex-1 relative min-h-0 pb-16">
          <CameraCapture
            onCapture={handleCapture}
            onCancel={resetToCamera}
          />
          <BottomNav />
        </div>
      )}

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

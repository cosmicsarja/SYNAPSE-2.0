/**
 * Scan route — Google Lens-style camera/image capture, crop, and on-device text highlighting.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CameraCapture } from '@/components/formlens/CameraCapture';
import { ManualCrop } from '@/components/formlens/ManualCrop';
import { LensOverlay } from '@/components/formlens/LensOverlay';
import { BottomNav } from '@/components/formlens/BottomNav';
import { OfflineStatusBar } from '@/components/formlens/OfflineStatusBar';
import { useOcrWorker } from '@/hooks/formlens/useOcrWorker';
import { getSetting, saveFormWithFields } from '@/db';
import type { FormField, OcrEngine } from '@/db/schema';
import type { OcrLine, OcrLangMode } from '@/workers/tesseract-engine';

export const Route = createFileRoute('/scan')({
  head: () => ({ meta: [{ title: 'Scan – FormLens' }] }),
  component: ScanPage,
});

type ScanStep = 'camera' | 'crop' | 'processing' | 'lens';

function inferFieldType(text: string): string {
  const digits = text.replace(/[\s\-()]/g, '');
  if (/(?:\+91)?[6-9]\d{9}/.test(digits)) return 'phone';
  if (/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/.test(text)) return 'date';
  if (/^\d[\d,.\s]*$/.test(text.trim())) return 'number';
  return 'text';
}

function cropLineUrl(srcCanvas: HTMLCanvasElement, line: OcrLine): string {
  const x = Math.max(0, line.bbox.x0 - 4);
  const y = Math.max(0, line.bbox.y0 - 4);
  const w = Math.max(1, Math.min(srcCanvas.width - x, line.bbox.x1 - line.bbox.x0 + 8));
  const h = Math.max(1, Math.min(srcCanvas.height - y, line.bbox.y1 - line.bbox.y0 + 8));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(srcCanvas, x, y, w, h, 0, 0, w, h);
  return out.toDataURL('image/jpeg', 0.75);
}

function ScanPage() {
  const navigate = useNavigate();
  const { initialize, recognize, recognizeFullPage } = useOcrWorker();

  const [step, setStep] = useState<ScanStep>('camera');
  const [langMode, setLangMode] = useState<OcrLangMode>('eng+kan');
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedImageData, setCapturedImageData] = useState<ImageData | null>(null);

  const [lensImageUrl, setLensImageUrl] = useState<string | null>(null);
  const [lensImageData, setLensImageData] = useState<ImageData | null>(null);
  const [lines, setLines] = useState<OcrLine[]>([]);
  const [fullText, setFullText] = useState('');
  const [statusMsg, setStatusMsg] = useState('Initializing on-device OCR…');
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleCapture = useCallback((imageData: ImageData, dataUrl: string) => {
    setCapturedImageData(imageData);
    setCapturedDataUrl(dataUrl);
    setOcrError(null);
    setStep('crop');
  }, []);

  const runLensOcr = useCallback(async (croppedData: ImageData, croppedUrl: string, mode: OcrLangMode = langMode) => {
    setStep('processing');
    setOcrError(null);
    setLensImageData(croppedData);
    setLensImageUrl(croppedUrl);

    try {
      const engine = await getSetting<OcrEngine>('ocr_engine', 'tesseract');
      setStatusMsg(
        engine === 'cloud'
          ? (navigator.onLine ? 'Sending to High-Accuracy OCR API…' : 'Offline — using local English + Kannada OCR…')
          : engine === 'tesseract'
            ? `Loading offline OCR (${mode})…`
            : `Starting ${engine} OCR…`,
      );
      await initialize(engine, mode);

      setStatusMsg('Reading text and numbers from image…');

      if (engine === 'tesseract' || engine === 'cloud') {
        const res = await recognizeFullPage(croppedData, mode);
        setLines(res.lines);
        setFullText(res.fullText);
      } else {
        // Fallback for ONNX / Mock engines: run single-block recognize
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

      setStep('lens');
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'OCR failed');
      setStep('crop');
    }
  }, [initialize, recognize, recognizeFullPage, langMode]);

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

      const fields: Omit<FormField, 'id' | 'formId'>[] = lines.map((line, i) => ({
        fieldId: `line_${i + 1}`,
        labelEn: `Detected Line ${i + 1}`,
        labelKn: `ಪತ್ತೆಯಾದ ಸಾಲು ${i + 1}`,
        fieldType: inferFieldType(line.text),
        textValue: line.text,
        originalText: line.text,
        confidence: line.confidence,
        wasEdited: false,
        cropDataUrl: cropLineUrl(srcCanvas, line),
      }));

      const avgConfidence =
        fields.length > 0
          ? fields.reduce((s, f) => s + f.confidence, 0) / fields.length
          : 0;

      const formId = await saveFormWithFields(
        {
          templateId: 'lens-scan',
          templateName: 'Lens Text Scan',
          status: 'draft',
          avgConfidence,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          thumbnailDataUrl: lensImageUrl,
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

      {/* Step 2: 4-corner perspective crop (with Skip Crop & script toggle) */}
      {step === 'crop' && capturedDataUrl && capturedImageData && (
        <div className="flex-1 relative flex flex-col min-h-0">
          <div className="bg-black px-3 pt-2 flex items-center justify-between gap-2">
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
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSkipCrop}
            >
              Scan Full Image →
            </Button>
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
          <Progress value={60} className="w-full max-w-xs h-2 animate-pulse" />
        </div>
      )}

      {/* Step 4: Google Lens-style highlight overlay */}
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

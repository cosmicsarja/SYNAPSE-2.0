/**
 * Scan route — camera capture, crop, template selection, and OCR dispatch.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CameraCapture } from '@/components/formlens/CameraCapture';
import { ManualCrop } from '@/components/formlens/ManualCrop';
import { TemplatePicker, type FormTemplate } from '@/components/formlens/TemplatePicker';
import { BottomNav } from '@/components/formlens/BottomNav';
import { OfflineStatusBar } from '@/components/formlens/OfflineStatusBar';
import { useOcrWorker } from '@/hooks/formlens/useOcrWorker';
import { getSetting, saveFormWithFields } from '@/db';
import type { FormField } from '@/db/schema';
import type { FieldType } from '@/config/model';
import { ChevronLeft } from 'lucide-react';

export const Route = createFileRoute('/scan')({
  head: () => ({ meta: [{ title: 'Scan – FormLens' }] }),
  component: ScanPage,
});

type ScanStep = 'template' | 'camera' | 'crop' | 'processing' | 'done';

function ScanPage() {
  const navigate = useNavigate();
  const { initialize, recognize, progress, ready } = useOcrWorker();

  const [step, setStep] = useState<ScanStep>('template');
  const [template, setTemplate] = useState<FormTemplate | null>(null);
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedImageData, setCapturedImageData] = useState<ImageData | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const handleTemplateSelect = (tpl: FormTemplate) => {
    setTemplate(tpl);
  };

  const handleStartCamera = async () => {
    if (!template) return;
    // Initialize OCR worker with current engine setting
    const engine = await getSetting<'mock' | 'onnx'>('ocr_engine', 'mock');
    try {
      await initialize(engine);
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'Failed to initialize OCR engine');
    }
    setStep('camera');
  };

  const handleCapture = useCallback((imageData: ImageData, dataUrl: string) => {
    setCapturedImageData(imageData);
    setCapturedDataUrl(dataUrl);
    setStep('crop');
  }, []);

  const handleCrop = useCallback(async (croppedData: ImageData, croppedUrl: string) => {
    if (!template || !ready) return;
    setStep('processing');
    setOcrError(null);

    try {
      const fields: Omit<FormField, 'id' | 'formId'>[] = [];
      let totalConfidence = 0;

      for (let i = 0; i < template.fields.length; i++) {
        const field = template.fields[i];
        if (!field) continue;

        // Crop to field bbox (percent of full image)
        const { x, y, w, h } = field.bbox;
        const fx = Math.round((x / 100) * croppedData.width);
        const fy = Math.round((y / 100) * croppedData.height);
        const fw = Math.round((w / 100) * croppedData.width);
        const fh = Math.round((h / 100) * croppedData.height);

        const fieldCanvas = document.createElement('canvas');
        fieldCanvas.width = Math.max(fw, 1);
        fieldCanvas.height = Math.max(fh, 1);
        const fctx = fieldCanvas.getContext('2d')!;
        // Draw from the full cropped canvas
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = croppedData.width;
        srcCanvas.height = croppedData.height;
        srcCanvas.getContext('2d')!.putImageData(croppedData, 0, 0);
        fctx.drawImage(srcCanvas, fx, fy, fw, fh, 0, 0, fw, fh);
        const fieldImageData = fctx.getImageData(0, 0, Math.max(fw, 1), Math.max(fh, 1));
        const fieldCropUrl = fieldCanvas.toDataURL('image/jpeg', 0.7);

        const result = await recognize({
          imageData: fieldImageData,
          fieldType: field.type as FieldType,
          fieldIndex: i,
          totalFields: template.fields.length,
        });

        totalConfidence += result.confidence;
        fields.push({
          fieldId: field.id,
          labelEn: field.labelEn,
          labelKn: field.labelKn,
          fieldType: field.type,
          textValue: result.text,
          originalText: result.text,
          confidence: result.confidence,
          wasEdited: false,
          cropDataUrl: fieldCropUrl,
        });
      }

      const avgConfidence = fields.length > 0 ? totalConfidence / fields.length : 0;

      const formId = await saveFormWithFields(
        {
          templateId: template.id,
          templateName: template.name,
          status: 'draft',
          avgConfidence,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          thumbnailDataUrl: croppedUrl,
        },
        fields,
      );

      setStep('done');
      void navigate({ to: '/review/$id', params: { id: String(formId) } });
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'OCR failed');
      setStep('crop'); // Go back to crop step
    }
  }, [template, ready, recognize, navigate]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <OfflineStatusBar />

      {/* Template selection step */}
      {step === 'template' && (
        <>
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <h1 className="font-semibold text-lg flex-1">Scan Form</h1>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 pb-24">
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground mb-3">SELECT TEMPLATE</h2>
              <TemplatePicker
                selected={template?.id}
                onSelect={handleTemplateSelect}
              />
            </div>
            {template && (
              <Button onClick={handleStartCamera} className="w-full h-12 text-base" size="lg">
                Continue with "{template.name}" →
              </Button>
            )}
          </div>
          <BottomNav />
        </>
      )}

      {/* Camera step */}
      {step === 'camera' && capturedDataUrl === null && (
        <div className="flex-1 relative">
          <button
            onClick={() => setStep('template')}
            className="absolute top-3 left-3 z-10 rounded-full bg-black/50 p-1.5 text-white"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <CameraCapture
            onCapture={handleCapture}
            onCancel={() => setStep('template')}
          />
        </div>
      )}

      {/* Crop step */}
      {step === 'crop' && capturedDataUrl && capturedImageData && (
        <div className="flex-1 relative">
          <ManualCrop
            imageDataUrl={capturedDataUrl}
            imageData={capturedImageData}
            onCrop={(cropped, url) => void handleCrop(cropped, url)}
            onCancel={() => setStep('camera')}
          />
          {ocrError && (
            <div className="absolute bottom-20 left-4 right-4 rounded-lg bg-red-100 border border-red-300 p-3 text-sm text-red-700">
              {ocrError}
            </div>
          )}
        </div>
      )}

      {/* Processing / OCR progress */}
      {step === 'processing' && template && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <div className="text-center space-y-2">
            <div className="text-lg font-semibold">Reading form…</div>
            {progress && (
              <div className="text-sm text-muted-foreground">
                Reading field {progress.fieldIndex + 1} of {progress.totalFields}
              </div>
            )}
          </div>
          <Progress
            value={progress ? ((progress.fieldIndex + 1) / progress.totalFields) * 100 : 0}
            className="w-full max-w-xs h-2"
          />
        </div>
      )}
    </div>
  );
}

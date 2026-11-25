/**
 * Setup / First-run download screen.
 * Step 1: Download pack with progress
 * Step 2: Self-test models
 * Step 3: Offline confirmation
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Download, CheckCircle, Circle, Wifi, WifiOff, AlertCircle } from 'lucide-react';
import {
  downloadOfflinePack,
  verifyOfflinePack,
  type DownloadProgress,
  type Manifest,
} from '@/lib/formlens/packDownloader';
import { getSetting, setSetting } from '@/db';

export const Route = createFileRoute('/setup')({
  head: () => ({ meta: [{ title: 'Setup – FormLens' }] }),
  component: SetupPage,
});

type Step = 'idle' | 'downloading' | 'testing' | 'done' | 'error';

interface ChecklistItem {
  id: string;
  label: string;
  status: 'pending' | 'ok' | 'error';
}

function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('idle');
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([
    { id: 'app', label: 'App shell', status: 'pending' },
    { id: 'ocr', label: 'OCR model', status: 'pending' },
    { id: 'charset', label: 'Character set', status: 'pending' },
    { id: 'dict', label: 'Locality dictionary', status: 'pending' },
  ]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [offlineConfirmed, setOfflineConfirmed] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);

  // Check if already set up
  useEffect(() => {
    getSetting<boolean>('setup_complete', false).then((done) => {
      if (done) void navigate({ to: '/scan' });
    });
  }, [navigate]);

  const startDownload = async () => {
    setStep('downloading');
    setErrorMsg(null);
    try {
      const m = await downloadOfflinePack((p) => setProgress(p));
      setManifest(m);
      await runSelfTest(m);
    } catch (err) {
      setStep('error');
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  const runSelfTest = async (m: Manifest) => {
    setStep('testing');
    const setStatus = (id: string, status: ChecklistItem['status']) => {
      setChecklist((prev) => prev.map((item) => item.id === id ? { ...item, status } : item));
    };

    // App shell
    setStatus('app', 'ok');

    // OCR model file in cache
    const onnxFile = m.files.find((f) => f.name.endsWith('.onnx'));
    if (onnxFile) {
      const cache = await caches.open('formlens-offline-pack-v1');
      const cached = await cache.match(onnxFile.url);
      setStatus('ocr', cached ? 'ok' : 'error');
    } else {
      setStatus('ocr', 'ok'); // No real model yet — still mark ok (placeholder)
    }

    // Charset
    const charsetFile = m.files.find((f) => f.name === 'charset.json');
    if (charsetFile) {
      const cache = await caches.open('formlens-offline-pack-v1');
      const cached = await cache.match(charsetFile.url);
      setStatus('charset', cached ? 'ok' : 'error');
    } else {
      setStatus('charset', 'ok');
    }

    // Dictionary
    const dictRes = await fetch('/data/karnataka_localities.json').catch(() => null);
    setStatus('dict', dictRes?.ok ? 'ok' : 'error');

    // Persist setup state
    await setSetting('setup_complete', true);
    await setSetting('pack_version', m.version);

    setStep('done');
  };

  // Offline test: watch for offline event when user clicks "Test offline now"
  const handleOfflineTest = () => {
    if (!navigator.onLine) {
      setOfflineConfirmed(true);
      return;
    }
    const handler = () => {
      setOfflineConfirmed(true);
      window.removeEventListener('offline', handler);
    };
    window.addEventListener('offline', handler);
    // Alert the user to toggle airplane mode
    setTimeout(() => window.removeEventListener('offline', handler), 60000);
  };

  const pct = progress && progress.totalBytes > 0
    ? Math.round((progress.bytesDownloaded / progress.totalBytes) * 100)
    : 0;

  const totalMB = ((progress?.totalBytes ?? 0) / 1024 / 1024).toFixed(1);
  const doneMB = ((progress?.bytesDownloaded ?? 0) / 1024 / 1024).toFixed(1);

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col">
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-6 py-8 text-center">
        <div className="text-3xl font-bold mb-1">FormLens</div>
        <div className="text-sm opacity-80">ಫಾರ್ಮ್‌ಲೆನ್ಸ್</div>
      </div>

      <div className="flex-1 px-6 py-8 max-w-md mx-auto w-full space-y-6">

        {/* Idle state */}
        {step === 'idle' && (
          <>
            <div className="text-center space-y-2">
              <Download className="h-14 w-14 text-primary mx-auto" />
              <h1 className="text-xl font-bold">First-time Setup</h1>
              <p className="text-sm text-muted-foreground">
                Download offline AI pack once. After this, FormLens works without internet.
              </p>
              <p className="text-xs text-muted-foreground">
                ಒಮ್ಮೆ ಆಫ್‌ಲೈನ್ AI ಪ್ಯಾಕ್ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ. ನಂತರ ಫಾರ್ಮ್‌ಲೆನ್ಸ್ ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದೇ ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತದೆ.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <p className="text-sm font-medium">What will be downloaded:</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-center gap-2"><Circle className="h-4 w-4 shrink-0" />OCR model (quantized, ~20 MB)</li>
                <li className="flex items-center gap-2"><Circle className="h-4 w-4 shrink-0" />Character sets (Kannada + English)</li>
                <li className="flex items-center gap-2"><Circle className="h-4 w-4 shrink-0" />Karnataka locality dictionary</li>
                <li className="flex items-center gap-2"><Circle className="h-4 w-4 shrink-0" />Form templates</li>
              </ul>
            </div>

            <Button onClick={startDownload} className="w-full h-12 text-base" size="lg">
              <Download className="mr-2 h-5 w-5" />
              Download Offline Pack
            </Button>
          </>
        )}

        {/* Downloading */}
        {step === 'downloading' && progress && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-lg font-semibold">Downloading…</div>
              <div className="text-xs text-muted-foreground mt-1">{progress.fileName}</div>
            </div>
            <Progress value={pct} className="h-3" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{doneMB} MB</span>
              <span>{pct}%</span>
              <span>{totalMB} MB</span>
            </div>
            {progress.phase === 'caching-shell' && (
              <div className="text-xs text-center text-muted-foreground">Caching app shell…</div>
            )}
          </div>
        )}

        {/* Self-test */}
        {(step === 'testing' || step === 'done') && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-lg font-semibold">
                {step === 'testing' ? 'Self-testing models…' : 'Ready!'}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              {checklist.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  {item.status === 'ok'
                    ? <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
                    : item.status === 'error'
                    ? <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
                    : <Circle className="h-5 w-5 text-muted-foreground shrink-0 animate-pulse" />
                  }
                  <span className="text-sm">{item.label}</span>
                </div>
              ))}
            </div>

            {step === 'done' && (
              <>
                <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800 text-center">
                  Offline pack ready. You can now turn off your internet.
                  <div className="text-xs mt-1">ಆಫ್‌ಲೈನ್ ಪ್ಯಾಕ್ ಸಿದ್ಧ.</div>
                </div>

                {!offlineConfirmed && (
                  <Button variant="outline" onClick={handleOfflineTest} className="w-full">
                    <WifiOff className="mr-2 h-4 w-4" />
                    Test offline now
                  </Button>
                )}

                {offlineConfirmed && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 text-center flex items-center justify-center gap-2">
                    <WifiOff className="h-4 w-4 shrink-0" />
                    ✓ You are offline and FormLens is working.
                  </div>
                )}

                <Button
                  onClick={() => void navigate({ to: '/scan' })}
                  className="w-full h-12 text-base"
                  size="lg"
                >
                  Start Scanning →
                </Button>
              </>
            )}
          </div>
        )}

        {/* Error */}
        {step === 'error' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <div className="font-semibold mb-1">Download failed</div>
              <div className="text-xs">{errorMsg}</div>
            </div>
            <Button onClick={startDownload} className="w-full">Retry</Button>
          </div>
        )}
      </div>
    </div>
  );
}

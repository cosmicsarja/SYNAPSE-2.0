/**
 * Settings route.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { BottomNav } from '@/components/formlens/BottomNav';
import { OfflineStatusBar } from '@/components/formlens/OfflineStatusBar';
import { OnlineIndicator } from '@/components/formlens/OfflineStatusBar';
import { InstallBanner } from '@/components/formlens/InstallBanner';
import { useStorageEstimate } from '@/hooks/formlens/useStorageEstimate';
import { useOcrWorker } from '@/hooks/formlens/useOcrWorker';
import { runDiagnosticsBenchmark, type BenchPageResult } from '@/lib/formlens/benchmark';
import { exportCorrectionsDataset } from '@/lib/formlens/corrections';
import type { PipelineTimings } from '@/workers/pipeline/paddle-engine';
import { hasEnvGeminiKey, testGeminiConnection } from '@/workers/gemini-engine';
import { getSetting, setSetting, getCorrectionCount, clearCorrections, db } from '@/db';
import type { OcrEngine } from '@/db/schema';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Download, HardDrive, Cpu, Languages, Cloud, Info, ExternalLink, Activity } from 'lucide-react';

export const Route = createFileRoute('/settings')({
  head: () => ({ meta: [{ title: 'Settings – FormLens' }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const storage = useStorageEstimate();
  const { initialize, runPaddlePipeline } = useOcrWorker();
  const [ocrEngine, setOcrEngine] = useState<OcrEngine>('paddle');
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudTestStatus, setCloudTestStatus] = useState<string | null>(null);
  const [geminiKey, setGeminiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');
  const [geminiTestStatus, setGeminiTestStatus] = useState<string | null>(null);
  const [language, setLanguage] = useState<'en' | 'kn'>('en');
  const [packVersion, setPackVersion] = useState<string | null>(null);
  const [setupComplete, setSetupComplete] = useState(false);
  const [clearingForms, setClearingForms] = useState(false);
  const [redownloading, setRedownloading] = useState(false);
  const [detMaxSide, setDetMaxSide] = useState<number>(960);
  const [lastTimings, setLastTimings] = useState<PipelineTimings | null>(null);
  const [benchResults, setBenchResults] = useState<BenchPageResult[] | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);
  const [benchError, setBenchError] = useState<string | null>(null);
  const [correctionCount, setCorrectionCount] = useState<number>(0);
  const [exportingCorrections, setExportingCorrections] = useState(false);
  const [clearingCorrections, setClearingCorrections] = useState(false);

  useEffect(() => {
    Promise.all([
      getSetting<OcrEngine>('ocr_engine', 'paddle'),
      getSetting<string>('cloud_ocr_url', (import.meta.env.VITE_OCR_API_URL as string | undefined) ?? ''),
      getSetting<'en' | 'kn'>('language', 'en'),
      getSetting<string | null>('pack_version', null),
      getSetting<boolean>('setup_complete', false),
      getSetting<number>('det_max_side', 960),
      db.forms.orderBy('createdAt').reverse().first(),
      getCorrectionCount(),
      getSetting<string>('gemini_api_key', ''),
      getSetting<string>('gemini_model', (import.meta.env.VITE_GEMINI_MODEL as string | undefined) || 'gemini-2.5-flash'),
    ]).then(([eng, url, lang, ver, setup, maxSide, latestForm, corrCount, gKey, gModel]) => {
      setOcrEngine(eng);
      setCloudUrl(url);
      setLanguage(lang);
      setPackVersion(ver);
      setSetupComplete(setup);
      setDetMaxSide(maxSide);
      setCorrectionCount(corrCount);
      setGeminiKey(gKey);
      setGeminiModel(gModel);
      if (latestForm?.timingsJson) {
        try {
          setLastTimings(JSON.parse(latestForm.timingsJson) as PipelineTimings);
        } catch { /* ignore */ }
      }
    });
  }, []);

  const handleRunBenchmark = async () => {
    setBenchRunning(true);
    setBenchError(null);
    try {
      await initialize('paddle', 'eng+kan');
      const res = await runDiagnosticsBenchmark((img) =>
        runPaddlePipeline(img, 'eng+kan', detMaxSide),
      );
      setBenchResults(res);
      if (res[0]) setLastTimings(res[0].timings);
    } catch (err) {
      setBenchError(err instanceof Error ? err.message : String(err));
    } finally {
      setBenchRunning(false);
    }
  };

  const handleEngineSelect = async (engine: OcrEngine) => {
    setOcrEngine(engine);
    await setSetting('ocr_engine', engine);
  };

  const handleCloudUrlChange = async (val: string) => {
    setCloudUrl(val);
    setCloudTestStatus(null);
    await setSetting('cloud_ocr_url', val.trim());
  };

  const handleTestCloud = async () => {
    const base = cloudUrl.trim().replace(/\/$/, '');
    if (!base) {
      setCloudTestStatus('Enter your FastAPI URL first');
      return;
    }
    setCloudTestStatus('Testing…');
    try {
      const res = await fetch(`${base}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { status?: string };
      setCloudTestStatus(`✓ Connected (${data.status ?? 'ok'})`);
    } catch (err) {
      setCloudTestStatus(`✗ Failed: ${err instanceof Error ? err.message : 'unreachable'}`);
    }
  };

  const handleTestGemini = async () => {
    setGeminiTestStatus('Testing…');
    const res = await testGeminiConnection(geminiKey, geminiModel);
    setGeminiTestStatus(res.ok ? `✓ ${res.message}` : `✗ ${res.message}`);
  };

  const handleLanguageToggle = async (useKn: boolean) => {
    const lang = useKn ? 'kn' : 'en';
    setLanguage(lang);
    await setSetting('language', lang);
  };

  const handleClearForms = async () => {
    setClearingForms(true);
    try {
      const allForms = await db.forms.toArray();
      for (const form of allForms) {
        if (form.id !== undefined) {
          await db.formFields.where('formId').equals(form.id).delete();
          await db.syncQueue.where('formId').equals(form.id).delete();
        }
      }
      await db.forms.clear();
    } finally {
      setClearingForms(false);
    }
  };

  const handleRedownload = async () => {
    setRedownloading(true);
    await setSetting('setup_complete', false);
    // Navigate to setup
    window.location.href = '/setup';
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      <OfflineStatusBar />

      <div className="border-b px-4 py-3 flex items-center justify-between">
        <h1 className="font-bold text-lg">Settings</h1>
        <OnlineIndicator />
      </div>

      <div className="flex-1 overflow-y-auto pb-24">

        {/* Install prompt */}
        <InstallBanner variant="card" className="mx-4 mt-4" />
        <div className="px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={() => { window.location.href = '/install'; }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Get shareable install link / QR code
          </Button>
        </div>
        <Separator />

        {/* Offline Pack */}
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Download className="h-4 w-4" />
            OFFLINE PACK
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <span className={setupComplete ? 'text-green-600 font-medium' : 'text-amber-600 font-medium'}>
                {setupComplete ? '✓ Ready' : 'Not downloaded'}
              </span>
            </div>
            {packVersion && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Version</span>
                <span className="font-mono text-xs">{packVersion}</span>
              </div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={redownloading}
            onClick={handleRedownload}
          >
            <Download className="mr-2 h-4 w-4" />
            Re-download Pack
          </Button>
        </div>

        <Separator />

        {/* Storage */}
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <HardDrive className="h-4 w-4" />
            STORAGE
          </div>
          {storage ? (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Used</span>
                <span>{storage.usageMB} MB of {storage.quotaMB} MB ({storage.percent}%)</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${storage.percent}%` }} />
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Calculating…</div>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="w-full text-destructive border-destructive/30 hover:bg-destructive/5">
                Clear All Saved Forms
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear all forms?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all saved forms from this device. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleClearForms}
                  disabled={clearingForms}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {clearingForms ? 'Clearing…' : 'Clear All'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Separator />

        {/* OCR Engine */}
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Cpu className="h-4 w-4" />
            OCR ENGINE
          </div>
          <div className="grid gap-2">
            {(
              [
                {
                  id: 'paddle' as const,
                  title: 'PP-OCRv4/v5 Offline (Auto Detect + ಕನ್ನಡ/EN)',
                  desc: 'Recommended offline: on-device DBNet text detection + Kannada & Latin ONNX recognition',
                },
                {
                  id: 'gemini' as const,
                  title: 'Gemini Vision AI (Online + Editable JSON/PDF)',
                  desc: 'High-accuracy Kannada + English printed & handwritten OCR using VITE_GEMINI_API_KEY when online',
                },
                {
                  id: 'tesseract' as const,
                  title: 'Tesseract Offline (English + Kannada)',
                  desc: 'Legacy WASM LSTM fallback',
                },
                {
                  id: 'cloud' as const,
                  title: 'Hybrid Cloud + Offline OCR',
                  desc: 'Uses Python Handwritten-Form-OCR API when online, falls back to offline OCR',
                },
                {
                  id: 'onnx' as const,
                  title: 'Custom ONNX Model',
                  desc: 'Uses /models/ocr_crnn_int8.onnx (requires trained model)',
                },
                {
                  id: 'mock' as const,
                  title: 'Demo / Mock Mode',
                  desc: 'Returns sample text without reading the image',
                },
              ]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => void handleEngineSelect(opt.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  ocrEngine === opt.id
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:bg-muted/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{opt.title}</span>
                  {ocrEngine === opt.id && (
                    <span className="text-xs font-semibold text-primary">Active</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
              </button>
            ))}
          </div>
          {ocrEngine === 'gemini' && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <div className="text-xs text-muted-foreground">
                {hasEnvGeminiKey()
                  ? '✓ VITE_GEMINI_API_KEY detected from .env'
                  : 'Set VITE_GEMINI_API_KEY in .env (or enter an override key below):'}
              </div>
              <div className="flex gap-2">
                <Input
                  type="password"
                  placeholder={hasEnvGeminiKey() ? 'Using .env key (optional override)' : 'AIza...'}
                  value={geminiKey}
                  onChange={(e) => {
                    const v = e.target.value;
                    setGeminiKey(v);
                    setGeminiTestStatus(null);
                    void setSetting('gemini_api_key', v.trim());
                  }}
                  className="text-xs h-8"
                />
                <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => void handleTestGemini()}>
                  Test
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs shrink-0">Model:</Label>
                <Input
                  value={geminiModel}
                  onChange={(e) => {
                    const v = e.target.value;
                    setGeminiModel(v);
                    void setSetting('gemini_model', v.trim());
                  }}
                  placeholder="gemini-2.5-flash"
                  className="text-xs h-7"
                />
              </div>
              {geminiTestStatus && (
                <div className="text-xs text-muted-foreground">{geminiTestStatus}</div>
              )}
            </div>
          )}
          {ocrEngine === 'cloud' && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
              <Label className="text-xs">Python OCR Backend URL (FastAPI)</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://your-ocr-api.onrender.com"
                  value={cloudUrl}
                  onChange={(e) => void handleCloudUrlChange(e.target.value)}
                  className="text-xs h-8"
                />
                <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => void handleTestCloud()}>
                  Test
                </Button>
              </div>
              {cloudTestStatus && (
                <div className="text-xs text-muted-foreground">{cloudTestStatus}</div>
              )}
            </div>
          )}
          {ocrEngine === 'onnx' && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex gap-2">
              <Info className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                ONNX mode requires the trained model file at <code>/models/ocr_crnn_int8.onnx</code>.
                The placeholder file will not produce real OCR results.
              </p>
            </div>
          )}
        </div>

        <Separator />

        {/* Language */}
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Languages className="h-4 w-4" />
            LANGUAGE / ಭಾಷೆ
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Kannada UI / ಕನ್ನಡ</Label>
              <div className="text-xs text-muted-foreground">ಕನ್ನಡ ಭಾಷೆಯಲ್ಲಿ ಬಟನ್‌ಗಳು ಮತ್ತು ಲೇಬಲ್‌ಗಳು</div>
            </div>
            <Switch
              checked={language === 'kn'}
              onCheckedChange={handleLanguageToggle}
            />
          </div>
        </div>

        <Separator />

        {/* Cloud Sync */}
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Cloud className="h-4 w-4" />
            CLOUD SYNC
          </div>
          <div className="text-sm text-muted-foreground">
            Sign in with Supabase to sync forms across devices. The app works fully without signing in.
          </div>
          <SupabaseAuth />
        </div>

        <Separator />

        {/* Diagnostics & Benchmark */}
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Activity className="h-4 w-4" />
            DIAGNOSTICS &amp; BENCHMARK
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Detection Max Side (px)</span>
            <select
              value={detMaxSide}
              onChange={(e) => {
                const v = Number(e.target.value);
                setDetMaxSide(v);
                void setSetting('det_max_side', v);
              }}
              className="rounded border px-2 py-1 bg-background text-xs"
            >
              <option value={960}>960 px (Fast / 2GB RAM)</option>
              <option value={1280}>1280 px (High Detail)</option>
            </select>
          </div>

          {lastTimings && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
              <div className="font-medium">Last Scan Timings</div>
              <div>Detector load: {lastTimings.detLoadMs} ms · Rec load: {lastTimings.recLoadMs} ms</div>
              <div>Detect: {lastTimings.detectMs} ms · Recognize: {lastTimings.recognizeMs} ms ({lastTimings.avgRecPerBoxMs} ms/box)</div>
              {lastTimings.peakMemoryMB !== null && (
                <div>JS Heap Used: {lastTimings.peakMemoryMB} MB</div>
              )}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            disabled={benchRunning}
            onClick={() => void handleRunBenchmark()}
          >
            {benchRunning ? 'Running Offline Benchmark…' : 'Run Benchmark (public/bench/pages/)'}
          </Button>

          {benchError && (
            <div className="text-xs text-red-600">{benchError}</div>
          )}

          {benchResults && (
            <div className="space-y-2 text-xs">
              {benchResults.map((b) => (
                <div key={b.pageId} className="rounded-lg border p-2.5 space-y-1 bg-card">
                  <div className="font-semibold">{b.pageId} ({b.boxesDetected} boxes)</div>
                  {b.detPrecision !== null && b.detRecall !== null && (
                    <div>
                      Detection @ IoU 0.5 — Precision: {(b.detPrecision * 100).toFixed(1)}% · Recall: {(b.detRecall * 100).toFixed(1)}%
                    </div>
                  )}
                  <div>
                    Confidence: ≥85% ({b.confHistogram.high}) · 60–85% ({b.confHistogram.medium}) · &lt;60% ({b.confHistogram.low})
                  </div>
                  {(['en', 'kn', 'mixed'] as const).map((sc) =>
                    b.cerByScript[sc].count > 0 ? (
                      <div key={sc}>
                        Script {sc.toUpperCase()} ({b.cerByScript[sc].count}): CER {(b.cerByScript[sc].cer * 100).toFixed(1)}% · Exact {(b.cerByScript[sc].exactMatch * 100).toFixed(0)}%
                      </div>
                    ) : null,
                  )}
                  <div className="text-muted-foreground">
                    Detect {b.timings.detectMs} ms · Rec {b.timings.recognizeMs} ms ({b.timings.avgRecPerBoxMs} ms/box)
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        {/* Corrections Dataset */}
        <div className="px-4 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <Download className="h-4 w-4" />
              CORRECTIONS DATASET
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              {correctionCount} {correctionCount === 1 ? 'correction' : 'corrections'} stored
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Every field edit during review is saved locally with its crop image for offline dataset export (ZIP with PNG crops + labels.csv).
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={correctionCount === 0 || exportingCorrections}
              onClick={async () => {
                setExportingCorrections(true);
                try {
                  await exportCorrectionsDataset();
                } finally {
                  setExportingCorrections(false);
                }
              }}
            >
              {exportingCorrections ? 'Exporting ZIP…' : 'Export corrections dataset'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700"
              disabled={correctionCount === 0 || clearingCorrections}
              onClick={async () => {
                setClearingCorrections(true);
                try {
                  await clearCorrections();
                  setCorrectionCount(0);
                } finally {
                  setClearingCorrections(false);
                }
              }}
            >
              {clearingCorrections ? 'Clearing…' : 'Clear corrections'}
            </Button>
          </div>
        </div>

        <Separator />

        {/* About */}
        <div className="px-4 py-4 text-xs text-muted-foreground space-y-1">
          <div className="font-semibold">About FormLens</div>
          <div>Offline-first PWA for Kannada + English government forms.</div>
          <div>All recognition happens on-device. No data sent to any server without your consent.</div>
        </div>
      </div>

      <BottomNav />
    </div>
  );
}

function SupabaseAuth() {
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!navigator.onLine) return;
    import('@/integrations/supabase/client')
      .then(({ supabase }) => supabase.auth.getSession())
      .then(({ data }) => setEmail(data.session?.user.email ?? null))
      .catch(() => {/* offline or no Supabase */});
  }, []);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      const emailInput = prompt('Enter your email for magic link sign-in:');
      if (!emailInput) return;
      await supabase.auth.signInWithOtp({ email: emailInput });
      alert('Check your email for a sign-in link.');
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      const { supabase } = await import('@/integrations/supabase/client');
      await supabase.auth.signOut();
      setEmail(null);
    } catch {/* offline */}
  };

  if (email) {
    return (
      <div className="space-y-2">
        <div className="text-sm text-green-700 font-medium">✓ Signed in as {email}</div>
        <Button variant="outline" size="sm" onClick={handleSignOut}>Sign Out</Button>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSignIn} disabled={loading || !navigator.onLine}>
      {!navigator.onLine ? 'Go online to sign in' : loading ? 'Sending link…' : 'Sign In (Magic Link)'}
    </Button>
  );
}


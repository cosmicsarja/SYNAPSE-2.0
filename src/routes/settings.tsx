/**
 * Settings route.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { BottomNav } from '@/components/formlens/BottomNav';
import { OfflineStatusBar } from '@/components/formlens/OfflineStatusBar';
import { OnlineIndicator } from '@/components/formlens/OfflineStatusBar';
import { useStorageEstimate } from '@/hooks/formlens/useStorageEstimate';
import { useInstallPrompt } from '@/hooks/formlens/useInstallPrompt';
import { getSetting, setSetting, db } from '@/db';
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
import { Download, HardDrive, Cpu, Languages, Cloud, Smartphone, Info } from 'lucide-react';

export const Route = createFileRoute('/settings')({
  head: () => ({ meta: [{ title: 'Settings – FormLens' }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const storage = useStorageEstimate();
  const { canInstall, install } = useInstallPrompt();
  const [ocrEngine, setOcrEngine] = useState<OcrEngine>('mock');
  const [language, setLanguage] = useState<'en' | 'kn'>('en');
  const [packVersion, setPackVersion] = useState<string | null>(null);
  const [setupComplete, setSetupComplete] = useState(false);
  const [clearingForms, setClearingForms] = useState(false);
  const [redownloading, setRedownloading] = useState(false);

  // iOS detection
  const isIos = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = typeof window !== 'undefined' && ('standalone' in navigator) && (navigator as { standalone?: boolean }).standalone === true;

  useEffect(() => {
    Promise.all([
      getSetting<OcrEngine>('ocr_engine', 'mock'),
      getSetting<'en' | 'kn'>('language', 'en'),
      getSetting<string | null>('pack_version', null),
      getSetting<boolean>('setup_complete', false),
    ]).then(([eng, lang, ver, setup]) => {
      setOcrEngine(eng);
      setLanguage(lang);
      setPackVersion(ver);
      setSetupComplete(setup);
    });
  }, []);

  const handleEngineToggle = async (useOnnx: boolean) => {
    const engine: OcrEngine = useOnnx ? 'onnx' : 'mock';
    setOcrEngine(engine);
    await setSetting('ocr_engine', engine);
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
        {(canInstall || (isIos && !isStandalone)) && (
          <>
            <div className="px-4 py-4">
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <Smartphone className="h-4 w-4 text-primary" />
                  Install App
                </div>
                {isIos && !isStandalone
                  ? <p className="text-xs text-muted-foreground">
                      Tap the Share button and select <strong>"Add to Home Screen"</strong> to install FormLens.
                      <br />ಷೇರ್ ಬಟನ್ ಒತ್ತಿ "Add to Home Screen" ಆಯ್ಕೆ ಮಾಡಿ.
                    </p>
                  : <Button size="sm" onClick={install}>Install</Button>
                }
              </div>
            </div>
            <Separator />
          </>
        )}

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
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Use ONNX (On-device AI)</Label>
              <div className="text-xs text-muted-foreground mt-0.5">
                {ocrEngine === 'onnx' ? 'Real OCR model — requires model file' : 'Mock mode — returns demo data'}
              </div>
            </div>
            <Switch
              checked={ocrEngine === 'onnx'}
              onCheckedChange={handleEngineToggle}
            />
          </div>
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


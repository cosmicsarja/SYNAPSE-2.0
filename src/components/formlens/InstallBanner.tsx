/**
 * InstallBanner — smart install UI that adapts per platform:
 *   - Android/Chrome/Desktop: "Install FormLens" button via beforeinstallprompt
 *   - iOS Safari: instructions sheet (Share → Add to Home Screen)
 *   - In-app browser (WhatsApp/Instagram/FB): "Open in Chrome/Safari" prompt
 *   - Already installed / dismissed for 7 days: renders nothing
 *
 * Variants:
 *   "banner"  — fixed bottom bar (used in __root for global display)
 *   "card"    — inline card (used in setup, settings, install page)
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useInstallPrompt } from '@/hooks/formlens/useInstallPrompt';
import { Download, Share, X, Smartphone, ExternalLink, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InstallBannerProps {
  variant?: 'banner' | 'card';
  className?: string;
}

export function InstallBanner({ variant = 'card', className }: InstallBannerProps) {
  const {
    canInstall, install, dismiss,
    showIosInstructions, showInAppWarning, isStandalone, installed,
  } = useInstallPrompt();
  const [copied, setCopied] = useState(false);

  // Nothing to show
  if (installed || isStandalone) return null;
  if (!canInstall && !showIosInstructions && !showInAppWarning) return null;

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.origin + '/install');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── In-app browser warning ──────────────────────────────────────────────
  if (showInAppWarning) {
    return (
      <div className={cn('rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2', className)}>
        <p className="text-sm font-semibold text-amber-800 flex items-center gap-2">
          <ExternalLink className="h-4 w-4 shrink-0" />
          Open in Chrome or Safari to install
        </p>
        <p className="text-xs text-amber-700">
          In-app browsers don't support PWA installation.
          Copy the link and open it in Chrome or Safari.
        </p>
        <Button size="sm" variant="outline" onClick={copyLink} className="border-amber-300 text-amber-800">
          <Copy className="mr-2 h-3 w-3" />
          {copied ? 'Copied!' : 'Copy link'}
        </Button>
      </div>
    );
  }

  // ── iOS Safari instructions ─────────────────────────────────────────────
  if (showIosInstructions && !canInstall) {
    if (variant === 'banner') {
      return (
        <div className={cn('fixed bottom-16 left-0 right-0 z-40 mx-3 rounded-xl border border-primary/30 bg-background/95 backdrop-blur p-3 shadow-lg flex items-start gap-3', className)}>
          <Smartphone className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">Install FormLens / ಆ್ಯಪ್ ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿ</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Tap <Share className="inline h-3 w-3" /> Share, then <strong>"Add to Home Screen"</strong>
            </p>
          </div>
          <button onClick={dismiss} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
        </div>
      );
    }
    return (
      <div className={cn('rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3', className)}>
        <p className="text-sm font-semibold flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-primary" />
          Install FormLens / ಆ್ಯಪ್ ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿ
        </p>
        <ol className="text-xs text-muted-foreground space-y-1 list-none">
          <li className="flex items-center gap-2"><span className="rounded-full bg-primary/10 text-primary w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0">1</span> Tap the <Share className="inline h-3 w-3 mx-0.5" /> <strong>Share</strong> button</li>
          <li className="flex items-center gap-2"><span className="rounded-full bg-primary/10 text-primary w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0">2</span> Scroll down and tap <strong>"Add to Home Screen"</strong></li>
          <li className="flex items-center gap-2"><span className="rounded-full bg-primary/10 text-primary w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0">3</span> Tap <strong>Add</strong> to confirm</li>
        </ol>
        <button onClick={dismiss} className="text-xs text-muted-foreground underline underline-offset-2">Dismiss</button>
      </div>
    );
  }

  // ── Chrome / Android / Desktop install prompt ───────────────────────────
  if (!canInstall) return null;

  if (variant === 'banner') {
    return (
      <div className={cn('fixed bottom-16 left-0 right-0 z-40 mx-3 rounded-xl border border-primary/30 bg-background/95 backdrop-blur p-3 shadow-lg flex items-center gap-3', className)}>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">Install FormLens / ಆ್ಯಪ್ ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿ</p>
          <p className="text-xs text-muted-foreground">Works offline after install</p>
        </div>
        <Button size="sm" onClick={install} className="shrink-0">
          <Download className="mr-1.5 h-3 w-3" />
          Install
        </Button>
        <button onClick={dismiss} className="text-muted-foreground hover:text-foreground p-1"><X className="h-4 w-4" /></button>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3', className)}>
      <div className="flex items-start justify-between">
        <p className="text-sm font-semibold flex items-center gap-2">
          <Download className="h-4 w-4 text-primary" />
          Install FormLens / ಆ್ಯಪ್ ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿ
        </p>
        <button onClick={dismiss} className="text-muted-foreground hover:text-foreground p-0.5"><X className="h-3.5 w-3.5" /></button>
      </div>
      <p className="text-xs text-muted-foreground">Add to your home screen. Works offline — no internet needed after install.</p>
      <Button size="sm" onClick={install} className="w-full">
        <Download className="mr-2 h-4 w-4" />
        Install app
      </Button>
    </div>
  );
}

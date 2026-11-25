/**
 * InstallBanner — smart install UI that adapts per platform:
 *   - Android/Chrome: "Install FormLens" button via beforeinstallprompt
 *   - iOS Safari: bottom sheet with Share → Add to Home Screen instructions
 *   - In-app browser: "Open in Chrome/Safari to install" + Copy link
 *   - Already installed / dismissed: renders nothing
 */
import { useState } from "react";
import { useInstallPrompt } from "@/hooks/formlens/useInstallPrompt";
import { Button } from "@/components/ui/button";
import { X, Share, ArrowUpFromLine, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** Where the banner is shown — affects styling */
  variant?: "banner" | "card";
  className?: string;
}

export function InstallBanner({ variant = "banner", className }: Props) {
  const { context, canInstall, isInstalled, isDismissed, promptInstall, dismiss } =
    useInstallPrompt();
  const [showIosSheet, setShowIosSheet] = useState(false);
  const [copied, setCopied] = useState(false);

  // Nothing to show
  if (isInstalled || isDismissed) return null;
  if (context === "unsupported" || context === "installed") return null;
  if (context === "chromium" && !canInstall) return null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  };

  // ── In-app browser nudge ─────────────────────────────────────────────────
  if (context === "inapp") {
    return (
      <div className={cn("rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3 items-start", className)}>
        <div className="flex-1 space-y-1">
          <p className="text-sm font-semibold text-amber-900">
            Open in Chrome or Safari to install
          </p>
          <p className="text-xs text-amber-700">
            Tap the browser menu (⋯ or ↗) and choose "Open in browser".
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={copyLink} className="shrink-0 border-amber-300 text-amber-800">
          {copied ? "Copied!" : "Copy link"}
        </Button>
      </div>
    );
  }

  // ── iOS Safari bottom-sheet toggle ──────────────────────────────────────
  if (context === "ios") {
    return (
      <>
        {/* Trigger button */}
        <div className={cn(
          "rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-center gap-3",
          className
        )}>
          <img src="/icons/icon-192.png" alt="FormLens" className="h-10 w-10 rounded-xl shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Install FormLens</p>
            <p className="text-xs text-muted-foreground">ಆ್ಯಪ್ ಇನ್ಸ್ಟಾಲ್ ಮಾಡಿ</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button size="sm" onClick={() => setShowIosSheet(true)}>
              How to install
            </Button>
            <button onClick={dismiss} className="p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* iOS instruction bottom sheet */}
        {showIosSheet && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={() => setShowIosSheet(false)}>
            <div
              className="bg-background rounded-t-2xl p-6 space-y-5 max-w-lg mx-auto w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-base">Add to Home Screen</h3>
                <button onClick={() => setShowIosSheet(false)}>
                  <X className="h-5 w-5 text-muted-foreground" />
                </button>
              </div>

              <ol className="space-y-4">
                <li className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">1</div>
                  <div>
                    <p className="text-sm font-medium">Tap the Share button</p>
                    <p className="text-xs text-muted-foreground mt-0.5">The <Share className="inline h-3.5 w-3.5" /> icon at the bottom of Safari</p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">2</div>
                  <div>
                    <p className="text-sm font-medium">Scroll down and tap <strong>"Add to Home Screen"</strong></p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <ArrowUpFromLine className="inline h-3.5 w-3.5 mr-0.5" />
                      Look for the icon with an arrow pointing up from a box
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">3</div>
                  <div>
                    <p className="text-sm font-medium">Tap <strong>"Add"</strong> <Plus className="inline h-3.5 w-3.5" /></p>
                    <p className="text-xs text-muted-foreground mt-0.5">FormLens appears on your home screen and works offline.</p>
                  </div>
                </li>
              </ol>

              <Button className="w-full" onClick={() => setShowIosSheet(false)}>
                Got it
              </Button>
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Chromium / Android / Desktop — beforeinstallprompt ──────────────────
  if (variant === "card") {
    return (
      <div className={cn(
        "rounded-xl border border-primary/20 bg-primary/5 p-4 flex items-center gap-3",
        className
      )}>
        <img src="/icons/icon-192.png" alt="FormLens" className="h-10 w-10 rounded-xl shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Install FormLens</p>
          <p className="text-xs text-muted-foreground">ಆ್ಯಪ್ ಇನ್ಸ್ಟಾಲ್ ಮಾಡಿ — works offline</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" onClick={promptInstall}>
            Install
          </Button>
          <button onClick={dismiss} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  // Default banner variant
  return (
    <div className={cn(
      "flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground",
      className
    )}>
      <img src="/icons/icon-192.png" alt="" className="h-8 w-8 rounded-lg shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight">Install FormLens</p>
        <p className="text-xs opacity-80">Works fully offline · ಆ್ಯಪ್ ಇನ್ಸ್ಟಾಲ್ ಮಾಡಿ</p>
      </div>
      <Button
        size="sm"
        variant="secondary"
        onClick={promptInstall}
        className="shrink-0 text-primary font-semibold"
      >
        Install
      </Button>
      <button onClick={dismiss} className="p-1 opacity-70 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

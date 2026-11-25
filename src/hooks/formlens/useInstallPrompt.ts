/**
 * useInstallPrompt — full PWA install hook.
 *
 * Detects:
 *   - Android/Chrome/Edge: beforeinstallprompt → shows Install button
 *   - iOS Safari: no beforeinstallprompt → shows bottom-sheet instructions
 *   - In-app browser (WhatsApp, Instagram, FB, TikTok): shows "Open in browser" nudge
 *   - Already installed (standalone): hides all install UI
 *
 * Dismissal is persisted in IndexedDB for 7 days via settings table.
 */
import { useState, useEffect, useCallback } from "react";
import { getSetting, setSetting } from "@/db";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallContext =
  | "chromium"   // beforeinstallprompt is available → show Install button
  | "ios"        // iOS Safari — show manual instructions
  | "inapp"      // In-app browser — show "Open in browser" nudge
  | "installed"  // Already running standalone
  | "unsupported"; // Desktop browser with no install path

function detectContext(): InstallContext {
  if (typeof window === "undefined") return "unsupported";
  const ua = navigator.userAgent;

  // Already installed (standalone / TWA)
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
    document.referrer.startsWith("android-app://");
  if (isStandalone) return "installed";

  // In-app browsers — no install path, need to open externally
  const isInApp =
    /FBAN|FBAV|Instagram|WhatsApp|Snapchat|TikTok|Twitter|LinkedInApp|MicroMessenger/.test(ua);
  if (isInApp) return "inapp";

  // iOS Safari (Safari on iPhone/iPad WITHOUT the in-app tag)
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isSafari = /^((?!chrome|android).)*safari/i.test(ua);
  if (isIos && isSafari) return "ios";

  // Otherwise wait for beforeinstallprompt
  return "chromium";
}

const DISMISS_KEY = "install_banner_dismissed_until";
const DISMISS_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface UseInstallPromptReturn {
  context: InstallContext;
  canInstall: boolean;         // true when chromium + prompt captured
  isInstalled: boolean;
  promptInstall: () => Promise<void>;
  dismiss: () => void;         // stores dismissal for 7 days in IndexedDB
  isDismissed: boolean;
}

export function useInstallPrompt(): UseInstallPromptReturn {
  const [context, setContext] = useState<InstallContext>("unsupported");
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Initialise context and check dismissal
  useEffect(() => {
    setContext(detectContext());

    // Check persistent dismissal
    getSetting<number>(DISMISS_KEY, 0).then((until) => {
      if (Date.now() < until) setIsDismissed(true);
    });
  }, []);

  // Listen for beforeinstallprompt (Android/Chrome/Edge/desktop)
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      // Once we have the prompt, context is definitely chromium
      setContext("chromium");
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Listen for appinstalled
  useEffect(() => {
    const handler = () => {
      setIsInstalled(true);
      setContext("installed");
      setPrompt(null);
    };
    window.addEventListener("appinstalled", handler);
    return () => window.removeEventListener("appinstalled", handler);
  }, []);

  // Track display-mode changes (e.g. user pins to home screen and reopens)
  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsInstalled(true);
        setContext("installed");
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const promptInstall = useCallback(async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      setIsInstalled(true);
      setContext("installed");
    }
    setPrompt(null);
  }, [prompt]);

  const dismiss = useCallback(() => {
    const until = Date.now() + DISMISS_DURATION_MS;
    setIsDismissed(true);
    setSetting(DISMISS_KEY, until).catch(() => {/* best-effort */});
  }, []);

  return {
    context,
    canInstall: context === "chromium" && !!prompt && !isInstalled,
    isInstalled,
    promptInstall,
    dismiss,
    isDismissed,
  };
}

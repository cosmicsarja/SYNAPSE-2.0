/**
 * useInstallPrompt — captures beforeinstallprompt, detects platform context,
 * and provides a 7-day dismissal memory via IndexedDB.
 */
import { useState, useEffect } from 'react';
import { getSetting, setSetting } from '@/db';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function detectPlatform() {
  if (typeof window === 'undefined') return { isIos: false, isAndroid: false, isInAppBrowser: false, isStandalone: false };
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const isInAppBrowser = /FBAN|FBAV|Instagram|Twitter|LinkedInApp|WhatsApp/i.test(ua);
  const isStandalone =
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true) ||
    window.matchMedia('(display-mode: standalone)').matches;
  return { isIos, isAndroid, isInAppBrowser, isStandalone };
}

export function useInstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const platform = detectPlatform();

  useEffect(() => {
    // Check 7-day dismissal
    getSetting<number | null>('install_banner_dismissed_at', null).then((ts) => {
      if (ts && Date.now() - ts < 7 * 24 * 60 * 60 * 1000) setDismissed(true);
    });

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
    };
    const installedHandler = () => setInstalled(true);

    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installedHandler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installedHandler);
    };
  }, []);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') setInstalled(true);
    setPrompt(null);
  };

  const dismiss = async () => {
    await setSetting('install_banner_dismissed_at', Date.now());
    setDismissed(true);
  };

  const canInstall = !!prompt && !platform.isStandalone && !installed && !dismissed;
  const showIosInstructions = platform.isIos && !platform.isStandalone && !dismissed;
  const showInAppWarning = platform.isInAppBrowser && !platform.isStandalone;

  return {
    canInstall,
    install,
    dismiss,
    dismissed,
    installed: installed || platform.isStandalone,
    isIos: platform.isIos,
    isAndroid: platform.isAndroid,
    isStandalone: platform.isStandalone,
    isInAppBrowser: platform.isInAppBrowser,
    showIosInstructions,
    showInAppWarning,
  };
}

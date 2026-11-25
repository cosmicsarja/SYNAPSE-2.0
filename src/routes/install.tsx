/**
 * /install — shareable install page with QR code, install button, iOS instructions.
 * Works fully offline (QR generated client-side with the qrcode package).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/button';
import { InstallBanner } from '@/components/formlens/InstallBanner';
import { Share2, Copy, CheckCircle, Download, Smartphone, Wifi } from 'lucide-react';

export const Route = createFileRoute('/install')({
  head: () => ({ meta: [{ title: 'Install FormLens' }] }),
  component: InstallPage,
});

const APK_DOWNLOAD_URL = 'https://github.com/your-org/formlens/releases/latest'; // TODO: update after upload

function InstallPage() {
  const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://formlens.vercel.app';
  const installUrl = `${appUrl}/install`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, installUrl, {
        width: 180,
        margin: 2,
        color: { dark: '#1e3a5f', light: '#ffffff' },
      }).catch(console.error);
    }
  }, [installUrl]);

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'FormLens', text: 'Scan and digitise government forms offline', url: installUrl });
    } else {
      await navigator.clipboard.writeText(installUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(installUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col">
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-6 py-8 text-center">
        <div className="text-3xl font-bold mb-1">FormLens</div>
        <div className="text-sm opacity-80">ಫಾರ್ಮ್‌ಲೆನ್ಸ್</div>
        <div className="text-xs opacity-70 mt-1">Offline form scanner for Karnataka</div>
      </div>

      <div className="flex-1 px-6 py-6 max-w-md mx-auto w-full space-y-6">

        {/* Install banner (auto-detects platform) */}
        <InstallBanner variant="card" />

        {/* Checklist */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold">How to get started</p>
          <ol className="space-y-2">
            {[
              { icon: Wifi, text: 'Open this page with internet connected' },
              { icon: Download, text: 'Tap Install (or use Share → Add to Home Screen on iPhone)' },
              { icon: Smartphone, text: 'Open FormLens and tap "Download offline pack"' },
              { icon: CheckCircle, text: 'Turn off internet — FormLens still works!' },
            ].map(({ icon: Icon, text }, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span className="rounded-full bg-primary/10 text-primary w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">{i + 1}</span>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </div>

        {/* QR code */}
        <div className="rounded-xl border border-border bg-card p-4 flex flex-col items-center gap-3">
          <p className="text-sm font-semibold">Scan to open on another phone</p>
          <canvas ref={canvasRef} className="rounded-lg" />
          <p className="text-xs text-muted-foreground text-center break-all">{installUrl}</p>
        </div>

        {/* Share */}
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={handleShare}>
            <Share2 className="mr-2 h-4 w-4" />
            Share app
          </Button>
          <Button variant="outline" className="flex-1" onClick={copyLink}>
            {copied ? <CheckCircle className="mr-2 h-4 w-4 text-green-600" /> : <Copy className="mr-2 h-4 w-4" />}
            {copied ? 'Copied!' : 'Copy link'}
          </Button>
        </div>

        {/* Android APK */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <p className="text-sm font-semibold">Android APK (direct download)</p>
          <p className="text-xs text-muted-foreground">
            Prefer a native APK? Download and sideload the signed FormLens APK.
            See <code className="text-xs">twa/README.md</code> for how it was built.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => window.open(APK_DOWNLOAD_URL, '_blank')}
          >
            <Download className="mr-2 h-4 w-4" />
            Download Android APK
          </Button>
        </div>

        <div className="text-center">
          <a href="/" className="text-xs text-muted-foreground underline underline-offset-2">
            Open FormLens
          </a>
        </div>
      </div>
    </div>
  );
}

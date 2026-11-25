/**
 * /install — shareable install page with QR code, install button, iOS instructions.
 * Works fully offline (QR generated client-side with the qrcode package).
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { InstallBanner } from "@/components/formlens/InstallBanner";
import { OfflineStatusBar } from "@/components/formlens/OfflineStatusBar";
import { Link2, Share2, CheckCircle } from "lucide-react";
import QRCode from "qrcode";

export const Route = createFileRoute("/install")({
  head: () => ({
    meta: [
      { title: "Install FormLens" },
      { name: "description", content: "Install the FormLens offline form scanner on your device." },
    ],
  }),
  component: InstallPage,
});

function InstallPage() {
  const [appUrl, setAppUrl] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const url = window.location.origin;
    setAppUrl(url);
    // Generate QR code into a data URL (works fully offline)
    QRCode.toDataURL(url, {
      width: 200,
      margin: 2,
      color: { dark: "#1e3a5f", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then(setQrDataUrl)
      .catch(() => {/* QR generation failed — show fallback */});
  }, []);

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "FormLens — Offline Form Scanner",
          text: "Scan and digitise Kannada + English government forms offline.",
          url: appUrl,
        });
        return;
      } catch {
        /* user cancelled or share failed */
      }
    }
    // Fallback: copy to clipboard
    await copyLink();
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {/* clipboard blocked */}
  };

  const steps = [
    "Open this page with internet.",
    'Tap "Install" (or follow the iOS instructions).',
    "Open FormLens → tap Download offline pack.",
    "Turn off internet — FormLens still works!",
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <OfflineStatusBar />

      <div className="max-w-md mx-auto px-5 py-8 space-y-7">
        {/* Header */}
        <div className="text-center space-y-3">
          <img
            src="/icons/icon-512.png"
            alt="FormLens"
            className="mx-auto h-20 w-20 rounded-2xl shadow-lg"
          />
          <h1 className="text-2xl font-bold text-primary">FormLens</h1>
          <p className="text-sm text-muted-foreground">
            Offline-first scanner for Kannada &amp; English government forms.
            <br />
            <span className="text-xs">Works with zero internet after first setup.</span>
          </p>
        </div>

        {/* Install banner (platform-aware) */}
        <InstallBanner variant="card" />

        {/* Install checklist */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold">How it works</p>
          <ol className="space-y-2">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 text-primary" />
                <span>
                  <span className="font-medium text-foreground">{i + 1}.</span> {step}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* QR code */}
        {qrDataUrl && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-center">
            <p className="text-sm font-semibold">Share via QR</p>
            <p className="text-xs text-muted-foreground">
              Scan with another phone to open this page.
            </p>
            <img
              src={qrDataUrl}
              alt={`QR code for ${appUrl}`}
              className="mx-auto rounded-lg"
              style={{ imageRendering: "pixelated", width: 200, height: 200 }}
            />
            <p className="text-xs text-muted-foreground font-mono break-all">{appUrl}</p>
          </div>
        )}

        {/* Share / copy */}
        <div className="flex gap-3">
          <Button onClick={share} className="flex-1 gap-2">
            <Share2 className="h-4 w-4" />
            Share app
          </Button>
          <Button variant="outline" onClick={copyLink} className="flex-1 gap-2">
            <Link2 className="h-4 w-4" />
            {copied ? "Copied!" : "Copy link"}
          </Button>
        </div>

        {/* Open in browser fallback */}
        <div className="text-center">
          <a
            href={appUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground underline underline-offset-2"
          >
            Open FormLens in your browser →
          </a>
        </div>

        {/* APK download section */}
        <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-2">
          <p className="text-sm font-semibold">Android APK</p>
          <p className="text-xs text-muted-foreground">
            A signed APK (Trusted Web Activity) can be downloaded for sideloading.
            After installing, enable "Install unknown apps" in Android settings.
          </p>
          <a
            href="/downloads/formlens.apk"
            className="inline-flex items-center gap-1.5 text-xs text-primary underline underline-offset-2"
          >
            Download formlens.apk (placeholder — see /twa/README.md)
          </a>
        </div>

        {/* Back link */}
        <div className="text-center">
          <a href="/" className="text-xs text-muted-foreground underline underline-offset-2">
            ← Back to FormLens
          </a>
        </div>

        {/* Hidden canvas (unused, kept for future canvas-based QR fallback) */}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </div>
  );
}


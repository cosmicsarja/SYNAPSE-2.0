/**
 * Camera capture component with live viewfinder and gallery fallback.
 * Provides document frame overlay and captures to ImageData.
 */
import { useRef, useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, Upload, X } from 'lucide-react';

interface Props {
  onCapture: (imageData: ImageData, dataUrl: string) => void;
  onCancel: () => void;
}

export function CameraCapture({ onCapture, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStreaming(true);
      }
    } catch (err) {
      setError('Camera not accessible. Please allow camera permission or use gallery upload.');
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setStreaming(false);
  }, []);

  useEffect(() => {
    void startCamera();
    return stopCamera;
  }, [startCamera, stopCamera]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    stopCamera();
    onCapture(imageData, dataUrl);
  }, [onCapture, stopCamera]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      URL.revokeObjectURL(url);
      onCapture(imageData, dataUrl);
    };
    img.src = url;
  }, [onCapture]);

  return (
    <div className="relative flex flex-col h-full bg-black">
      {/* Viewfinder */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          playsInline
          muted
        />
        {/* Document frame overlay */}
        {streaming && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div
              className="border-2 border-white rounded-lg"
              style={{ width: '88%', height: '75%', boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }}
            />
            <div className="absolute bottom-4 left-0 right-0 text-center text-white text-xs opacity-80">
              Align the form within the frame
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 p-6 text-center text-white">
            <Camera className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-sm">{error}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-around bg-black px-6 py-4 gap-4">
        <Button variant="ghost" onClick={onCancel} className="text-white hover:text-white hover:bg-white/10 rounded-full p-3">
          <X className="h-6 w-6" />
        </Button>
        {streaming && (
          <button
            onClick={capture}
            className="h-16 w-16 rounded-full bg-white border-4 border-gray-300 active:scale-95 transition-transform"
            aria-label="Capture photo"
          />
        )}
        <label className="cursor-pointer">
          <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
          <div className="text-white hover:text-white p-3 rounded-full hover:bg-white/10 flex items-center justify-center">
            <Upload className="h-6 w-6" />
          </div>
        </label>
      </div>

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}


/**
 * Manual 4-corner crop UI.
 * Displays the captured image with 4 draggable corner handles.
 * On confirm, perspective-corrects (affine approx via CSS/canvas) and returns cropped ImageData.
 *
 * Note: Full perspective correction via OpenCV.js is a TODO.
 * For now, we do a simple bounding-box crop of the 4-corner selection.
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface Corner {
  x: number; // 0–1 relative to displayed image
  y: number;
}

interface Props {
  imageDataUrl: string;
  imageData: ImageData;
  onCrop: (cropped: ImageData, dataUrl: string) => void;
  onCancel: () => void;
}

const DEFAULT_CORNERS: Corner[] = [
  { x: 0.05, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: 0.95, y: 0.95 },
  { x: 0.05, y: 0.95 },
];

export function ManualCrop({ imageDataUrl, imageData, onCrop, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [corners, setCorners] = useState<Corner[]>(DEFAULT_CORNERS);
  const [dragging, setDragging] = useState<number | null>(null);

  const getRelativePos = useCallback((e: React.TouchEvent | React.MouseEvent | TouchEvent | MouseEvent): { x: number; y: number } => {
    const rect = containerRef.current!.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX ?? 0 : (e as MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY ?? 0 : (e as MouseEvent).clientY;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }, []);

  const startDrag = useCallback((index: number) => (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    setDragging(index);
  }, []);

  useEffect(() => {
    if (dragging === null) return;
    const move = (e: TouchEvent | MouseEvent) => {
      const pos = getRelativePos(e);
      setCorners((prev) => prev.map((c, i) => i === dragging ? pos : c));
    };
    const end = () => setDragging(null);
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup', end);
      window.removeEventListener('touchend', end);
    };
  }, [dragging, getRelativePos]);

  const confirmCrop = useCallback(() => {
    // Bounding box crop from corner selection
    const minX = Math.min(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    const maxX = Math.max(...corners.map((c) => c.x));
    const maxY = Math.max(...corners.map((c) => c.y));

    const srcX = Math.round(minX * imageData.width);
    const srcY = Math.round(minY * imageData.height);
    const srcW = Math.round((maxX - minX) * imageData.width);
    const srcH = Math.round((maxY - minY) * imageData.height);

    // Draw to offscreen canvas
    const canvas = document.createElement('canvas');
    canvas.width = srcW;
    canvas.height = srcH;
    const ctx = canvas.getContext('2d')!;

    // Draw original image and crop
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = imageData.width;
    srcCanvas.height = imageData.height;
    srcCanvas.getContext('2d')!.putImageData(imageData, 0, 0);
    ctx.drawImage(srcCanvas, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

    const cropped = ctx.getImageData(0, 0, srcW, srcH);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    onCrop(cropped, dataUrl);
  }, [corners, imageData, onCrop]);

  // Build polygon path from corners
  const polygon = corners.map((c) => `${c.x * 100}% ${c.y * 100}%`).join(', ');

  return (
    <div className="flex flex-col h-full bg-black">
      <div className="p-3 text-white text-sm text-center">
        Drag corners to align with the form edges
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 select-none overflow-hidden"
        style={{ touchAction: 'none' }}
      >
        <img src={imageDataUrl} alt="Captured form" className="h-full w-full object-contain" draggable={false} />

        {/* Polygon overlay */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <polygon
            points={corners.map((c) => `${c.x * 100}% ${c.y * 100}%`).join(' ')}
            fill="rgba(37,99,235,0.15)"
            stroke="#2563eb"
            strokeWidth="2"
          />
        </svg>

        {/* Corner handles */}
        {corners.map((c, i) => (
          <div
            key={i}
            onMouseDown={startDrag(i)}
            onTouchStart={startDrag(i)}
            className="absolute h-7 w-7 rounded-full bg-primary border-2 border-white shadow-lg cursor-grab active:cursor-grabbing"
            style={{
              left: `${c.x * 100}%`,
              top: `${c.y * 100}%`,
              transform: 'translate(-50%, -50%)',
            }}
          />
        ))}
      </div>

      <div className="flex gap-3 p-4 bg-black">
        <Button variant="outline" onClick={onCancel} className="flex-1 bg-transparent text-white border-white/40 hover:bg-white/10">
          Retake
        </Button>
        <Button onClick={confirmCrop} className="flex-1">
          Crop & Continue
        </Button>
      </div>
    </div>
  );
}


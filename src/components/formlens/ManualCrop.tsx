/**
 * Manual 4-corner crop UI with accurate object-contain coordinate mapping
 * and projective perspective correction (homography warp).
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface Corner {
  x: number; // 0–1 relative to actual image dimensions
  y: number;
}

interface Props {
  imageDataUrl: string;
  imageData: ImageData;
  onCrop: (cropped: ImageData, dataUrl: string) => void;
  onCancel: () => void;
}

const DEFAULT_CORNERS: Corner[] = [
  { x: 0.03, y: 0.03 }, // Top-left
  { x: 0.97, y: 0.03 }, // Top-right
  { x: 0.97, y: 0.97 }, // Bottom-right
  { x: 0.03, y: 0.97 }, // Bottom-left
];

/** Compute 3x3 homography mapping destination (0,0)-(w,0)-(w,h)-(0,h) to source quad. */
function computeHomography(
  dstW: number,
  dstH: number,
  src: [Corner, Corner, Corner, Corner],
): number[] {
  const dst: [Corner, Corner, Corner, Corner] = [
    { x: 0, y: 0 },
    { x: dstW, y: 0 },
    { x: dstW, y: dstH },
    { x: 0, y: dstH },
  ];

  // Solve 8x8 linear system A * h = b using Gaussian elimination
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const sx = src[i]!.x;
    const sy = src[i]!.y;
    const dx = dst[i]!.x;
    const dy = dst[i]!.y;
    A.push([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx]);
    b.push(sx);
    A.push([0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy]);
    b.push(sy);
  }

  const n = 8;
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k]![i]!) > Math.abs(A[maxRow]![i]!)) maxRow = k;
    }
    [A[i], A[maxRow]] = [A[maxRow]!, A[i]!];
    [b[i], b[maxRow]] = [b[maxRow]!, b[i]!];

    const pivot = A[i]![i]!;
    if (Math.abs(pivot) < 1e-10) continue;
    for (let k = i + 1; k < n; k++) {
      const factor = A[k]![i]! / pivot;
      b[k]! -= factor * b[i]!;
      for (let j = i; j < n; j++) {
        A[k]![j]! -= factor * A[i]![j]!;
      }
    }
  }

  const h = new Array<number>(9).fill(0);
  h[8] = 1;
  for (let i = n - 1; i >= 0; i--) {
    let sum = b[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= A[i]![j]! * h[j]!;
    }
    h[i] = sum / (A[i]![i] || 1);
  }
  return h;
}

/** Warp source ImageData quadrilateral (in pixel coords) into upright rectangle. */
function warpPerspective(
  srcData: ImageData,
  srcQuad: [Corner, Corner, Corner, Corner],
): ImageData {
  const topW = Math.hypot(srcQuad[1].x - srcQuad[0].x, srcQuad[1].y - srcQuad[0].y);
  const botW = Math.hypot(srcQuad[2].x - srcQuad[3].x, srcQuad[2].y - srcQuad[3].y);
  const leftH = Math.hypot(srcQuad[3].x - srcQuad[0].x, srcQuad[3].y - srcQuad[0].y);
  const rightH = Math.hypot(srcQuad[2].x - srcQuad[1].x, srcQuad[2].y - srcQuad[1].y);

  let outW = Math.max(1, Math.round(Math.max(topW, botW)));
  let outH = Math.max(1, Math.round(Math.max(leftH, rightH)));

  // Cap output resolution at 1600px on longest side for fast, crisp OCR
  const maxDim = 1600;
  if (Math.max(outW, outH) > maxDim) {
    const s = maxDim / Math.max(outW, outH);
    outW = Math.max(1, Math.round(outW * s));
    outH = Math.max(1, Math.round(outH * s));
  }

  const H = computeHomography(outW, outH, srcQuad);
  const out = new ImageData(outW, outH);
  const sW = srcData.width;
  const sH = srcData.height;
  const sBuf = srcData.data;
  const dBuf = out.data;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = H[6]! * x + H[7]! * y + H[8]!;
      const sx = (H[0]! * x + H[1]! * y + H[2]!) / denom;
      const sy = (H[3]! * x + H[4]! * y + H[5]!) / denom;

      const x0 = Math.max(0, Math.min(sW - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(sH - 1, Math.floor(sy)));
      const x1 = Math.min(sW - 1, x0 + 1);
      const y1 = Math.min(sH - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const fy = Math.max(0, Math.min(1, sy - y0));

      const i00 = (y0 * sW + x0) * 4;
      const i10 = (y0 * sW + x1) * 4;
      const i01 = (y1 * sW + x0) * 4;
      const i11 = (y1 * sW + x1) * 4;
      const dstIdx = (y * outW + x) * 4;

      for (let c = 0; c < 3; c++) {
        const v =
          (sBuf[i00 + c]! * (1 - fx) + sBuf[i10 + c]! * fx) * (1 - fy) +
          (sBuf[i01 + c]! * (1 - fx) + sBuf[i11 + c]! * fx) * fy;
        dBuf[dstIdx + c] = Math.round(v);
      }
      dBuf[dstIdx + 3] = 255;
    }
  }
  return out;
}

export function ManualCrop({ imageDataUrl, imageData, onCrop, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [corners, setCorners] = useState<Corner[]>(DEFAULT_CORNERS);
  const [dragging, setDragging] = useState<number | null>(null);
  const [imgBox, setImgBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // Measure actual rendered image bounds inside object-contain container
  const updateImageBounds = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (cw === 0 || ch === 0) return;

    const imgAspect = imageData.width / imageData.height;
    const boxAspect = cw / ch;
    let width: number;
    let height: number;
    if (imgAspect > boxAspect) {
      width = cw;
      height = cw / imgAspect;
    } else {
      height = ch;
      width = ch * imgAspect;
    }
    setImgBox({
      left: (cw - width) / 2,
      top: (ch - height) / 2,
      width,
      height,
    });
  }, [imageData.width, imageData.height]);

  useEffect(() => {
    updateImageBounds();
    window.addEventListener('resize', updateImageBounds);
    return () => window.removeEventListener('resize', updateImageBounds);
  }, [updateImageBounds]);

  const getRelativePos = useCallback((e: React.TouchEvent | React.MouseEvent | TouchEvent | MouseEvent): Corner => {
    const container = containerRef.current!;
    const rect = container.getBoundingClientRect();
    const box = imgBox ?? { left: 0, top: 0, width: rect.width, height: rect.height };
    const clientX = 'touches' in e ? (e.touches[0]?.clientX ?? 0) : (e as MouseEvent).clientX;
    const clientY = 'touches' in e ? (e.touches[0]?.clientY ?? 0) : (e as MouseEvent).clientY;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top - box.top) / box.height)),
    };
  }, [imgBox]);

  const startDrag = useCallback((index: number) => (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    setDragging(index);
  }, []);

  useEffect(() => {
    if (dragging === null) return;
    const move = (e: TouchEvent | MouseEvent) => {
      const pos = getRelativePos(e);
      setCorners((prev) => prev.map((c, i) => (i === dragging ? pos : c)));
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
    const srcQuad: [Corner, Corner, Corner, Corner] = [
      { x: corners[0]!.x * imageData.width, y: corners[0]!.y * imageData.height },
      { x: corners[1]!.x * imageData.width, y: corners[1]!.y * imageData.height },
      { x: corners[2]!.x * imageData.width, y: corners[2]!.y * imageData.height },
      { x: corners[3]!.x * imageData.width, y: corners[3]!.y * imageData.height },
    ];

    const warped = warpPerspective(imageData, srcQuad);
    const canvas = document.createElement('canvas');
    canvas.width = warped.width;
    canvas.height = warped.height;
    canvas.getContext('2d')!.putImageData(warped, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    onCrop(warped, dataUrl);
  }, [corners, imageData, onCrop]);

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
        <img
          src={imageDataUrl}
          alt="Captured form"
          onLoad={updateImageBounds}
          className="h-full w-full object-contain"
          draggable={false}
        />

        {/* Overlay aligned exactly to rendered image dimensions */}
        {imgBox && (
          <div
            className="absolute"
            style={{
              left: imgBox.left,
              top: imgBox.top,
              width: imgBox.width,
              height: imgBox.height,
            }}
          >
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <polygon
                points={corners.map((c) => `${c.x * imgBox.width},${c.y * imgBox.height}`).join(' ')}
                fill="rgba(37,99,235,0.15)"
                stroke="#2563eb"
                strokeWidth="2"
              />
            </svg>

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
        )}
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

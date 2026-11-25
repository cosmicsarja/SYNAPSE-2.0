/**
 * PP-OCRv4 DBNet text detection + pure-TS DB probability map post-processing,
 * oriented bounding boxes, reading-order sort, and perspective-warped cropping.
 */
import * as ort from 'onnxruntime-web/wasm';
import { DET_MODEL_CONFIG, ORT_CONFIG } from '@/config/ocrModels';

export type Point2D = [number, number];
export type Quad = [Point2D, Point2D, Point2D, Point2D]; // TL, TR, BR, BL

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface DetectedBox {
  quad: Quad;
  bbox: BBox;
  score: number;
  rotated90: boolean;
}

export interface DbPostProcessOptions {
  thresh?: number;
  boxThresh?: number;
  minBoxSize?: number;
  unclipRatio?: number;
  maxCandidates?: number;
}

export interface DetectResult {
  boxes: DetectedBox[];
  loadMs: number;
  detectMs: number;
}

let cachedDetSession: ort.InferenceSession | null = null;
let detLoadMs = 0;

export async function getDetectorSession(): Promise<{ session: ort.InferenceSession; loadMs: number }> {
  if (cachedDetSession) {
    return { session: cachedDetSession, loadMs: detLoadMs };
  }
  const t0 = performance.now();
  // Note: ort.env.wasm is configured once in ocr.worker.ts at module load time.

  let lastErr: unknown = null;
  for (const provider of ORT_CONFIG.PROVIDERS) {
    try {
      cachedDetSession = await ort.InferenceSession.create(DET_MODEL_CONFIG.modelPath, {
        executionProviders: [provider],
      });
      detLoadMs = Math.round(performance.now() - t0);
      return { session: cachedDetSession, loadMs: detLoadMs };
    } catch (err) {
      lastErr = err;
      console.warn(`[Detector] Provider ${provider} failed:`, err);
    }
  }
  throw new Error(
    `Failed to load detection model (${DET_MODEL_CONFIG.modelPath}): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/**
 * Resize image so longest side <= maxSideLen and both dims are multiples of strideMultiple (32).
 * Extracts BGR normalized float32 tensor [1, 3, H, W].
 */
export function preprocessForDetection(
  image: ImageData,
  maxSideLen: number = DET_MODEL_CONFIG.maxSideLen,
): { tensor: ort.Tensor; resizedW: number; resizedH: number; ratioW: number; ratioH: number } {
  const srcW = Math.max(1, image.width);
  const srcH = Math.max(1, image.height);
  const longest = Math.max(srcW, srcH);
  const scale = longest > maxSideLen ? maxSideLen / longest : 1;

  const mult = DET_MODEL_CONFIG.strideMultiple;
  const resizedW = Math.max(mult, Math.round((srcW * scale) / mult) * mult);
  const resizedH = Math.max(mult, Math.round((srcH * scale) / mult) * mult);

  const srcCanvas = new OffscreenCanvas(srcW, srcH);
  srcCanvas.getContext('2d')!.putImageData(image, 0, 0);

  const dstCanvas = new OffscreenCanvas(resizedW, resizedH);
  const dctx = dstCanvas.getContext('2d')!;
  dctx.imageSmoothingEnabled = true;
  dctx.imageSmoothingQuality = 'high';
  dctx.drawImage(srcCanvas, 0, 0, srcW, srcH, 0, 0, resizedW, resizedH);

  const resized = dctx.getImageData(0, 0, resizedW, resizedH).data;
  const area = resizedW * resizedH;
  const data = new Float32Array(3 * area);
  const [m0, m1, m2] = DET_MODEL_CONFIG.mean;
  const [s0, s1, s2] = DET_MODEL_CONFIG.std;

  // BGR channel order
  for (let i = 0; i < area; i++) {
    const p = i * 4;
    const r = (resized[p] ?? 0) / 255;
    const g = (resized[p + 1] ?? 0) / 255;
    const b = (resized[p + 2] ?? 0) / 255;
    data[i] = (b - m0) / s0;
    data[area + i] = (g - m1) / s1;
    data[2 * area + i] = (r - m2) / s2;
  }

  return {
    tensor: new ort.Tensor('float32', data, [1, 3, resizedH, resizedW]),
    resizedW,
    resizedH,
    ratioW: srcW / resizedW,
    ratioH: srcH / resizedH,
  };
}

/** Compute 2D convex hull (Monotone Chain) for a set of points. */
function convexHull(pts: Point2D[]): Point2D[] {
  if (pts.length <= 3) return pts.slice();
  const sorted = pts.slice().sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Order 4 corners clockwise starting from top-left (TL, TR, BR, BL). */
function orderQuadClockwise(pts: Point2D[]): Quad {
  const sortedY = pts.slice().sort((a, b) => a[1] - b[1]);
  const top = sortedY.slice(0, 2).sort((a, b) => a[0] - b[0]);
  const bot = sortedY.slice(2, 4).sort((a, b) => a[0] - b[0]);
  return [top[0]!, top[1]!, bot[1]!, bot[0]!];
}

/** Minimum-area oriented rectangle around a convex hull via rotating edge projections. */
function minAreaRect(points: Point2D[]): { quad: Quad; shortSide: number; width: number; height: number } {
  const hull = convexHull(points);
  if (hull.length < 3) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    return {
      quad: [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]],
      shortSide: Math.min(w, h),
      width: w,
      height: h,
    };
  }

  let bestArea = Infinity;
  let bestQuad: Quad = [[0, 0], [0, 0], [0, 0], [0, 0]];
  let bestW = 0;
  let bestH = 0;

  for (let i = 0; i < hull.length; i++) {
    const p0 = hull[i]!;
    const p1 = hull[(i + 1) % hull.length]!;
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;

    const ux = dx / len;
    const uy = dy / len;
    const vx = -uy;
    const vy = ux;

    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = x * vx + y * vy;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (area < bestArea) {
      bestArea = area;
      bestW = w;
      bestH = h;
      const corners: Point2D[] = [
        [minU * ux + minV * vx, minU * uy + minV * vy],
        [maxU * ux + minV * vx, maxU * uy + minV * vy],
        [maxU * ux + maxV * vx, maxU * uy + maxV * vy],
        [minU * ux + maxV * vx, minU * uy + maxV * vy],
      ];
      bestQuad = orderQuadClockwise(corners);
    }
  }

  return { quad: bestQuad, shortSide: Math.min(bestW, bestH), width: bestW, height: bestH };
}

/** Unclip (expand) a clockwise quad outward using DBNet distance = area * ratio / perimeter. */
function unclipQuad(quad: Quad, unclipRatio: number): Quad {
  // Shoelace area & perimeter
  let area = 0;
  let perim = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = quad[i]!;
    const [x2, y2] = quad[(i + 1) % 4]!;
    area += x1 * y2 - x2 * y1;
    perim += Math.hypot(x2 - x1, y2 - y1);
  }
  area = Math.abs(area) / 2;
  if (perim < 1e-3) return quad;

  const dist = (area * unclipRatio) / perim;
  const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
  const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;

  // Offset each edge outward by `dist` along its outward normal, then intersect adjacent edges
  const shiftedLines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (let i = 0; i < 4; i++) {
    const p1 = quad[i]!;
    const p2 = quad[(i + 1) % 4]!;
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const len = Math.hypot(dx, dy) || 1;
    // Candidate normal
    let nx = dy / len;
    let ny = -dx / len;
    // Ensure normal points away from centroid
    const mx = (p1[0] + p2[0]) / 2;
    const my = (p1[1] + p2[1]) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    shiftedLines.push({
      x1: p1[0] + nx * dist,
      y1: p1[1] + ny * dist,
      x2: p2[0] + nx * dist,
      y2: p2[1] + ny * dist,
    });
  }

  const out: Point2D[] = [];
  for (let i = 0; i < 4; i++) {
    const l1 = shiftedLines[(i + 3) % 4]!;
    const l2 = shiftedLines[i]!;
    const a1 = l1.y2 - l1.y1;
    const b1 = l1.x1 - l1.x2;
    const c1 = a1 * l1.x1 + b1 * l1.y1;
    const a2 = l2.y2 - l2.y1;
    const b2 = l2.x1 - l2.x2;
    const c2 = a2 * l2.x1 + b2 * l2.y1;
    const det = a1 * b2 - a2 * b1;
    if (Math.abs(det) < 1e-6) {
      out.push(quad[i]!);
    } else {
      out.push([(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det]);
    }
  }
  return orderQuadClockwise(out);
}

/**
 * Pure-TypeScript DBNet probability map post-processing.
 * Exported for unit testing.
 */
export function postProcessDbMap(
  probMap: Float32Array,
  mapW: number,
  mapH: number,
  origW: number,
  origH: number,
  opts: DbPostProcessOptions = {},
): DetectedBox[] {
  const thresh = opts.thresh ?? DET_MODEL_CONFIG.thresh;
  const boxThresh = opts.boxThresh ?? DET_MODEL_CONFIG.boxThresh;
  const minBoxSize = opts.minBoxSize ?? DET_MODEL_CONFIG.minBoxSize;
  const unclipRatio = opts.unclipRatio ?? DET_MODEL_CONFIG.unclipRatio;
  const maxCandidates = opts.maxCandidates ?? DET_MODEL_CONFIG.maxCandidates;

  const visited = new Uint8Array(mapW * mapH);
  const queue = new Int32Array(mapW * mapH);
  const ratioW = origW / mapW;
  const ratioH = origH / mapH;
  const results: DetectedBox[] = [];

  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const startIdx = y * mapW + x;
      if (visited[startIdx] || (probMap[startIdx] ?? 0) < thresh) continue;

      // BFS connected component (8-connected)
      let head = 0;
      let tail = 0;
      queue[tail++] = startIdx;
      visited[startIdx] = 1;

      const boundaryPts: Point2D[] = [];
      let probSum = 0;
      let count = 0;
      let minX = x, maxX = x, minY = y, maxY = y;

      while (head < tail) {
        const cur = queue[head++]!;
        const cy = Math.floor(cur / mapW);
        const cx = cur - cy * mapW;
        probSum += probMap[cur] ?? 0;
        count++;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        let isBoundary = false;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = cy + dy;
          if (ny < 0 || ny >= mapH) { isBoundary = true; continue; }
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            if (nx < 0 || nx >= mapW) { isBoundary = true; continue; }
            const nIdx = ny * mapW + nx;
            if ((probMap[nIdx] ?? 0) < thresh) {
              isBoundary = true;
            } else if (!visited[nIdx]) {
              visited[nIdx] = 1;
              queue[tail++] = nIdx;
            }
          }
        }
        if (isBoundary) {
          boundaryPts.push([cx + 0.5, cy + 0.5]);
        }
      }

      if (count < 4) continue;
      const boxScore = probSum / count;
      if (boxScore < boxThresh) continue;

      const rect = minAreaRect(boundaryPts.length >= 3 ? boundaryPts : [[minX, minY], [maxX + 1, minY], [maxX + 1, maxY + 1], [minX, maxY + 1]]);
      if (rect.shortSide < minBoxSize) continue;

      const expanded = unclipQuad(rect.quad, unclipRatio);
      const mappedQuad: Quad = [
        [clamp(expanded[0][0] * ratioW, 0, origW), clamp(expanded[0][1] * ratioH, 0, origH)],
        [clamp(expanded[1][0] * ratioW, 0, origW), clamp(expanded[1][1] * ratioH, 0, origH)],
        [clamp(expanded[2][0] * ratioW, 0, origW), clamp(expanded[2][1] * ratioH, 0, origH)],
        [clamp(expanded[3][0] * ratioW, 0, origW), clamp(expanded[3][1] * ratioH, 0, origH)],
      ];

      const xs = mappedQuad.map((p) => p[0]);
      const ys = mappedQuad.map((p) => p[1]);
      const bbox: BBox = {
        x0: Math.floor(Math.min(...xs)),
        y0: Math.floor(Math.min(...ys)),
        x1: Math.ceil(Math.max(...xs)),
        y1: Math.ceil(Math.max(...ys)),
      };
      if (bbox.x1 - bbox.x0 < minBoxSize || bbox.y1 - bbox.y0 < minBoxSize) continue;

      const boxH = Math.hypot(mappedQuad[3][0] - mappedQuad[0][0], mappedQuad[3][1] - mappedQuad[0][1]);
      const boxW = Math.hypot(mappedQuad[1][0] - mappedQuad[0][0], mappedQuad[1][1] - mappedQuad[0][1]);

      results.push({
        quad: mappedQuad,
        bbox,
        score: boxScore,
        rotated90: boxH > boxW * 1.5,
      });

      if (results.length >= maxCandidates) break;
    }
    if (results.length >= maxCandidates) break;
  }

  return sortBoxesReadingOrder(results);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Sorts detected boxes into natural reading order: top-to-bottom grouped into
 * lines (with height-based tolerance), then left-to-right within each line.
 */
export function sortBoxesReadingOrder<T extends { bbox: BBox }>(boxes: T[]): T[] {
  if (boxes.length <= 1) return boxes.slice();

  const heights = boxes.map((b) => Math.max(1, b.bbox.y1 - b.bbox.y0)).sort((a, b) => a - b);
  const medianH = heights[Math.floor(heights.length / 2)] ?? 20;
  const yTol = Math.max(8, medianH * 0.55);

  const sortedByY = boxes
    .slice()
    .sort((a, b) => (a.bbox.y0 + a.bbox.y1) / 2 - (b.bbox.y0 + b.bbox.y1) / 2);

  const lines: Array<{ centerY: number; items: T[] }> = [];
  for (const box of sortedByY) {
    const cy = (box.bbox.y0 + box.bbox.y1) / 2;
    const match = lines.find((line) => Math.abs(line.centerY - cy) <= yTol);
    if (match) {
      match.items.push(box);
      match.centerY =
        match.items.reduce((s, it) => s + (it.bbox.y0 + it.bbox.y1) / 2, 0) / match.items.length;
    } else {
      lines.push({ centerY: cy, items: [box] });
    }
  }

  lines.sort((a, b) => a.centerY - b.centerY);
  const ordered: T[] = [];
  for (const line of lines) {
    line.items.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    ordered.push(...line.items);
  }
  return ordered;
}

/**
 * Crops an oriented quadrilateral from the full-resolution ImageData using
 * perspective/bilinear mapping; rotates 90° CCW if crop is much taller than wide.
 * Expands the quad slightly (~8% vertical, ~3% horizontal) so Kannada top vowel
 * signs and bottom ottaksharas are not clipped at tight detection boundaries.
 */
export function cropBoxFromImageData(
  source: ImageData,
  quad: Quad,
): { crop: ImageData; rotated90: boolean } {
  const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
  const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
  const paddedQuad: Quad = quad.map(([qx, qy]) => {
    const dx = qx - cx;
    const dy = qy - cy;
    const px = Math.max(0, Math.min(source.width - 1, cx + dx * 1.04 + Math.sign(dx) * 1.5));
    const py = Math.max(0, Math.min(source.height - 1, cy + dy * 1.10 + Math.sign(dy) * 1.5));
    return [px, py] as Point2D;
  }) as Quad;

  const topW = Math.hypot(paddedQuad[1][0] - paddedQuad[0][0], paddedQuad[1][1] - paddedQuad[0][1]);
  const botW = Math.hypot(paddedQuad[2][0] - paddedQuad[3][0], paddedQuad[2][1] - paddedQuad[3][1]);
  const leftH = Math.hypot(paddedQuad[3][0] - paddedQuad[0][0], paddedQuad[3][1] - paddedQuad[0][1]);
  const rightH = Math.hypot(paddedQuad[2][0] - paddedQuad[1][0], paddedQuad[2][1] - paddedQuad[1][1]);

  const w = Math.max(4, Math.round(Math.max(topW, botW)));
  const h = Math.max(4, Math.round(Math.max(leftH, rightH)));

  const dst = new Uint8ClampedArray(w * h * 4);
  const srcW = source.width;
  const srcH = source.height;
  const src = source.data;

  // Bilinear quad-to-rectangle sampling: P(u,v) = (1-u)(1-v)TL + u(1-v)TR + uv*BR + (1-u)v*BL
  for (let y = 0; y < h; y++) {
    const v = h > 1 ? y / (h - 1) : 0;
    const invV = 1 - v;
    for (let x = 0; x < w; x++) {
      const u = w > 1 ? x / (w - 1) : 0;
      const invU = 1 - u;

      const sx =
        invU * invV * paddedQuad[0][0] +
        u * invV * paddedQuad[1][0] +
        u * v * paddedQuad[2][0] +
        invU * v * paddedQuad[3][0];
      const sy =
        invU * invV * paddedQuad[0][1] +
        u * invV * paddedQuad[1][1] +
        u * v * paddedQuad[2][1] +
        invU * v * paddedQuad[3][1];

      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(sy)));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const fx = sx - x0;
      const fy = sy - y0;

      const i00 = (y0 * srcW + x0) * 4;
      const i10 = (y0 * srcW + x1) * 4;
      const i01 = (y1 * srcW + x0) * 4;
      const i11 = (y1 * srcW + x1) * 4;
      const outIdx = (y * w + x) * 4;

      for (let c = 0; c < 3; c++) {
        const val =
          (src[i00 + c] ?? 255) * (1 - fx) * (1 - fy) +
          (src[i10 + c] ?? 255) * fx * (1 - fy) +
          (src[i01 + c] ?? 255) * (1 - fx) * fy +
          (src[i11 + c] ?? 255) * fx * fy;
        dst[outIdx + c] = Math.round(val);
      }
      dst[outIdx + 3] = 255;
    }
  }

  // Rotate 90° CCW if crop is vertical (height > 1.5 * width)
  if (h > w * 1.5) {
    const rot = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const srcIdx = (y * w + x) * 4;
        const nx = y;
        const ny = w - 1 - x;
        const dstIdx = (ny * h + nx) * 4;
        rot[dstIdx] = dst[srcIdx]!;
        rot[dstIdx + 1] = dst[srcIdx + 1]!;
        rot[dstIdx + 2] = dst[srcIdx + 2]!;
        rot[dstIdx + 3] = 255;
      }
    }
    return { crop: makeImageData(rot, h, w), rotated90: true };
  }

  return { crop: makeImageData(dst, w, h), rotated90: false };
}

/** Run full DBNet detection on a page ImageData. */

function makeImageData(data: Uint8ClampedArray, width: number, height: number): ImageData {
  if (typeof ImageData !== 'undefined') {
    return new ImageData(data, width, height);
  }
  return { data, width, height } as ImageData;
}
export async function detectTextBoxes(
  image: ImageData,
  maxSideLen: number = DET_MODEL_CONFIG.maxSideLen,
): Promise<DetectResult> {
  const { session, loadMs } = await getDetectorSession();
  const t0 = performance.now();

  const { tensor, resizedW, resizedH } = preprocessForDetection(image, maxSideLen);
  let outTensor: ort.Tensor | undefined;
  try {
    const outputs = await session.run({ [DET_MODEL_CONFIG.inputName]: tensor });
    outTensor = outputs[DET_MODEL_CONFIG.outputName] ?? Object.values(outputs)[0];
    if (!outTensor) {
      throw new Error('Detection model returned no output tensor.');
    }
    const probMap = outTensor.data as Float32Array;
    const boxes = postProcessDbMap(probMap, resizedW, resizedH, image.width, image.height);
    return {
      boxes,
      loadMs,
      detectMs: Math.round(performance.now() - t0),
    };
  } finally {
    tensor.dispose();
    outTensor?.dispose();
  }
}

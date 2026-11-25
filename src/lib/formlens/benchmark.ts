/**
 * Benchmark & Diagnostics runner for public/bench/pages/.
 * Reports detection recall/precision @ IoU 0.5, CER & exact-match per script,
 * confidence histogram, and pipeline timings.
 */
import { computeBBoxIoU } from '@/lib/formlens/boxAssignment';
import { CONFIDENCE_THRESHOLDS } from '@/config/ocrModels';
import type { FullPipelineOutput } from '@/workers/pipeline/paddle-engine';

export interface BenchGroundTruthBox {
  bbox: [number, number, number, number]; // [x0, y0, x1, y1]
  text: string;
  script?: 'kn' | 'en' | 'mixed';
}

export interface BenchPageResult {
  pageId: string;
  boxesDetected: number;
  detPrecision: number | null;
  detRecall: number | null;
  cerByScript: Record<'kn' | 'en' | 'mixed', { cer: number; exactMatch: number; count: number }>;
  confHistogram: { high: number; medium: number; low: number };
  timings: FullPipelineOutput['timings'];
}

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[m]![n]!;
}

async function loadImageAsImageData(url: string): Promise<ImageData> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load benchmark image: ${url}`));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export async function runDiagnosticsBenchmark(
  runPipeline: (imageData: ImageData) => Promise<FullPipelineOutput>,
): Promise<BenchPageResult[]> {
  const manRes = await fetch('/bench/pages/manifest.json');
  if (!manRes.ok) throw new Error('Benchmark manifest /bench/pages/manifest.json not found');
  const man = (await manRes.json()) as { pages: string[] };

  const out: BenchPageResult[] = [];

  for (const pageId of man.pages) {
    const imgUrl = `/bench/pages/${pageId}.png`;
    const imageData = await loadImageAsImageData(imgUrl);
    const pipelineOut = await runPipeline(imageData);

    const confHistogram = { high: 0, medium: 0, low: 0 };
    for (const r of pipelineOut.results) {
      if (r.confidence >= CONFIDENCE_THRESHOLDS.high) confHistogram.high++;
      else if (r.confidence >= CONFIDENCE_THRESHOLDS.medium) confHistogram.medium++;
      else confHistogram.low++;
    }

    let detPrecision: number | null = null;
    let detRecall: number | null = null;
    const cerByScript: BenchPageResult['cerByScript'] = {
      kn: { cer: 0, exactMatch: 0, count: 0 },
      en: { cer: 0, exactMatch: 0, count: 0 },
      mixed: { cer: 0, exactMatch: 0, count: 0 },
    };

    const lblRes = await fetch(`/bench/pages/${pageId}.json`).catch(() => null);
    if (lblRes && lblRes.ok) {
      const gt = (await lblRes.json()) as { boxes?: BenchGroundTruthBox[] };
      const gtBoxes = gt.boxes ?? [];
      if (gtBoxes.length > 0) {
        let matchedGt = 0;
        const matchedPred = new Set<number>();

        const scriptAcc: Record<'kn' | 'en' | 'mixed', { edits: number; chars: number; exact: number; count: number }> = {
          kn: { edits: 0, chars: 0, exact: 0, count: 0 },
          en: { edits: 0, chars: 0, exact: 0, count: 0 },
          mixed: { edits: 0, chars: 0, exact: 0, count: 0 },
        };

        for (const g of gtBoxes) {
          const gBox = { x0: g.bbox[0], y0: g.bbox[1], x1: g.bbox[2], y1: g.bbox[3] };
          let bestPredIdx = -1;
          let bestIou = 0;
          pipelineOut.results.forEach((p, idx) => {
            const { iou } = computeBBoxIoU(p.box.bbox, gBox);
            if (iou >= 0.5 && iou > bestIou) {
              bestIou = iou;
              bestPredIdx = idx;
            }
          });
          if (bestPredIdx >= 0) {
            matchedGt++;
            matchedPred.add(bestPredIdx);
            const predText = pipelineOut.results[bestPredIdx]!.text;
            const sc = g.script ?? 'en';
            scriptAcc[sc].edits += levenshtein(predText, g.text);
            scriptAcc[sc].chars += Math.max(1, g.text.length);
            if (predText === g.text) scriptAcc[sc].exact++;
            scriptAcc[sc].count++;
          }
        }

        detRecall = matchedGt / gtBoxes.length;
        detPrecision = pipelineOut.results.length > 0 ? matchedPred.size / pipelineOut.results.length : 0;

        for (const sc of ['kn', 'en', 'mixed'] as const) {
          const a = scriptAcc[sc];
          if (a.count > 0) {
            cerByScript[sc] = {
              cer: a.edits / Math.max(1, a.chars),
              exactMatch: a.exact / a.count,
              count: a.count,
            };
          }
        }
      }
    }

    out.push({
      pageId,
      boxesDetected: pipelineOut.results.length,
      detPrecision,
      detRecall,
      cerByScript,
      confHistogram,
      timings: pipelineOut.timings,
    });
  }

  return out;
}

/**
 * Box-to-template-field assignment (IoU / containment) and Auto-mode
 * fuzzy label/value pairing for Kannada + English forms.
 */
import type { BBox } from '@/workers/pipeline/detect';
import { snapKannadaFormTerm } from '@/lib/formlens/kannadaNormalize';

export interface TemplateFieldDef {
  id: string;
  labelEn: string;
  labelKn: string;
  type: string;
  bbox: { x: number; y: number; w: number; h: number }; // percentage 0-100
}

export interface PositionedOcrBox {
  bbox: BBox;
  text: string;
  label?: string;
  confidence: number;
  script: 'kn' | 'en' | 'mixed';
  model: string;
  cropDataUrl?: string;
}

export interface AssignedTemplateField {
  fieldId: string;
  labelEn: string;
  labelKn: string;
  fieldType: string;
  textValue: string;
  originalText: string;
  confidence: number;
  notFound: boolean;
  boxIndices: number[];
  normBbox: [number, number, number, number]; // [x0, y0, x1, y1] in 0..1
}

export interface AutoPairedItem {
  kind: 'paired' | 'other';
  fieldId: string;
  labelEn: string;
  labelKn: string;
  textValue: string;
  originalText: string;
  confidence: number;
  script: 'kn' | 'en' | 'mixed';
  model: string;
  boxIndex: number;
  normBbox: [number, number, number, number];
  cropDataUrl?: string;
}

export function computeBBoxIoU(a: BBox, b: BBox): { iou: number; containment: number } {
  const ix0 = Math.max(a.x0, b.x0);
  const iy0 = Math.max(a.y0, b.y0);
  const ix1 = Math.min(a.x1, b.x1);
  const iy1 = Math.min(a.y1, b.y1);
  if (ix1 <= ix0 || iy1 <= iy0) return { iou: 0, containment: 0 };

  const inter = (ix1 - ix0) * (iy1 - iy0);
  const areaA = Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0));
  const areaB = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
  const union = areaA + areaB - inter;
  return {
    iou: union > 0 ? inter / union : 0,
    containment: inter / areaA,
  };
}

/**
 * Assigns each detected box to the template field with maximum overlap (containment + IoU).
 * Multiple boxes in one field are joined in reading order; empty fields are flagged "Not found".
 */
export function assignBoxesToTemplateFields(
  boxes: PositionedOcrBox[],
  templateFields: TemplateFieldDef[],
  imgW: number,
  imgH: number,
): AssignedTemplateField[] {
  const fieldPxBoxes: BBox[] = templateFields.map((f) => ({
    x0: (f.bbox.x / 100) * imgW,
    y0: (f.bbox.y / 100) * imgH,
    x1: ((f.bbox.x + f.bbox.w) / 100) * imgW,
    y1: ((f.bbox.y + f.bbox.h) / 100) * imgH,
  }));

  const assignedByField = new Map<number, number[]>();
  templateFields.forEach((_, fi) => assignedByField.set(fi, []));

  boxes.forEach((box, bi) => {
    let bestField = -1;
    let bestScore = 0;
    for (let fi = 0; fi < fieldPxBoxes.length; fi++) {
      const { iou, containment } = computeBBoxIoU(box.bbox, fieldPxBoxes[fi]!);
      const score = Math.max(iou, containment * 0.85);
      if (score > 0.15 && score > bestScore) {
        bestScore = score;
        bestField = fi;
      }
    }
    if (bestField >= 0) {
      assignedByField.get(bestField)!.push(bi);
    }
  });

  return templateFields.map((f, fi) => {
    const idxs = assignedByField.get(fi) ?? [];
    if (idxs.length === 0) {
      return {
        fieldId: f.id,
        labelEn: f.labelEn,
        labelKn: f.labelKn,
        fieldType: f.type,
        textValue: 'Not found',
        originalText: 'Not found',
        confidence: 0,
        notFound: true,
        boxIndices: [],
        normBbox: [
          f.bbox.x / 100,
          f.bbox.y / 100,
          (f.bbox.x + f.bbox.w) / 100,
          (f.bbox.y + f.bbox.h) / 100,
        ],
      };
    }

    const joined = idxs
      .map((i) => boxes[i]!.text)
      .filter(Boolean)
      .join(' ')
      .trim();
    const avgConf =
      idxs.reduce((s, i) => s + boxes[i]!.confidence, 0) / idxs.length;

    return {
      fieldId: f.id,
      labelEn: f.labelEn,
      labelKn: f.labelKn,
      fieldType: f.type,
      textValue: joined || 'Not found',
      originalText: joined || 'Not found',
      confidence: joined ? avgConf : 0,
      notFound: !joined,
      boxIndices: idxs,
      normBbox: [
        f.bbox.x / 100,
        f.bbox.y / 100,
        (f.bbox.x + f.bbox.w) / 100,
        (f.bbox.y + f.bbox.h) / 100,
      ],
    };
  });
}

function normalizeLabel(s: string): string {
  const snapped = snapKannadaFormTerm(s);
  return snapped.toLowerCase().replace(/[:\-_./,()]/g, ' ').replace(/\s+/g, ' ').trim();
}

function similarity(a: string, b: string): number {
  const sa = normalizeLabel(a);
  const sb = normalizeLabel(b);
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  if (sa.includes(sb) || sb.includes(sa)) return 0.85;

  // Token overlap (Jaccard)
  const ta = new Set(sa.split(' '));
  const tb = new Set(sb.split(' '));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

/**
 * Auto mode: fuzzy-matches boxes against known printed labels (Kannada + English)
 * and pairs each label with the nearest box to its right or below.
 */
export function pairLabelsAndValues(
  boxes: PositionedOcrBox[],
  knownLabels: Array<{ id: string; labelEn: string; labelKn: string }>,
  imgW: number,
  imgH: number,
): AutoPairedItem[] {
  const used = new Set<number>();
  const paired: AutoPairedItem[] = [];

  for (let i = 0; i < boxes.length; i++) {
    if (used.has(i)) continue;
    const b = boxes[i]!;
    let bestLabel: { id: string; labelEn: string; labelKn: string } | null = null;
    let bestSim = 0;

    for (const lbl of knownLabels) {
      const sim = Math.max(similarity(b.text, lbl.labelEn), similarity(b.text, lbl.labelKn));
      if (sim >= 0.6 && sim > bestSim) {
        bestSim = sim;
        bestLabel = lbl;
      }
    }
    if (!bestLabel) continue;

    // Find nearest unpaired box to the right (same row) or below (same column)
    const cy = (b.bbox.y0 + b.bbox.y1) / 2;
    const h = Math.max(10, b.bbox.y1 - b.bbox.y0);
    let bestValIdx = -1;
    let bestDist = Infinity;

    for (let j = 0; j < boxes.length; j++) {
      if (j === i || used.has(j)) continue;
      const cand = boxes[j]!;
      const candCy = (cand.bbox.y0 + cand.bbox.y1) / 2;
      const isRight = cand.bbox.x0 >= b.bbox.x1 - h * 0.5 && Math.abs(candCy - cy) <= h * 1.2;
      const isBelow =
        cand.bbox.y0 >= b.bbox.y1 - h * 0.3 &&
        cand.bbox.y0 <= b.bbox.y1 + h * 3.0 &&
        Math.abs(cand.bbox.x0 - b.bbox.x0) <= Math.max(imgW * 0.25, (b.bbox.x1 - b.bbox.x0) * 1.5);

      if (isRight || isBelow) {
        const dist = isRight
          ? cand.bbox.x0 - b.bbox.x1
          : (cand.bbox.y0 - b.bbox.y1) * 1.5 + Math.abs(cand.bbox.x0 - b.bbox.x0);
        if (dist < bestDist) {
          bestDist = dist;
          bestValIdx = j;
        }
      }
    }

    if (bestValIdx >= 0) {
      used.add(i);
      used.add(bestValIdx);
      const valBox = boxes[bestValIdx]!;
      paired.push({
        kind: 'paired',
        fieldId: bestLabel.id,
        labelEn: bestLabel.labelEn,
        labelKn: bestLabel.labelKn,
        textValue: valBox.text,
        originalText: valBox.text,
        confidence: valBox.confidence,
        script: valBox.script,
        model: valBox.model,
        boxIndex: bestValIdx,
        normBbox: [
          valBox.bbox.x0 / Math.max(1, imgW),
          valBox.bbox.y0 / Math.max(1, imgH),
          valBox.bbox.x1 / Math.max(1, imgW),
          valBox.bbox.y1 / Math.max(1, imgH),
        ],
        cropDataUrl: valBox.cropDataUrl,
      });
    }
  }

  // Remaining boxes under "Other text"
  for (let i = 0; i < boxes.length; i++) {
    if (used.has(i)) continue;
    const b = boxes[i]!;
    paired.push({
      kind: 'other',
      fieldId: `box_${i + 1}`,
      labelEn: `Other text #${i + 1}`,
      labelKn: `ಇತರೆ ಪಠ್ಯ #${i + 1}`,
      textValue: b.text,
      originalText: b.text,
      confidence: b.confidence,
      script: b.script,
      model: b.model,
      boxIndex: i,
      normBbox: [
        b.bbox.x0 / Math.max(1, imgW),
        b.bbox.y0 / Math.max(1, imgH),
        b.bbox.x1 / Math.max(1, imgW),
        b.bbox.y1 / Math.max(1, imgH),
      ],
      cropDataUrl: b.cropDataUrl,
    });
  }

  return paired;
}

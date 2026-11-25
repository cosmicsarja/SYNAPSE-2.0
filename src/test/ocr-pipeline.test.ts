import { describe, it, expect } from 'vitest';
import { postProcessDbMap, sortBoxesReadingOrder } from '@/workers/pipeline/detect';
import { ctcGreedyDecode } from '@/workers/pipeline/paddle-engine';
import { buildCtcVocab, REC_MODELS } from '@/config/ocrModels';
import {
  assignBoxesToTemplateFields,
  pairLabelsAndValues,
  type TemplateFieldDef,
} from '@/lib/formlens/boxAssignment';

describe('DBNet probability map post-processing', () => {
  it('extracts and unclips text blobs from a synthetic probability map', () => {
    const W = 100;
    const H = 60;
    const prob = new Float32Array(W * H);

    // Draw two horizontal text regions: top (y: 10..18, x: 10..50) & bottom (y: 35..43, x: 20..70)
    for (let y = 10; y <= 18; y++) {
      for (let x = 10; x <= 50; x++) prob[y * W + x] = 0.9;
    }
    for (let y = 35; y <= 43; y++) {
      for (let x = 20; x <= 70; x++) prob[y * W + x] = 0.85;
    }

    const boxes = postProcessDbMap(prob, W, H, 200, 120, {
      thresh: 0.3,
      boxThresh: 0.5,
      minBoxSize: 4,
      unclipRatio: 1.5,
    });

    expect(boxes.length).toBe(2);
    // Scaled 2x to orig (200x120), first box is top region
    expect(boxes[0]!.bbox.y0).toBeLessThan(boxes[1]!.bbox.y0);
    expect(boxes[0]!.score).toBeGreaterThan(0.8);
    expect(boxes[0]!.bbox.x1 - boxes[0]!.bbox.x0).toBeGreaterThan(60);
  });
});

describe('Reading-order sorting', () => {
  it('sorts boxes top-to-bottom grouped by line, then left-to-right', () => {
    const unsorted = [
      { id: 'r2c2', bbox: { x0: 200, y0: 105, x1: 280, y1: 125 } },
      { id: 'r1c2', bbox: { x0: 180, y0: 22, x1: 260, y1: 42 } },
      { id: 'r2c1', bbox: { x0: 20, y0: 100, x1: 100, y1: 120 } },
      { id: 'r1c1', bbox: { x0: 15, y0: 20, x1: 95, y1: 40 } },
    ];
    const sorted = sortBoxesReadingOrder(unsorted);
    expect(sorted.map((b) => b.id)).toEqual(['r1c1', 'r1c2', 'r2c1', 'r2c2']);
  });
});

describe('CTC decoding & dictionary alignment', () => {
  it('validates dictionary length vs inspected model C and decodes blank-separated repeats', () => {
    const fakeDict = Array.from({ length: REC_MODELS.en.expectedDictLines }, (_, i) =>
      i === 0 ? 'A' : i === 1 ? 'B' : `c${i}`,
    ).join('\n');
    const vocab = buildCtcVocab(fakeDict, REC_MODELS.en);
    expect(vocab.length).toBe(REC_MODELS.en.numClasses);
    expect(vocab[0]).toBe('<blank>');
    expect(vocab[vocab.length - 1]).toBe(' ');

    // Construct T=5 probability steps for "AAB" -> A (idx 1), A (idx 1), blank (0), A (idx 1), B (idx 2)
    const C = vocab.length;
    const T = 5;
    const probs = new Float32Array(T * C);
    const seq = [1, 1, 0, 1, 2];
    seq.forEach((cls, t) => {
      probs[t * C + cls] = 0.9;
    });

    const decoded = ctcGreedyDecode(probs, T, C, vocab, REC_MODELS.en.blankIndex, true);
    expect(decoded.text).toBe('AAB');
    expect(decoded.confidence).toBeCloseTo(0.9, 4);
  });

  it('throws a clear error if dictionary line count mismatches model C', () => {
    expect(() => buildCtcVocab('a\nb\nc', REC_MODELS.kn)).toThrow(/mismatch/i);
  });
});

describe('Box-to-template assignment & Auto pairing', () => {
  it('assigns overlapping boxes in reading order and flags missing fields as Not found', () => {
    const templateFields: TemplateFieldDef[] = [
      { id: 'name', labelEn: 'Name', labelKn: 'ಹೆಸರು', type: 'name', bbox: { x: 10, y: 10, w: 80, h: 15 } },
      { id: 'phone', labelEn: 'Mobile', labelKn: 'ಮೊಬೈಲ್', type: 'phone', bbox: { x: 10, y: 40, w: 40, h: 15 } },
    ];

    const detected = [
      { bbox: { x0: 120, y0: 120, x1: 300, y1: 200 }, text: 'Ramesh', confidence: 0.9, script: 'en' as const, model: 'ppocrv5-latin' },
      { bbox: { x0: 320, y0: 120, x1: 500, y1: 200 }, text: 'Kumar', confidence: 0.8, script: 'en' as const, model: 'ppocrv5-latin' },
    ];

    const assigned = assignBoxesToTemplateFields(detected, templateFields, 1000, 1000);
    expect(assigned[0]!.textValue).toBe('Ramesh Kumar');
    expect(assigned[0]!.notFound).toBe(false);
    expect(assigned[1]!.textValue).toBe('Not found');
    expect(assigned[1]!.notFound).toBe(true);
  });

  it('pairs fuzzy-matched labels with nearest right/below value boxes in Auto mode', () => {
    const boxes = [
      { bbox: { x0: 40, y0: 50, x1: 180, y1: 80 }, text: 'Applicant Name:', confidence: 0.95, script: 'en' as const, model: 'ppocrv5-latin' },
      { bbox: { x0: 210, y0: 50, x1: 420, y1: 80 }, text: 'Suresh', confidence: 0.88, script: 'en' as const, model: 'ppocrv5-latin' },
      { bbox: { x0: 40, y0: 200, x1: 150, y1: 230 }, text: 'Misc Note', confidence: 0.7, script: 'en' as const, model: 'ppocrv5-latin' },
    ];
    const paired = pairLabelsAndValues(
      boxes,
      [{ id: 'applicant_name', labelEn: 'Applicant Name', labelKn: 'ಅರ್ಜಿದಾರರ ಹೆಸರು' }],
      800,
      600,
    );
    expect(paired[0]!.kind).toBe('paired');
    expect(paired[0]!.fieldId).toBe('applicant_name');
    expect(paired[0]!.textValue).toBe('Suresh');
    expect(paired[1]!.kind).toBe('other');
    expect(paired[1]!.textValue).toBe('Misc Note');
  });
});

import { describe, it, expect } from 'vitest';
import { BilingualSmallLM } from '@/lib/formlens/bilingualSlm';

describe('Bilingual Kannada + English Small Language Model (SLM)', () => {
  it('predicts Kannada and English word completions from prefixes', () => {
    const slm = new BilingualSmallLM();

    const knPreds = slm.predictWords('ರೋಹ');
    expect(knPreds.some((p) => p.word === 'ರೋಹನ್')).toBe(true);

    const knCityPreds = slm.predictWords('ಬೆಂಗ');
    expect(knCityPreds.some((p) => p.word.startsWith('ಬೆಂಗಳೂರು'))).toBe(true);

    const enPreds = slm.predictWords('Karn');
    expect(enPreds.some((p) => p.word === 'Karnataka')).toBe(true);

    const multiToken = slm.predictWords('No. 24, Indir');
    expect(multiToken.some((p) => p.word === 'Indiranagar')).toBe(true);
  });

  it('predicts corrections for noisy Kannada and English OCR words', () => {
    const slm = new BilingualSmallLM();

    const knFix = slm.predictCorrection('ಬೆಂಗಲೂರು');
    expect(knFix).not.toBeNull();
    expect(knFix!.word).toBe('ಬೆಂಗಳೂರು');

    const knLabelFix = slm.predictCorrection('ಹೆಸರ');
    expect(knLabelFix).not.toBeNull();
    expect(knLabelFix!.word).toBe('ಹೆಸರು');

    const enFix = slm.predictCorrection('Karnatka');
    expect(enFix).not.toBeNull();
    expect(enFix!.word).toBe('Karnataka');
  });

  it('learns new words dynamically from user corrections', () => {
    const slm = new BilingualSmallLM();
    slm.addWord('Shivajinagar', 5);
    const preds = slm.predictWords('Shiva');
    expect(preds.some((p) => p.word === 'Shivajinagar')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { normalizeKannadaText, snapKannadaFormTerm } from '@/lib/formlens/kannadaNormalize';
import { createLocalityMatcher, type LocalityData } from '@/lib/formlens/fuzzySnap';
import localitiesJson from '../../public/data/karnataka_localities.json';
import {
  enhanceCropForRecognition,
  selectBestScriptPrediction,
} from '@/workers/pipeline/paddle-engine';
import { cropBoxFromImageData } from '@/workers/pipeline/detect';

describe('Kannada OCR post-processing & normalization', () => {
  it('cleans trailing hyphens, double virama/anusvara, and stray punctuation in Kannada runs', () => {
    expect(normalizeKannadaText('ರಮಶ್-')).toBe('ರಮಶ್');
    expect(normalizeKannadaText('ಕನ್ನ\u0CCD\u0CCDಡ')).toBe('ಕನ್ನ\u0CCDಡ');
    expect(normalizeKannadaText('ಬೆಂ\u0C82\u0C82ಗಳೂರು')).toBe('ಬೆಂ\u0C82ಗಳೂರು');
    expect(normalizeKannadaText('ಹೆಸರು')).toBe('ಹೆಸರು');
  });

  it('collapses 3+ repeated Kannada CTC stutter characters and leaves English untouched', () => {
    expect(normalizeKannadaText('ನನನನ')).toBe('ನ');
    expect(normalizeKannadaText('Ramesh Kumar - 560001')).toBe('Ramesh Kumar - 560001');
  });
});

describe('Adaptive crop contrast enhancement', () => {
  it('stretches low-contrast crops while preserving already high-contrast crops', () => {
    const w = 16;
    const h = 8;
    // Low-contrast crop: values between 90 and 140
    const lowData = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = i % 2 === 0 ? 90 : 140;
      lowData[i * 4] = v;
      lowData[i * 4 + 1] = v;
      lowData[i * 4 + 2] = v;
      lowData[i * 4 + 3] = 255;
    }
    const lowCrop = { data: lowData, width: w, height: h } as ImageData;
    const stretched = enhanceCropForRecognition(lowCrop);
    expect(stretched.data[0]).toBe(0);
    expect(stretched.data[4]).toBe(255);

    // High-contrast crop: values 10 and 245 (range = 235 >= 175) -> untouched
    const highData = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = i % 2 === 0 ? 10 : 245;
      highData[i * 4] = v;
      highData[i * 4 + 1] = v;
      highData[i * 4 + 2] = v;
      highData[i * 4 + 3] = 255;
    }
    const highCrop = { data: highData, width: w, height: h } as ImageData;
    const untouched = enhanceCropForRecognition(highCrop);
    expect(untouched.data[0]).toBe(10);
    expect(untouched.data[4]).toBe(245);
  });
});

describe('Smart bilingual script routing', () => {
  it('gives Kannada script affinity over Latin lookalike noise', () => {
    const picked = selectBestScriptPrediction(
      { text: 'ಹೆಸರು', confidence: 0.78 },
      { text: 'desaru', confidence: 0.82 },
      'ppocrv4-kannada',
      'ppocrv5-latin',
    );
    expect(picked.model).toBe('ppocrv4-kannada');
    expect(picked.text).toBe('ಹೆಸರು');
  });

  it('routes pure numbers/dates to Latin when Latin is clearly more confident', () => {
    const picked = selectBestScriptPrediction(
      { text: '೯೮೭೬', confidence: 0.65 },
      { text: '9876543210', confidence: 0.96 },
      'ppocrv4-kannada',
      'ppocrv5-latin',
    );
    expect(picked.model).toBe('ppocrv5-latin');
    expect(picked.text).toBe('9876543210');
  });

  it('prefers Latin for plain English text', () => {
    const picked = selectBestScriptPrediction(
      { text: 'Bengaluru', confidence: 0.88 },
      { text: 'Bengaluru', confidence: 0.86 },
      'ppocrv4-kannada',
      'ppocrv5-latin',
    );
    expect(picked.model).toBe('ppocrv5-latin');
  });
});

describe('Padded quad cropping', () => {
  it('expands crop slightly for Kannada matras without going out of image bounds', () => {
    const w = 100;
    const h = 40;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const src = { data, width: w, height: h } as ImageData;
    const res = cropBoxFromImageData(src, [
      [10, 10],
      [80, 10],
      [80, 26],
      [10, 26],
    ]);
    expect(res.rotated90).toBe(false);
    expect(res.crop.width).toBeGreaterThan(70);
    expect(res.crop.height).toBeGreaterThan(16);
  });
});

describe('Kannada form lexicon & Karnataka locality fuzzy matching', () => {
  it('snaps noisy Kannada form labels without altering unrelated names', () => {
    expect(snapKannadaFormTerm('ಹೆಸರ:')).toBe('ಹೆಸರು');
    expect(snapKannadaFormTerm('ವಿಳಸ')).toBe('ವಿಳಾಸ');
    expect(snapKannadaFormTerm('ಕರ್ನಾಟಕ್')).toBe('ಕರ್ನಾಟಕ');
    expect(snapKannadaFormTerm('ರಮೇಶ್')).toBe('ರಮೇಶ್');
  });

  it('matches all 31 Karnataka districts in both Kannada and English', () => {
    const data = localitiesJson as LocalityData;
    expect(data.districts.length).toBe(31);
    const match = createLocalityMatcher(data);

    const knMatch = match('ಬೆಂಗಲೂರು ನಗರ');
    expect(knMatch).not.toBeNull();
    expect(knMatch!.value).toBe('ಬೆಂಗಳೂರು ನಗರ');
    expect(knMatch!.englishName).toBe('Bengaluru Urban');

    const enMatch = match('Shivamoga');
    expect(enMatch).not.toBeNull();
    expect(enMatch!.value).toBe('Shivamogga');
    expect(enMatch!.kannadaName).toBe('ಶಿವಮೊಗ್ಗ');

    expect(match('xyzzy12345')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { assessImageQuality, getQualityWarningMessages } from '@/lib/formlens/imageQuality';
import { QUALITY_CONFIG } from '@/config/quality';

function makeImage(
  width: number,
  height: number,
  pixelFn: (x: number, y: number) => [number, number, number],
) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  return { data, width, height };
}

describe('Image quality check (offline)', () => {
  it('passes a sharp, well-lit checkerboard image', () => {
    const img = makeImage(120, 120, (x, y) => {
      const bright = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0) ? 210 : 40;
      return [bright, bright, bright];
    });
    const report = assessImageQuality(img);
    expect(report.isBlurry).toBe(false);
    expect(report.isTooDark).toBe(false);
    expect(report.isTooBright).toBe(false);
    expect(report.hasIssue).toBe(false);
    expect(report.blurScore).toBeGreaterThan(QUALITY_CONFIG.MIN_LAPLACIAN_VARIANCE);
  });

  it('flags a flat/blurry mid-gray image as blurry', () => {
    const img = makeImage(120, 120, () => [128, 128, 128]);
    const report = assessImageQuality(img);
    expect(report.isBlurry).toBe(true);
    expect(report.isTooDark).toBe(false);
    expect(report.isTooBright).toBe(false);
    expect(report.hasIssue).toBe(true);
    expect(getQualityWarningMessages(report).titleEn).toContain('blurry');
    expect(getQualityWarningMessages(report).titleKn).toContain('ಮಂಜಾಗಿದೆ');
  });

  it('flags a very dark image as too dark', () => {
    const img = makeImage(120, 120, (x, y) => {
      const v = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0) ? 25 : 5;
      return [v, v, v];
    });
    const report = assessImageQuality(img);
    expect(report.isTooDark).toBe(true);
    expect(report.hasIssue).toBe(true);
    expect(getQualityWarningMessages(report).titleEn).toContain('dark');
    expect(getQualityWarningMessages(report).titleKn).toContain('ಕತ್ತಲಾಗಿದೆ');
  });

  it('flags an overexposed white image as too bright', () => {
    const img = makeImage(120, 120, () => [250, 250, 250]);
    const report = assessImageQuality(img);
    expect(report.isTooBright).toBe(true);
    expect(report.hasIssue).toBe(true);
    expect(getQualityWarningMessages(report).titleEn).toContain('bright');
  });
});

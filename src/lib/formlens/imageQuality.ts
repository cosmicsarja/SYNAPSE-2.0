/**
 * Pure offline image quality assessment (blur via variance of Laplacian + brightness)
 * on a downscaled grayscale representation of an ImageData buffer.
 */
import { QUALITY_CONFIG, QUALITY_MESSAGES } from '@/config/quality';

export type QualityIssue = 'blurry' | 'dark' | 'bright';

export interface ImageQualityReport {
  blurScore: number;
  brightnessScore: number;
  isBlurry: boolean;
  isTooDark: boolean;
  isTooBright: boolean;
  hasIssue: boolean;
  issues: QualityIssue[];
  analysisWidth: number;
  analysisHeight: number;
}

export interface QualityThresholds {
  MAX_ANALYSIS_WIDTH: number;
  MIN_LAPLACIAN_VARIANCE: number;
  MIN_BRIGHTNESS: number;
  MAX_BRIGHTNESS: number;
}

/**
 * Downscales an RGBA ImageData-like buffer to <= maxWidth and converts to
 * BT.601 grayscale floats [0, 255].
 */
function toDownscaledGrayscale(
  image: Pick<ImageData, 'data' | 'width' | 'height'>,
  maxWidth: number,
): { gray: Float32Array; width: number; height: number } {
  const srcW = Math.max(1, image.width);
  const srcH = Math.max(1, image.height);
  const scale = srcW > maxWidth ? maxWidth / srcW : 1;
  const dstW = Math.max(3, Math.round(srcW * scale));
  const dstH = Math.max(3, Math.round(srcH * scale));
  const gray = new Float32Array(dstW * dstH);
  const src = image.data;

  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      const idx = (sy * srcW + sx) * 4;
      const r = src[idx] ?? 0;
      const g = src[idx + 1] ?? 0;
      const b = src[idx + 2] ?? 0;
      gray[y * dstW + x] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  return { gray, width: dstW, height: dstH };
}

/**
 * Computes blur score (variance of 4-neighbor discrete Laplacian) and mean
 * brightness (0-255) on a downscaled grayscale canvas buffer.
 */
export function assessImageQuality(
  image: Pick<ImageData, 'data' | 'width' | 'height'>,
  thresholds: QualityThresholds = QUALITY_CONFIG,
): ImageQualityReport {
  const { gray, width, height } = toDownscaledGrayscale(image, thresholds.MAX_ANALYSIS_WIDTH);

  let lumSum = 0;
  for (let i = 0; i < gray.length; i++) {
    lumSum += gray[i]!;
  }
  const brightnessScore = gray.length > 0 ? lumSum / gray.length : 0;

  let lapSum = 0;
  let lapSqSum = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const c = gray[row + x]!;
      const lap =
        gray[row + x - 1]! +
        gray[row + x + 1]! +
        gray[row - width + x]! +
        gray[row + width + x]! -
        4 * c;
      lapSum += lap;
      lapSqSum += lap * lap;
      count++;
    }
  }

  const meanLap = count > 0 ? lapSum / count : 0;
  const blurScore = count > 0 ? Math.max(0, lapSqSum / count - meanLap * meanLap) : 0;

  const isBlurry = blurScore < thresholds.MIN_LAPLACIAN_VARIANCE;
  const isTooDark = brightnessScore < thresholds.MIN_BRIGHTNESS;
  const isTooBright = brightnessScore > thresholds.MAX_BRIGHTNESS;

  const issues: QualityIssue[] = [];
  if (isBlurry) issues.push('blurry');
  if (isTooDark) issues.push('dark');
  if (isTooBright) issues.push('bright');

  return {
    blurScore: Math.round(blurScore * 10) / 10,
    brightnessScore: Math.round(brightnessScore * 10) / 10,
    isBlurry,
    isTooDark,
    isTooBright,
    hasIssue: issues.length > 0,
    issues,
    analysisWidth: width,
    analysisHeight: height,
  };
}

export function getQualityWarningMessages(report: ImageQualityReport): {
  titleEn: string;
  titleKn: string;
} {
  if (report.isBlurry && report.isTooDark) {
    return {
      titleEn: QUALITY_MESSAGES.blurryAndDarkTitleEn,
      titleKn: QUALITY_MESSAGES.blurryAndDarkTitleKn,
    };
  }
  if (report.isBlurry && report.isTooBright) {
    return {
      titleEn: QUALITY_MESSAGES.blurryAndBrightTitleEn,
      titleKn: QUALITY_MESSAGES.blurryAndBrightTitleKn,
    };
  }
  if (report.isTooDark) {
    return {
      titleEn: QUALITY_MESSAGES.darkTitleEn,
      titleKn: QUALITY_MESSAGES.darkTitleKn,
    };
  }
  if (report.isTooBright) {
    return {
      titleEn: QUALITY_MESSAGES.brightTitleEn,
      titleKn: QUALITY_MESSAGES.brightTitleKn,
    };
  }
  return {
    titleEn: QUALITY_MESSAGES.blurryTitleEn,
    titleKn: QUALITY_MESSAGES.blurryTitleKn,
  };
}

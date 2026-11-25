/**
 * Configurable thresholds and bilingual (English + Kannada) messages
 * for pre-OCR image quality checks.
 */

export const QUALITY_CONFIG = {
  /** Downscale width (px) used for fast grayscale Laplacian & brightness analysis. */
  MAX_ANALYSIS_WIDTH: 320,
  /** Minimum variance of Laplacian on downscaled grayscale image; lower = blurry. */
  MIN_LAPLACIAN_VARIANCE: 80,
  /** Minimum mean luminance (0-255); lower = too dark. */
  MIN_BRIGHTNESS: 45,
  /** Maximum mean luminance (0-255); higher = too bright / washed out. */
  MAX_BRIGHTNESS: 225,
} as const;

export const QUALITY_MESSAGES = {
  blurryTitleEn: 'Photo is blurry. Retake?',
  blurryTitleKn: 'ಫೋಟೋ ಮಂಜಾಗಿದೆ. ಮತ್ತೆ ತೆಗೆಯಿರಿ?',
  darkTitleEn: 'Photo is too dark. Retake?',
  darkTitleKn: 'ಫೋಟೋ ತುಂಬಾ ಕತ್ತಲಾಗಿದೆ. ಮತ್ತೆ ತೆಗೆಯಿರಿ?',
  brightTitleEn: 'Photo is too bright. Retake?',
  brightTitleKn: 'ಫೋಟೋ ತುಂಬಾ ಪ್ರಕಾಶಮಾನವಾಗಿದೆ. ಮತ್ತೆ ತೆಗೆಯಿರಿ?',
  blurryAndDarkTitleEn: 'Photo is blurry and too dark. Retake?',
  blurryAndDarkTitleKn: 'ಫೋಟೋ ಮಂಜಾಗಿದೆ ಮತ್ತು ಕತ್ತಲಾಗಿದೆ. ಮತ್ತೆ ತೆಗೆಯಿರಿ?',
  blurryAndBrightTitleEn: 'Photo is blurry and too bright. Retake?',
  blurryAndBrightTitleKn: 'ಫೋಟೋ ಮಂಜಾಗಿದೆ ಮತ್ತು ತುಂಬಾ ಪ್ರಕಾಶಮಾನವಾಗಿದೆ. ಮತ್ತೆ ತೆಗೆಯಿರಿ?',
  hintEn: 'Hold steady in good lighting for clearer text detection.',
  hintKn: 'ಸ್ಪಷ್ಟ ಪಠ್ಯ ಗುರುತಿಸುವಿಕೆಗಾಗಿ ಉತ್ತಮ ಬೆಳಕಿನಲ್ಲಿ ಸ್ಥಿರವಾಗಿ ಹಿಡಿದುಕೊಳ್ಳಿ.',
  retakeEn: 'Retake',
  retakeKn: 'ಮತ್ತೆ ತೆಗೆಯಿರಿ',
  useAnywayEn: 'Use anyway',
  useAnywayKn: 'ಹಾಗೆಯೇ ಬಳಸಿ',
} as const;

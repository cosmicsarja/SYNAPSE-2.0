/**
 * kannadaNormalize.ts
 * Post-process Kannada OCR output to fix common PP-OCR mistakes:
 * - Normalize Unicode composition (NFC) so combining characters are canonical
 * - Fix common character confusions specific to PP-OCRv4-kn
 * - Trim noise characters (ASCII hyphens, dashes) appended to Kannada words
 * - Collapse repeated conjuncts that CTC sometimes produces
 *
 * All rules are purely string-based — no dictionary lookup needed.
 */

/** Kannada Unicode block: U+0C80–U+0CFF */
const KN_RANGE = /[\u0C80-\u0CFF]/;

/** Returns true if the string contains any Kannada codepoint. */
export function hasKannada(text: string): boolean {
  return KN_RANGE.test(text);
}

/**
 * Common PP-OCRv4-kn confusion pairs derived from visual similarity of
 * Kannada glyphs in the PP-OCR training character set.
 * Format: [wrong, correct]
 */
const CONFUSION_PAIRS: [RegExp, string][] = [
  // Halanta (virama) followed by space sometimes emitted as ASCII hyphen
  [/-(?=[\u0C80-\u0CFF])/g, '\u0CCD'],           // hyphen before KN → virama
  [/(?<=[\u0C80-\u0CFF])-$/gm, ''],              // trailing hyphen after KN word
  // Double virama / anusvara / visarga → single
  [/\u0CCD\u0CCD/g, '\u0CCD'],
  [/\u0C82\u0C82/g, '\u0C82'],
  [/\u0C83\u0C83/g, '\u0C83'],
  // Stray ASCII punctuation inside Kannada run → remove
  [/(?<=[\u0C80-\u0CFF])[._|](?=[\u0C80-\u0CFF])/g, ''],
  // Strip leading/trailing noise characters around Kannada text
  [/^[\s\-–—|/\\]+/g, ''],
  [/[\s\-–—|/\\]+$/g, ''],
];

/**
 * Normalize a single OCR text string.
 * Applies NFC composition and fixes common Kannada PP-OCR artefacts.
 * Safe to call on English text — returns unchanged (no KN codepoints).
 */
export function normalizeKannadaText(raw: string): string {
  if (!raw) return raw;

  // 1. Unicode NFC normalization — composing form
  let text = raw.normalize('NFC');

  // 2. Only apply Kannada-specific rules if the string contains Kannada
  if (!hasKannada(text)) return text;

  // 3. Apply confusion/noise pairs
  for (const [pattern, replacement] of CONFUSION_PAIRS) {
    text = text.replace(pattern, replacement);
  }

  // 4. Collapse runs of identical Kannada characters (CTC stutter artefact)
  //    e.g. 'ನನ' → 'ನ' only when the same char repeats 3+ times
  text = text.replace(/([\u0C80-\u0CFF])\1{2,}/g, '$1');

  return text.trim();
}

/**
 * Normalize a batch of recognized strings.
 * Returns a new array; does not mutate the input.
 */
export function normalizeKannadaBatch(texts: string[]): string[] {
  return texts.map(normalizeKannadaText);
}

/**
 * Common Karnataka government/application form terms in Kannada.
 * Used for conservative fuzzy correction of printed labels and standard values.
 */
export const KANNADA_FORM_LEXICON: readonly string[] = [
  'ಹೆಸರು',
  'ತಂದೆಯ ಹೆಸರು',
  'ತಾಯಿಯ ಹೆಸರು',
  'ಗಂಡನ ಹೆಸರು',
  'ಅರ್ಜಿದಾರರ ಹೆಸರು',
  'ವಿಳಾಸ',
  'ಜಿಲ್ಲೆ',
  'ತಾಲೂಕು',
  'ಗ್ರಾಮ',
  'ಹೋಬಳಿ',
  'ರಾಜ್ಯ',
  'ಕರ್ನಾಟಕ',
  'ಪಿನ್ ಕೋಡ್',
  'ದೂರವಾಣಿ',
  'ಮೊಬೈಲ್',
  'ಜನ್ಮ ದಿನಾಂಕ',
  'ದಿನಾಂಕ',
  'ವಯಸ್ಸು',
  'ಲಿಂಗ',
  'ಪುರುಷ',
  'ಮಹಿಳೆ',
  'ಆದಾಯ',
  'ವಾರ್ಷಿಕ ಆದಾಯ',
  'ಪಡಿತರ ಚೀಟಿ',
  'ಜಾತಿ',
  'ಧರ್ಮ',
  'ಉದ್ಯೋಗ',
  'ವಿದ್ಯಾರ್ಹತೆ',
  'ಕುಟುಂಬದ ಮುಖ್ಯಸ್ಥರು',
  'ಸಂಬಂಧ',
  'ಬ್ಯಾಂಕ್',
  'ಖಾತೆ ಸಂಖ್ಯೆ',
  'ಆಧಾರ್ ಸಂಖ್ಯೆ',
  'ಸಹಿ',
  'ಸ್ಥಳ',
];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n]!;
}

/**
 * Conservatively snaps a noisy Kannada form label/term to a known lexicon entry
 * when normalized edit distance <= maxEditRatio (default 0.25, max 2 edits).
 * Leaves unrelated words and person names untouched.
 */
export function snapKannadaFormTerm(raw: string, maxEditRatio = 0.25): string {
  const cleaned = normalizeKannadaText(raw).replace(/[:：]/g, '').trim();
  if (!cleaned || cleaned.length < 3 || !hasKannada(cleaned)) return raw;

  let bestMatch: string | null = null;
  let bestDist = Infinity;

  for (const term of KANNADA_FORM_LEXICON) {
    const maxLen = Math.max(cleaned.length, term.length);
    if (Math.abs(cleaned.length - term.length) > 2) continue;
    const dist = levenshtein(cleaned, term);
    if (dist <= 2 && dist / maxLen <= maxEditRatio && dist < bestDist) {
      bestDist = dist;
      bestMatch = term;
    }
  }

  return bestMatch ?? raw;
}

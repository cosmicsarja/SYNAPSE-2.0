/**
 * Edge-case detection for Kannada + English person/relative/surname fields:
 * - Digits or invalid symbols inside names
 * - Vowel-less keyboard-mash English tokens (e.g. "XZY", "QPRT", "ZXC", "VB")
 * - Placeholder/rubbish tokens ("rubbish", "dummy", "test", "asdf", "invalid")
 * - Repetitive Kannada nonsense syllables (e.g. "ಗಜಬಜ", "ಅಜಬಜ", "ಕುಟಕುಟ")
 * - Bilingual Kannada <-> English name mismatch via phonetic transliteration
 */
import type { FormField } from '@/db/schema';
import { hasKannada } from '@/lib/formlens/kannadaNormalize';

const PLACEHOLDER_TOKENS = new Set([
  'test',
  'dummy',
  'sample',
  'rubbish',
  'invalid',
  'asdf',
  'qwer',
  'zxcv',
  'xxxx',
  'xxx',
  'none',
  'null',
  'na',
]);

/** Returns true if a FormField represents a person/relative/surname name. */
export function isNameField(field: Pick<FormField, 'fieldId' | 'labelEn' | 'fieldType'>): boolean {
  if (field.fieldType === 'name') return true;
  const combined = `${field.fieldId} ${field.labelEn}`.toLowerCase();
  if (combined.includes('constituency') || combined.includes('building') || combined.includes('street')) {
    return false;
  }
  return /\b(name|surname|first\s*name|middle\s*name|father|mother|husband|wife|relative|guardian|applicant)\b/i.test(
    combined,
  );
}

/**
 * Checks a single name string for common edge cases / invalid entries.
 * Returns an array of human-readable warning strings (empty if valid).
 */
export function validateNameField(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'Not found') return [];

  const warnings: string[] = [];

  // 1. Digits or invalid symbols inside a name
  if (/\d/.test(trimmed)) {
    warnings.push('Contains numbers in a name field');
  }
  if (/[@#$%^&*_=+<>|\\/~]/.test(trimmed)) {
    warnings.push('Contains unexpected symbols in a name field');
  }

  // 2. Placeholder / rubbish words
  const asciiTokens = trimmed.split(/[\s.,'-]+/).filter(Boolean);
  for (const tok of asciiTokens) {
    const lower = tok.toLowerCase();
    if (PLACEHOLDER_TOKENS.has(lower)) {
      warnings.push(`Placeholder or invalid word ("${tok}")`);
      break;
    }
  }

  // 3. Vowel-less English tokens >= 2 chars (e.g. XZY, QPRT, ZXC, VB)
  const badConsonantTokens = asciiTokens.filter(
    (tok) => /^[A-Za-z]{2,}$/.test(tok) && !/[aeiouyAEIOUY]/.test(tok),
  );
  if (badConsonantTokens.length > 0) {
    warnings.push(`Unpronounceable / no-vowel token ("${badConsonantTokens.join(' ')}")`);
  }

  // 4. Repetitive Kannada nonsense patterns (e.g. ಗಜಬಜ, ಅಜಬಜ, ಕುಟಕುಟ)
  if (hasKannada(trimmed)) {
    const knWords = trimmed.split(/\s+/).filter((w) => hasKannada(w));
    for (const w of knWords) {
      // Strip vowel signs/virama to inspect base consonant sequence
      const base = w.replace(/[\u0CBE-\u0CCD\u0C82\u0C83]/g, '');
      // Check repeated 2-char base pattern like ಕುಟಕುಟ (base: ಕಟಕಟ) or rhyme like ಗಜಬಜ / ಅಜಬಜ (C1 C2 C3 C2)
      if (base.length >= 4 && base.slice(0, 2) === base.slice(2, 4)) {
        warnings.push(`Repeated syllable pattern ("${w}") — verify name`);
        break;
      }
      if (base.length >= 4 && base[1] === base[3] && w.length >= 4 && knWords.length >= 2) {
        warnings.push(`Possible gibberish Kannada pattern ("${w}") — verify name`);
        break;
      }
    }
  }

  // 5. Too short overall (e.g. single letter)
  if (trimmed.replace(/[\s.]/g, '').length < 2) {
    warnings.push('Name is too short (fewer than 2 characters)');
  }

  return warnings;
}

const KN_TO_LATIN: Record<string, string> = {
  // Independent vowels
  'ಅ': 'a', 'ಆ': 'aa', 'ಇ': 'i', 'ಈ': 'ee', 'ಉ': 'u', 'ಊ': 'oo',
  'ಋ': 'ru', 'ಎ': 'e', 'ಏ': 'e', 'ಐ': 'ai', 'ಒ': 'o', 'ಓ': 'o', 'ಔ': 'au',
  // Consonants (inherent 'a')
  'ಕ': 'ka', 'ಖ': 'kha', 'ಗ': 'ga', 'ಘ': 'gha', 'ಙ': 'nga',
  'ಚ': 'cha', 'ಛ': 'chha', 'ಜ': 'ja', 'ಝ': 'jha', 'ಞ': 'nya',
  'ಟ': 'ta', 'ಠ': 'tha', 'ಡ': 'da', 'ಢ': 'dha', 'ಣ': 'na',
  'ತ': 'ta', 'ಥ': 'tha', 'ದ': 'da', 'ಧ': 'dha', 'ನ': 'na',
  'ಪ': 'pa', 'ಫ': 'pha', 'ಬ': 'ba', 'ಭ': 'bha', 'ಮ': 'ma',
  'ಯ': 'ya', 'ರ': 'ra', 'ಱ': 'ra', 'ಲ': 'la', 'ಳ': 'la', 'ವ': 'va',
  'ಶ': 'sha', 'ಷ': 'sha', 'ಸ': 'sa', 'ಹ': 'ha',
  // Vowel signs (matras)
  'ಾ': 'a', 'ಿ': 'i', 'ೀ': 'ee', 'ು': 'u', 'ೂ': 'oo', 'ೃ': 'ru',
  'ೆ': 'e', 'ೇ': 'e', 'ೈ': 'ai', 'ೊ': 'o', 'ೋ': 'o', 'ೌ': 'au',
  'ಂ': 'm', 'ಃ': 'h', '್': '',
};

const MATRAS = new Set(['ಾ', 'ಿ', 'ೀ', 'ು', 'ೂ', 'ೃ', 'ೆ', 'ೇ', 'ೈ', 'ೊ', 'ೋ', 'ೌ', '್']);

/**
 * Pure-TS Kannada Unicode -> Latin phonetic transliterator for cross-script comparison.
 */
export function transliterateKannadaToLatin(text: string): string {
  const chars = Array.from(text.normalize('NFC'));
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const mapped = KN_TO_LATIN[ch];
    if (mapped === undefined) {
      out += ch;
      continue;
    }
    const next = chars[i + 1];
    // Drop inherent 'a' if followed by a matra or virama
    if (mapped.endsWith('a') && mapped.length >= 2 && next && MATRAS.has(next)) {
      out += mapped.slice(0, -1);
    } else {
      out += mapped;
    }
  }
  return out;
}

/** Reduces a Latin/transliterated name to a coarse consonant skeleton for fuzzy phonetic comparison. */
function phoneticSkeleton(latin: string): string {
  return latin
    .toLowerCase()
    .replace(/ph/g, 'f')
    .replace(/sh/g, 's')
    .replace(/ch/g, 'c')
    .replace(/[khgtdpb]h/g, (m) => m[0]!)
    .replace(/[^a-z]/g, '')
    .replace(/[aeiouy]/g, '')
    .replace(/(.)\1+/g, '$1');
}

function levenshtein(a: string, b: string): number {
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/**
 * Compares a Kannada name and an English name phonetically.
 * Returns match: false when they appear to be completely different names.
 */
export function checkBilingualNamePair(
  knName: string,
  enName: string,
): { match: boolean; reason?: string } {
  if (!hasKannada(knName) || !/[A-Za-z]/.test(enName)) return { match: true };
  const knSkel = phoneticSkeleton(transliterateKannadaToLatin(knName));
  const enSkel = phoneticSkeleton(enName);
  if (knSkel.length < 2 || enSkel.length < 2) return { match: true };

  const dist = levenshtein(knSkel, enSkel);
  const maxLen = Math.max(knSkel.length, enSkel.length);
  const ratio = dist / maxLen;

  if (ratio > 0.5 && dist > 2) {
    return {
      match: false,
      reason: `Kannada name ("${knName.trim()}") does not match English ("${enName.trim()}")`,
    };
  }
  return { match: true };
}

/**
 * Scans all fields in a form and returns a Map<fieldId, warnings[]> for name edge cases:
 * - Single-field name validity (gibberish, vowel-less tokens, digits, repeated syllables)
 * - Cross-script mismatch between paired Kannada & English name fields (e.g., applicant or relative)
 */
export function findFormNameEdgeCases(fields: FormField[]): Map<number, string[]> {
  const warningsMap = new Map<number, string[]>();
  const addWarning = (id: number | undefined, msg: string) => {
    if (id === undefined) return;
    const list = warningsMap.get(id) ?? [];
    if (!list.includes(msg)) list.push(msg);
    warningsMap.set(id, list);
  };

  const nameFields = fields.filter((f) => isNameField(f));

  // 1. Per-field edge-case checks
  for (const f of nameFields) {
    for (const w of validateNameField(f.textValue)) {
      addWarning(f.id, w);
    }
  }

  // 2. Bilingual Kannada <-> English pairing checks (applicant vs relative)
  const isRelative = (f: FormField) =>
    /relative|father|mother|husband|wife|guardian/i.test(`${f.fieldId} ${f.labelEn}`);

  for (const group of ['applicant', 'relative'] as const) {
    const groupFields = nameFields.filter((f) =>
      group === 'relative' ? isRelative(f) : !isRelative(f),
    );
    const knCandidates = groupFields.filter((f) => hasKannada(f.textValue));
    const enCandidates = groupFields.filter(
      (f) => !hasKannada(f.textValue) && /[A-Za-z]{2,}/.test(f.textValue),
    );

    if (knCandidates.length === 1 && enCandidates.length === 1) {
      const knF = knCandidates[0]!;
      const enF = enCandidates[0]!;
      const res = checkBilingualNamePair(knF.textValue, enF.textValue);
      if (!res.match && res.reason) {
        addWarning(knF.id, res.reason);
        addWarning(enF.id, res.reason);
      }
    }
  }

  return warningsMap;
}

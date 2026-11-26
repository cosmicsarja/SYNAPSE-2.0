import { describe, it, expect } from 'vitest';
import {
  validateNameField,
  checkBilingualNamePair,
  findFormNameEdgeCases,
  transliterateKannadaToLatin,
} from '@/lib/formlens/nameValidation';
import type { FormField } from '@/db/schema';

describe('Name edge-case detection', () => {
  it('flags vowel-less keyboard mash, repetitive Kannada nonsense, digits, and symbols', () => {
    expect(validateNameField('XZY QPRT')).not.toEqual([]);
    expect(validateNameField('ZXC VB')).not.toEqual([]);
    expect(validateNameField('ಗಜಬಜ ಅಜಬಜ ಕುಟಕುಟ')).not.toEqual([]);
    expect(validateNameField('Rohan123')).not.toEqual([]);
    expect(validateNameField('rubbish')).not.toEqual([]);

    // Valid names pass cleanly
    expect(validateNameField('ROHAN KUMAR')).toEqual([]);
    expect(validateNameField('ರೋಹನ್ ಕುಮಾರ್')).toEqual([]);
    expect(validateNameField('Sarju')).toEqual([]);
  });

  it('transliterates Kannada names and detects bilingual Kannada/English mismatches', () => {
    expect(transliterateKannadaToLatin('ರೋಹನ್ ಕುಮಾರ್')).toContain('rohan');
    expect(checkBilingualNamePair('ರೋಹನ್ ಕುಮಾರ್', 'ROHAN KUMAR').match).toBe(true);
    expect(checkBilingualNamePair('ರಾಜೇಶ್ ಶರ್ಮಾ', 'RAJESH SHARMA').match).toBe(true);

    const mismatch = checkBilingualNamePair('ರೋಹನ್ ಕುಮಾರ್', 'SURESH GOWDA');
    expect(mismatch.match).toBe(false);
    expect(mismatch.reason).toMatch(/does not match/i);
  });

  it('flags mismatched and gibberish name fields across a form', () => {
    const fields: FormField[] = [
      {
        id: 1,
        formId: 10,
        fieldId: 'applicant_name_kn',
        labelEn: 'Name (Kannada)',
        labelKn: 'ಹೆಸರು',
        fieldType: 'name',
        textValue: 'ರೋಹನ್ ಕುಮಾರ್',
        originalText: 'ರೋಹನ್ ಕುಮಾರ್',
        confidence: 0.95,
        wasEdited: false,
      },
      {
        id: 2,
        formId: 10,
        fieldId: 'applicant_name_en',
        labelEn: 'Name (English)',
        labelKn: 'Name',
        fieldType: 'name',
        textValue: 'XZY QPRT',
        originalText: 'XZY QPRT',
        confidence: 0.92,
        wasEdited: false,
      },
      {
        id: 3,
        formId: 10,
        fieldId: 'surname_kn',
        labelEn: 'Surname (Kannada)',
        labelKn: 'ಉಪನಾಮ',
        fieldType: 'name',
        textValue: 'ಗಜಬಜ ಅಜಬಜ ಕುಟಕುಟ',
        originalText: 'ಗಜಬಜ ಅಜಬಜ ಕುಟಕುಟ',
        confidence: 0.9,
        wasEdited: false,
      },
    ];

    const warnings = findFormNameEdgeCases(fields);
    expect(warnings.has(2)).toBe(true);
    expect(warnings.has(3)).toBe(true);
    expect(warnings.has(1)).toBe(false);
  });
});

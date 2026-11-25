import { describe, it, expect } from 'vitest';
import { formToEditableJson, parseEditableJson } from '@/lib/formlens/jsonPdf';
import type { FormField, SavedForm } from '@/db/schema';

describe('Editable JSON <-> PDF conversion helpers', () => {
  it('converts SavedForm + FormField[] into a structured EditableFormJson', () => {
    const form: SavedForm = {
      id: 42,
      templateId: 'ration-card',
      templateName: 'Ration Card',
      createdAt: 1732500000000,
      updatedAt: 1732500000000,
      status: 'pending',
      avgConfidence: 0.91,
      synced: false,
    };
    const fields: FormField[] = [
      {
        formId: 42,
        fieldId: 'applicant_name',
        labelEn: 'Applicant Name',
        labelKn: 'ಅರ್ಜಿದಾರರ ಹೆಸರು',
        fieldType: 'name',
        textValue: 'ರಮೇಶ್ ಕುಮಾರ್',
        originalText: 'ರಮೇಶ್ ಕುಮಾರ್',
        confidence: 0.93,
        wasEdited: false,
      },
      {
        formId: 42,
        fieldId: 'mobile',
        labelEn: 'Mobile',
        labelKn: 'Mobile',
        fieldType: 'phone',
        textValue: '9876543210',
        originalText: '9876543210',
        confidence: 0.98,
        wasEdited: false,
      },
    ];

    const editable = formToEditableJson(form, fields);
    expect(editable.title).toBe('FormLens Extract #42');
    expect(editable.template).toBe('Ration Card');
    expect(editable.fields).toHaveLength(2);
    expect(editable.fields[0]!.label).toBe('Applicant Name / ಅರ್ಜಿದಾರರ ಹೆಸರು');
    expect(editable.fields[0]!.value).toBe('ರಮೇಶ್ ಕುಮಾರ್');
    expect(editable.fields[1]!.label).toBe('Mobile');
  });

  it('parses both structured EditableFormJson and flat key-value JSON', () => {
    const structured = parseEditableJson(
      JSON.stringify({
        title: 'My Form',
        fields: [{ key: 'name', label: 'ಹೆಸರು', value: 'ಸುರೇಶ್', confidence: 90 }],
      }),
    );
    expect(structured.ok).toBe(true);
    if (structured.ok) {
      expect(structured.data.title).toBe('My Form');
      expect(structured.data.fields[0]!.value).toBe('ಸುರೇಶ್');
    }

    const flat = parseEditableJson(
      JSON.stringify({
        ಹೆಸರು: 'ಲಕ್ಷ್ಮಿ',
        District: 'ಬೆಂಗಳೂರು ನಗರ',
      }),
    );
    expect(flat.ok).toBe(true);
    if (flat.ok) {
      expect(flat.data.fields).toHaveLength(2);
      expect(flat.data.fields[0]!.label).toBe('ಹೆಸರು');
      expect(flat.data.fields[1]!.value).toBe('ಬೆಂಗಳೂರು ನಗರ');
    }
  });

  it('returns clear errors on invalid JSON or non-object root', () => {
    const badSyntax = parseEditableJson('{ broken json');
    expect(badSyntax.ok).toBe(false);

    const arrRoot = parseEditableJson('[1, 2, 3]');
    expect(arrRoot.ok).toBe(false);
  });
});

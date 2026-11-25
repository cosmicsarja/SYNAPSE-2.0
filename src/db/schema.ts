/**
 * Dexie (IndexedDB) schema for FormLens.
 * All form data lives here — never in localStorage.
 */
import Dexie, { type Table } from 'dexie';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FormStatus = 'draft' | 'reviewed' | 'synced';
export type OcrEngine = 'tesseract' | 'onnx' | 'mock';
export type AppLanguage = 'en' | 'kn';

export interface SavedForm {
  id?: number;              // auto-increment PK
  templateId: string;
  templateName: string;
  status: FormStatus;
  avgConfidence: number;    // 0–1
  createdAt: number;        // Date.now()
  updatedAt: number;
  thumbnailDataUrl?: string; // base64 jpeg crop of the scanned image
  supabaseId?: string;      // set after successful sync
}

export interface FormField {
  id?: number;
  formId: number;
  fieldId: string;          // matches template field id
  labelEn: string;
  labelKn: string;
  fieldType: string;
  textValue: string;        // current (possibly edited) value
  originalText: string;     // OCR raw output — never overwritten
  confidence: number;       // 0–1
  wasEdited: boolean;
  cropDataUrl?: string;     // base64 crop of this field's region
}

export interface AppSettings {
  key: string;              // primary key
  value: unknown;
}

// Keys for AppSettings:
// 'setup_complete' → boolean
// 'pack_version'   → string
// 'ocr_engine'     → OcrEngine
// 'language'       → AppLanguage
// 'sync_enabled'   → boolean

export interface SyncQueueItem {
  id?: number;
  formId: number;
  createdAt: number;
  retryCount: number;
  lastError?: string;
}

// ─── Database class ───────────────────────────────────────────────────────────

export class FormLensDB extends Dexie {
  forms!: Table<SavedForm>;
  formFields!: Table<FormField>;
  settings!: Table<AppSettings>;
  syncQueue!: Table<SyncQueueItem>;

  constructor() {
    super('FormLensDB');

    this.version(1).stores({
      forms:     '++id, templateId, status, createdAt, updatedAt, supabaseId',
      formFields:'++id, formId, fieldId',
      settings:  'key',
      syncQueue: '++id, formId, createdAt',
    });
  }
}

export const db = new FormLensDB();

// ─── Helper functions ─────────────────────────────────────────────────────────

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? defaultValue : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

export async function getFormWithFields(formId: number) {
  const form = await db.forms.get(formId);
  if (!form) return null;
  const fields = await db.formFields.where('formId').equals(formId).toArray();
  return { form, fields };
}

export async function saveFormWithFields(
  form: Omit<SavedForm, 'id'>,
  fields: Omit<FormField, 'id' | 'formId'>[],
): Promise<number> {
  const formId = await db.forms.add(form);
  const withFormId = fields.map((f) => ({ ...f, formId: formId as number }));
  await db.formFields.bulkAdd(withFormId);
  return formId as number;
}

export async function updateFormField(
  fieldId: number,
  textValue: string,
): Promise<void> {
  await db.formFields.update(fieldId, {
    textValue,
    wasEdited: true,
  });
  // Update form's updatedAt
  const field = await db.formFields.get(fieldId);
  if (field?.formId) {
    await db.forms.update(field.formId, { updatedAt: Date.now() });
  }
}

export async function markFormReviewed(formId: number, avgConfidence: number): Promise<void> {
  await db.forms.update(formId, {
    status: 'reviewed',
    avgConfidence,
    updatedAt: Date.now(),
  });
}

export async function deleteForm(formId: number): Promise<void> {
  await db.transaction('rw', db.forms, db.formFields, db.syncQueue, async () => {
    await db.formFields.where('formId').equals(formId).delete();
    await db.syncQueue.where('formId').equals(formId).delete();
    await db.forms.delete(formId);
  });
}


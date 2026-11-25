/**
 * Dexie (IndexedDB) schema for FormLens.
 * All form data lives here — never in localStorage.
 */
import Dexie, { type Table } from 'dexie';

// ─── Types ───────────────────────────────────────────────────────────────────

export type FormStatus = 'draft' | 'reviewed' | 'synced';
export type OcrEngine = 'paddle' | 'tesseract' | 'cloud' | 'onnx' | 'mock';
export type AppLanguage = 'en' | 'kn';
export type ScanMode = 'auto' | 'template';

export interface SavedForm {
  id?: number;              // auto-increment PK
  templateId: string;
  templateName: string;
  status: FormStatus;
  avgConfidence: number;    // 0–1
  createdAt: number;        // Date.now()
  updatedAt: number;
  thumbnailDataUrl?: string; // base64 jpeg crop of the scanned image
  imageDataUrl?: string;    // full perspective-corrected page image for bbox review
  imageWidth?: number;
  imageHeight?: number;
  scanMode?: ScanMode;
  timingsJson?: string;
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
  normBbox?: [number, number, number, number]; // [x0, y0, x1, y1] normalized 0-1
  script?: 'kn' | 'en' | 'mixed';
  model?: string;
  category?: 'paired' | 'other' | 'template';
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

export interface CorrectionRecord {
  id?: number;
  formId: number;
  fieldName: string;
  originalText: string;
  correctedText: string;
  confidence: number;
  cropBlob?: Blob;
  templateId: string;
  timestamp: number;
}

export type BatchQueueStatus = 'queued' | 'reading' | 'ready' | 'failed';

export interface BatchQueueItem {
  id?: number;
  imageDataUrl: string;
  width: number;
  height: number;
  scanMode: ScanMode;
  templateId: string;
  langMode: 'eng+kan' | 'eng' | 'kan';
  status: BatchQueueStatus;
  formId?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Database class ───────────────────────────────────────────────────────────

export class FormLensDB extends Dexie {
  forms!: Table<SavedForm>;
  formFields!: Table<FormField>;
  settings!: Table<AppSettings>;
  syncQueue!: Table<SyncQueueItem>;
  corrections!: Table<CorrectionRecord>;
  batchQueue!: Table<BatchQueueItem>;

  constructor() {
    super('FormLensDB');

    this.version(1).stores({
      forms:     '++id, templateId, status, createdAt, updatedAt, supabaseId',
      formFields:'++id, formId, fieldId',
      settings:  'key',
      syncQueue: '++id, formId, createdAt',
    });

    // Non-destructive v2 migration for scanMode, normalized bboxes, script & model metadata
    this.version(2).stores({
      forms:     '++id, templateId, status, createdAt, updatedAt, supabaseId, scanMode',
      formFields:'++id, formId, fieldId, category',
      settings:  'key',
      syncQueue: '++id, formId, createdAt',
    });

    // Non-destructive v3 migration for user correction dataset learning
    this.version(3).stores({
      forms:       '++id, templateId, status, createdAt, updatedAt, supabaseId, scanMode',
      formFields:  '++id, formId, fieldId, category',
      settings:    'key',
      syncQueue:   '++id, formId, createdAt',
      corrections: '++id, formId, fieldName, templateId, timestamp, [formId+fieldName]',
    });

    // Non-destructive v4 migration for persistent batch scanning queue
    this.version(4).stores({
      forms:       '++id, templateId, status, createdAt, updatedAt, supabaseId, scanMode',
      formFields:  '++id, formId, fieldId, category',
      settings:    'key',
      syncQueue:   '++id, formId, createdAt',
      corrections: '++id, formId, fieldName, templateId, timestamp, [formId+fieldName]',
      batchQueue:  '++id, status, createdAt, formId',
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

export async function saveCorrection(entry: Omit<CorrectionRecord, 'id'>): Promise<void> {
  const existing = await db.corrections
    .where('[formId+fieldName]')
    .equals([entry.formId, entry.fieldName])
    .first();

  if (entry.correctedText === entry.originalText) {
    if (existing?.id !== undefined) {
      await db.corrections.delete(existing.id);
    }
    return;
  }

  if (existing?.id !== undefined) {
    await db.corrections.update(existing.id, {
      originalText: entry.originalText,
      correctedText: entry.correctedText,
      confidence: entry.confidence,
      cropBlob: entry.cropBlob ?? existing.cropBlob,
      templateId: entry.templateId,
      timestamp: entry.timestamp,
    });
  } else {
    await db.corrections.add(entry);
  }
}

export async function getCorrectionCount(): Promise<number> {
  return db.corrections.count();
}

export async function getAllCorrections(): Promise<CorrectionRecord[]> {
  return db.corrections.orderBy('timestamp').toArray();
}

export async function clearCorrections(): Promise<void> {
  await db.corrections.clear();
}

export async function enqueueBatchItem(
  item: Omit<BatchQueueItem, 'id' | 'status' | 'createdAt' | 'updatedAt'>,
): Promise<number> {
  const now = Date.now();
  const id = await db.batchQueue.add({
    ...item,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  });
  return id as number;
}

export async function getBatchQueue(): Promise<BatchQueueItem[]> {
  return db.batchQueue.orderBy('createdAt').toArray();
}

export async function updateBatchItem(
  id: number,
  patch: Partial<Omit<BatchQueueItem, 'id' | 'createdAt'>>,
): Promise<void> {
  await db.batchQueue.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteBatchItem(id: number): Promise<void> {
  await db.batchQueue.delete(id);
}

export async function resetStuckReadingBatchItems(): Promise<void> {
  const stuck = await db.batchQueue.where('status').equals('reading').toArray();
  const now = Date.now();
  await Promise.all(
    stuck
      .filter((item) => item.id !== undefined)
      .map((item) => db.batchQueue.update(item.id!, { status: 'queued', updatedAt: now })),
  );
}


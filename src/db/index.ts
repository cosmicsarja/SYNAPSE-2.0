// Re-export db instance and all types from schema
export { db, FormLensDB, getSetting, setSetting, getFormWithFields, saveFormWithFields, updateFormField, markFormReviewed, deleteForm } from './schema';
export type { SavedForm, FormField, AppSettings, SyncQueueItem, FormStatus, OcrEngine, AppLanguage } from './schema';


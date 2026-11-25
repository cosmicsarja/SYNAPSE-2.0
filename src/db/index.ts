// Re-export db instance and all types from schema
export {
  db,
  FormLensDB,
  getSetting,
  setSetting,
  getFormWithFields,
  saveFormWithFields,
  updateFormField,
  markFormReviewed,
  deleteForm,
  saveCorrection,
  getCorrectionCount,
  getAllCorrections,
  clearCorrections,
} from './schema';
export type {
  SavedForm,
  FormField,
  AppSettings,
  SyncQueueItem,
  CorrectionRecord,
  FormStatus,
  OcrEngine,
  AppLanguage,
} from './schema';


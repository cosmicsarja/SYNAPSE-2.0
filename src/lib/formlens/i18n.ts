/**
 * Bilingual string map for FormLens UI.
 * Keys are semantic identifiers; values are { en, kn } pairs.
 */

export type Lang = 'en' | 'kn';

const strings = {
  // App
  appName:                { en: 'FormLens', kn: 'ಫಾರ್ಮ್‌ಲೆನ್ಸ್' },
  tagline:                { en: 'Offline form scanner for Kannada & English', kn: 'ಕನ್ನಡ ಮತ್ತು ಇಂಗ್ಲಿಷ್ ಫಾರ್ಮ್ ಸ್ಕ್ಯಾನರ್' },

  // Setup
  setupTitle:             { en: 'First-time Setup', kn: 'ಮೊದಲ ಹೊಂದಾಣಿಕೆ' },
  setupSubtitle:          { en: 'Download offline AI pack once. After this, FormLens works without internet.', kn: 'ಒಮ್ಮೆ ಆಫ್‌ಲೈನ್ AI ಪ್ಯಾಕ್ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ. ನಂತರ ಫಾರ್ಮ್‌ಲೆನ್ಸ್ ಇಂಟರ್ನೆಟ್ ಇಲ್ಲದೇ ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತದೆ.' },
  downloading:            { en: 'Downloading…', kn: 'ಡೌನ್‌ಲೋಡ್ ಆಗುತ್ತಿದೆ…' },
  downloadPack:           { en: 'Download Offline Pack', kn: 'ಆಫ್‌ಲೈನ್ ಪ್ಯಾಕ್ ಡೌನ್‌ಲೋಡ್' },
  selfTesting:            { en: 'Self-testing models…', kn: 'ಮಾಡೆಲ್‌ಗಳನ್ನು ಪರೀಕ್ಷಿಸುತ್ತಿದ್ದೇನೆ…' },
  packReady:              { en: 'Offline pack ready. You can now turn off your internet.', kn: 'ಆಫ್‌ಲೈನ್ ಪ್ಯಾಕ್ ಸಿದ್ಧ. ನೀವು ಇಂಟರ್ನೆಟ್ ಆಫ್ ಮಾಡಬಹುದು.' },
  testOffline:            { en: 'Test offline now', kn: 'ಈಗ ಆಫ್‌ಲೈನ್ ಪರೀಕ್ಷಿಸಿ' },
  offlineConfirmed:       { en: '✓ You are offline and FormLens is working.', kn: '✓ ನೀವು ಆಫ್‌ಲೈನ್‌ನಲ್ಲಿದ್ದೀರಿ ಮತ್ತು ಫಾರ್ಮ್‌ಲೆನ್ಸ್ ಕಾರ್ಯನಿರ್ವಹಿಸುತ್ತಿದೆ.' },
  startScanning:          { en: 'Start Scanning', kn: 'ಸ್ಕ್ಯಾನ್ ಪ್ರಾರಂಭಿಸಿ' },

  // Nav
  scan:                   { en: 'Scan', kn: 'ಸ್ಕ್ಯಾನ್' },
  forms:                  { en: 'Forms', kn: 'ಫಾರ್ಮ್‌ಗಳು' },
  settings:               { en: 'Settings', kn: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು' },

  // Scan
  scanTitle:              { en: 'Scan Form', kn: 'ಫಾರ್ಮ್ ಸ್ಕ್ಯಾನ್' },
  takePhoto:              { en: 'Take Photo', kn: 'ಫೋಟೋ ತೆಗೆಯಿರಿ' },
  uploadGallery:          { en: 'Upload from Gallery', kn: 'ಗ್ಯಾಲರಿಯಿಂದ ಅಪ್‌ಲೋಡ್' },
  selectTemplate:         { en: 'Select Template', kn: 'ಟೆಂಪ್ಲೇಟ್ ಆಯ್ಕೆ' },
  cropInstruction:        { en: 'Drag corners to align with the form edges', kn: 'ಫಾರ್ಮ್ ಅಂಚುಗಳಿಗೆ ಸರಿಹೊಂದಿಸಲು ಮೂಲೆಗಳನ್ನು ಎಳೆಯಿರಿ' },
  startOcr:               { en: 'Start Reading', kn: 'ಓದಲು ಪ್ರಾರಂಭಿಸಿ' },
  readingField:           { en: 'Reading field {n} of {total}', kn: 'ಕ್ಷೇತ್ರ {n} / {total} ಓದುತ್ತಿದ್ದೇನೆ' },

  // Review
  reviewTitle:            { en: 'Review Fields', kn: 'ಕ್ಷೇತ್ರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ' },
  needsReview:            { en: 'Needs Review', kn: 'ಪರಿಶೀಲನೆ ಅಗತ್ಯ' },
  confirmed:              { en: 'Confirmed', kn: 'ದೃಢೀಕರಿಸಲಾಗಿದೆ' },
  acceptField:            { en: 'Accept', kn: 'ಒಪ್ಪಿಕೊಳ್ಳಿ' },
  acceptAll:              { en: 'Accept All', kn: 'ಎಲ್ಲ ಒಪ್ಪಿಕೊಳ್ಳಿ' },
  save:                   { en: 'Save', kn: 'ಉಳಿಸಿ' },
  exportJson:             { en: 'Export JSON', kn: 'JSON ರಫ್ತು' },
  exportCsv:              { en: 'Export CSV', kn: 'CSV ರಫ್ತು' },
  exportPdf:              { en: 'Export PDF', kn: 'PDF ರಫ್ತು' },
  confidence:             { en: 'Confidence', kn: 'ವಿಶ್ವಾಸಾರ್ಹತೆ' },
  suggestionSnap:         { en: 'Suggestion: {value}', kn: 'ಸಲಹೆ: {value}' },

  // Saved forms
  formsTitle:             { en: 'Saved Forms', kn: 'ಉಳಿಸಿದ ಫಾರ್ಮ್‌ಗಳು' },
  noForms:                { en: 'No forms saved yet. Scan a form to get started.', kn: 'ಇನ್ನೂ ಯಾವುದೇ ಫಾರ್ಮ್ ಉಳಿಸಿಲ್ಲ. ಪ್ರಾರಂಭಿಸಲು ಫಾರ್ಮ್ ಸ್ಕ್ಯಾನ್ ಮಾಡಿ.' },
  draft:                  { en: 'Draft', kn: 'ಕರಡು' },
  reviewed:               { en: 'Reviewed', kn: 'ಪರಿಶೀಲಿಸಲಾಗಿದೆ' },
  synced:                 { en: 'Synced', kn: 'ಸಮನ್ವಯಗೊಳಿಸಲಾಗಿದೆ' },
  deleteForm:             { en: 'Delete', kn: 'ಅಳಿಸಿ' },
  reopen:                 { en: 'Reopen', kn: 'ಮತ್ತೆ ತೆರೆಯಿರಿ' },
  avgConfidence:          { en: 'Avg. confidence', kn: 'ಸರಾಸರಿ ವಿಶ್ವಾಸಾರ್ಹತೆ' },
  syncBadge:              { en: '{n} forms waiting to sync', kn: '{n} ಫಾರ್ಮ್‌ಗಳು ಸಮನ್ವಯಕ್ಕಾಗಿ ಕಾಯುತ್ತಿವೆ' },

  // Settings
  settingsTitle:          { en: 'Settings', kn: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು' },
  packStatus:             { en: 'Offline Pack', kn: 'ಆಫ್‌ಲೈನ್ ಪ್ಯಾಕ್' },
  packVersion:            { en: 'Version', kn: 'ಆವೃತ್ತಿ' },
  storageUsed:            { en: 'Storage used', kn: 'ಬಳಸಿದ ಸ್ಟೋರೇಜ್' },
  redownloadPack:         { en: 'Re-download Pack', kn: 'ಪ್ಯಾಕ್ ಮತ್ತೆ ಡೌನ್‌ಲೋಡ್' },
  clearForms:             { en: 'Clear All Saved Forms', kn: 'ಎಲ್ಲ ಉಳಿಸಿದ ಫಾರ್ಮ್‌ಗಳನ್ನು ತೆರವುಗೊಳಿಸಿ' },
  ocrEngine:              { en: 'OCR Engine', kn: 'OCR ಎಂಜಿನ್' },
  mockEngine:             { en: 'Mock (Demo)', kn: 'ಮಾಕ್ (ಡೆಮೊ)' },
  onnxEngine:             { en: 'ONNX (On-device AI)', kn: 'ONNX (ಸಾಧನದಲ್ಲಿ AI)' },
  language:               { en: 'Language', kn: 'ಭಾಷೆ' },
  english:                { en: 'English', kn: 'ಇಂಗ್ಲಿಷ್' },
  kannada:                { en: 'Kannada', kn: 'ಕನ್ನಡ' },
  supabaseSync:           { en: 'Cloud Sync (Supabase)', kn: 'ಕ್ಲೌಡ್ ಸಮನ್ವಯ (Supabase)' },
  signIn:                 { en: 'Sign In', kn: 'ಸೈನ್ ಇನ್' },
  signOut:                { en: 'Sign Out', kn: 'ಸೈನ್ ಔಟ್' },
  signedInAs:             { en: 'Signed in as {email}', kn: '{email} ಆಗಿ ಸೈನ್ ಇನ್ ಮಾಡಲಾಗಿದೆ' },

  // Offline / Online status
  online:                 { en: 'Online', kn: 'ಆನ್‌ಲೈನ್' },
  offline:                { en: 'Offline mode (data saved on this device)', kn: 'ಆಫ್‌ಲೈನ್ ಮೋಡ್ (ಡೇಟಾ ಈ ಸಾಧನದಲ್ಲಿ ಉಳಿಸಲಾಗಿದೆ)' },
  newVersionAvailable:    { en: 'New version available — tap to update', kn: 'ಹೊಸ ಆವೃತ್ತಿ ಲಭ್ಯ — ನವೀಕರಿಸಲು ಸ್ಪರ್ಶಿಸಿ' },
  installApp:             { en: 'Install App', kn: 'ಆಪ್ ಅಳವಡಿಸಿ' },
  iosInstall:             { en: 'Tap Share → "Add to Home Screen" to install.', kn: 'ಅಳವಡಿಸಲು Share → "Add to Home Screen" ಸ್ಪರ್ಶಿಸಿ.' },

  // Validators
  invalidDate:            { en: 'Invalid date format (use DD/MM/YYYY)', kn: 'ಅಮಾನ್ಯ ದಿನಾಂಕ (DD/MM/YYYY ಬಳಸಿ)' },
  invalidPhone:           { en: 'Enter a valid 10-digit mobile number', kn: '10 ಅಂಕಿಯ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ' },
  invalidPincode:         { en: 'Enter a valid 6-digit pincode', kn: '6 ಅಂಕಿಯ ಪಿನ್ ಕೋಡ್ ನಮೂದಿಸಿ' },
  invalidNumber:          { en: 'Enter a valid number', kn: 'ಮಾನ್ಯ ಸಂಖ್ಯೆ ನಮೂದಿಸಿ' },

  // Errors
  cameraError:            { en: 'Camera not accessible. Please allow camera permission.', kn: 'ಕ್ಯಾಮೆರಾ ಪ್ರವೇಶಿಸಲಾಗುತ್ತಿಲ್ಲ. ದಯವಿಟ್ಟು ಕ್ಯಾಮೆರಾ ಅನುಮತಿ ನೀಡಿ.' },
  ocrError:               { en: 'OCR failed. Please try again.', kn: 'OCR ವಿಫಲವಾಯಿತು. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.' },
} as const;

export type StringKey = keyof typeof strings;

let currentLang: Lang = 'en';

export function setLanguage(lang: Lang) {
  currentLang = lang;
}

export function getLanguage(): Lang {
  return currentLang;
}

export function t(key: StringKey, substitutions?: Record<string, string>): string {
  const entry = strings[key];
  let text: string = entry[currentLang];
  if (substitutions) {
    for (const [k, v] of Object.entries(substitutions)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}

/** Returns both en and kn for a key — useful for bilingual labels. */
export function tBoth(key: StringKey): { en: string; kn: string } {
  return { en: strings[key].en, kn: strings[key].kn };
}


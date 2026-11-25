# FormLens implementation plan

## Product experience
- Replace the starter screen with a bilingual, mobile-first FormLens app for capturing and reviewing Kannada/English government forms.
- Add first-run offline-pack setup, camera/gallery capture, template selection, OCR progress, editable field review, saved forms, export, sync queue, and settings.
- Keep form data and setup state on-device; use mock OCR by default and provide an ONNX adapter that loads local model assets when supplied.

## Offline and local data
- Add installable PWA metadata and guarded Workbox offline support, with update prompting and no service-worker registration in preview/dev contexts.
- Use IndexedDB for forms and queue state, Cache Storage for the offline pack, and include local dictionaries and two sample templates.
- Provide a clear unavailable-model state rather than claiming real handwriting recognition without trained model files.

## Technical details
- Add Dexie, ONNX Runtime Web, and vite-plugin-pwa; run OCR requests in a Web Worker with a mock/ONNX engine interface.
- Keep cloud sync optional and non-blocking; no Supabase project or generated client is currently present, so the UI will preserve locally queued forms and surface cloud-sync setup as unavailable rather than inventing credentials or migrations.
- Add route metadata, focused tests for offline setup and local form behavior, and README guidance for adding trained model assets.

# FormLens Offline Pre-Trained PP-OCR Pipeline Plan

## 1. What Currently Exists
- **Framework & Build:** React 19 + Vite 8 + TypeScript + TanStack Start/Router, `onnxruntime-web` (`^1.31.1`), `vite-plugin-pwa` / Workbox (`scripts/generate-sw.mjs`), Dexie (`^4.4.7`), Supabase sync (`src/lib/formlens/syncQueue.ts`).
- **Same-origin WASM & Assets:**
  - `/ort/` (`public/ort/`) already hosts `onnxruntime-web` WASM + JS runtimes locally.
  - `/templates/` (`public/templates/`) has `auto-extract.json`, `ration-card.json`, `income-certificate.json`.
  - `/data/karnataka_localities.json` has district/taluk/village dictionary.
- **OCR Engines & Workers:**
  - `src/config/model.ts` defines `OcrEngine` (`init()`, `recognize(crop, fieldType)`) and `OcrResult`.
  - `src/workers/ocr.worker.ts` runs `OnnxOcrEngine` or `MockOcrEngine` in a Web Worker.
  - `src/workers/tesseract-engine.ts` runs Tesseract.js (`eng+kan`) offline.
  - `src/workers/cloud-engine.ts` connects to an optional Python backend.
- **UI & Storage:**
  - `src/db/schema.ts`: Dexie `FormLensDB` v1 (`forms`, `formFields`, `settings`, `syncQueue`).
  - `src/routes/setup.tsx` + `src/lib/formlens/packDownloader.ts`: reads `/models/manifest.json`, caches files into `formlens-offline-pack-v1`, tracks progress.
  - `src/routes/scan.tsx`: camera/upload -> `ManualCrop` -> OCR -> `LensOverlay` -> saves to Dexie and navigates to `/review/$id`.
  - `src/routes/review.$id.tsx`: field-by-field editable review (`FieldCard`), JSON/CSV/PDF export, enqueue Supabase sync.
  - `src/routes/settings.tsx`: offline pack status, engine selector, language toggle, Supabase auth.

## 2. What We Will Change (In Small Commits)
1. **Commit 1 — Model Fetcher & Manifest (`scripts/fetch-models.mjs`, `MODELS.md`, `models.lock.json`, `package.json`, `.gitignore`):**
   - Query `https://huggingface.co/api/models/byrizki/rusto-models` to verify file paths and MIT licence.
   - Fetch `ppocrv4-mobile/det.onnx`, `multilingual/ppocrv4_rec_kannada.onnx`, `multilingual/ppocrv4_dict_kannada.txt`, `multilingual/ppocrv5_rec_latin.onnx`, and `multilingual/ppocrv5_dict_latin.txt` into `public/models/` with versioned names.
   - Generate `models.lock.json` (with SHA-256) and `MODELS.md`; auto-update `public/models/manifest.json` and `packDownloader.ts` (including SHA-256 verification).
   - Hook `fetch-models` into `prebuild` in `package.json` and ignore `public/models/*.onnx` in `.gitignore`.
2. **Commit 2 — Model Inspection & Contract (`scripts/inspect_onnx.mjs`, `src/config/ocrModels.ts`):**
   - Inspect each downloaded ONNX model using `onnxruntime-node` (or Python `onnxruntime` if native node binding is unavailable) to record exact tensor names, shapes, dtypes, softmax vs logits, and assert dictionary length vs output class count `C`.
   - Export all inspected constants in `src/config/ocrModels.ts`.
3. **Commit 3 — Detection Pipeline (`src/workers/pipeline/detect.ts`):**
   - Pure-TypeScript DB-style probability map post-processor (thresholding, connected components, minimum-area oriented bounding boxes, box score filtering, unclipping ~1.5x, reading-order sorting, perspective-warped crop extraction + 90° rotation for tall vertical crops).
   - Runs in worker via `onnxruntime-web` (`['webgpu', 'wasm']` with `/ort/` same-origin WASM).
4. **Commit 4 — Recognition Engine (`src/workers/pipeline/paddle-engine.ts` & `src/workers/ocr.worker.ts`):**
   - Implement `PaddleOcrEngine` conforming to `OcrEngine` + batch crop recognition.
   - Width-bucketed small batches, tensor disposal, CTC greedy decode with geometric-mean confidence, conditional softmax, and Kannada + Latin script routing.
5. **Commit 5 — Two Operating Modes in Scan Flow (`src/db/schema.ts`, `src/routes/scan.tsx`):**
   - Add Dexie v2 migration (non-destructive) storing scan mode (`'auto' | 'template'`), bounding boxes, and model/script metadata.
   - **Template mode:** auto-detect boxes and assign to template fields by max IoU/containment, joining multi-box fields in reading order and flagging missing fields `"Not found"`.
   - **Auto mode (default):** detect + recognize whole page, pair fuzzy-matched printed labels (Kannada/English) with nearest right/below value box, and list remaining under `"Other text"`.
6. **Commit 6 — Interactive Bounding-Box Review UI (`src/components/formlens/BoxReviewOverlay.tsx`, `src/routes/review.$id.tsx`):**
   - Confidence-colored SVG/canvas overlay (green >= 85%, amber 60–85%, red < 60%) with box numbers, pinch/zoom/pan, synced list, add/resize/delete box + single-box re-OCR, `originalText` vs `textValue` tracking, show/hide & low-confidence toggles, and JSON (normalized 0–1 coords)/CSV/annotated-PNG export.
7. **Commit 7 — Performance, Diagnostics & Benchmarks (`src/routes/settings.tsx`, `public/bench/pages/`, `src/test/*.test.ts`, `VERIFICATION.md`):**
   - Worker progress events, session caching, configurable detection max side, Diagnostics timings (model load, detect ms, avg rec ms, peak memory) + benchmark runner (`public/bench/pages/`).
   - Vitest unit tests for DB post-processing, reading-order sort, CTC decoding, and box-to-template assignment.
   - Full `npm run build` + `npm run preview` offline DevTools verification recorded in `VERIFICATION.md`.

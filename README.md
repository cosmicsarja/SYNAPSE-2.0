# FormLens — Offline-First Mobile Web App (PWA) for Kannada & English Form OCR

> **Offline-first Progressive Web App (PWA)** built for mobile browsers to scan, detect, recognize, edit, and export **Kannada (`ಕನ್ನಡ`) + English** forms — **100% on-device with zero internet required**, plus an optional **Gemini Vision AI** online mode when high-speed internet is available.

---

## Presentation (PPT) Ready Content — Easy Points

### Slide 1: Project Title & Overview
- **Project Name:** FormLens
- **Type:** Mobile Web-Based Application (Progressive Web App / PWA — installable on Android/iOS/Desktop without an app store)
- **Core Goal:** Digitize printed and handwritten **Kannada + English** paper forms directly on a mobile phone, **even completely offline**.
- **Privacy First:** All offline scanning, OCR, and storage happen locally inside the phone's browser (WebAssembly + IndexedDB).

### Slide 2: Problem Statement
- Government, banking, and rural survey forms in Karnataka are mostly paper-based and bilingual (**Kannada + English**).
- Manual data entry is slow, error-prone, and requires internet/desktop PCs.
- Cloud-only OCR apps fail in low-network rural areas and raise privacy concerns for citizen documents.

### Slide 3: Our Solution (Mobile Web App / PWA)
- **Installable Mobile Web App:** Built with React + Vite + `vite-plugin-pwa`, works like a native mobile app and runs offline after first setup.
- **Offline AI Pack:** Downloads & verifies (`SHA-256`) lightweight ONNX models once into browser **Cache Storage**.
- **Dual Mode:**
  - **Offline Mode (Default):** Runs PP-OCRv4/v5 ONNX models inside a **Web Worker** (`onnxruntime-web` WASM) so the UI stays smooth on 2–3 GB RAM phones.
  - **Online Mode (Optional):** One-tap **Gemini AI (`gemini-3.8-flash`)** switch on the scan screen when internet is strong, with automatic offline fallback.

### Slide 4: How the OCR Pipeline Works (Step-by-Step)
1. **Image Capture & Quality Check:**
   - Captures photo from mobile camera or gallery.
   - Checks **blur (Laplacian variance)** and **brightness** offline before OCR; warns in **English + Kannada** if blurry/dark.
2. **Text Detection (Where is the text?):**
   - **PP-OCRv4 DBNet (`ppocrv4_det.v1.onnx`)** finds oriented text bounding boxes and sorts them in reading order.
   - Crops each box with extra vertical/horizontal padding so Kannada vowel signs (`ಿ, ೀ, ೆ, ೇ, ೊ, ೋ`) and *ottaksharas* (`್ಕ, ್ತ, ು, ೂ`) are never clipped.
3. **Text Recognition (What does it say?):**
   - Applies adaptive contrast stretch on faint/shadowed camera crops.
   - Runs **PP-OCRv4 Kannada (`ppocrv4_rec_kannada.v1.onnx`)** and **PP-OCRv5 Latin (`ppocrv5_rec_latin.v1.onnx`)** with smart script routing (`kn` / `en` / `mixed`).
4. **Kannada Accuracy Post-Processing:**
   - **Unicode NFC normalization** & CTC stutter cleanup (`normalizeKannadaText`).
   - **Kannada form lexicon snapping** (`ಹೆಸರು`, `ವಿಳಾಸ`, `ತಾಲೂಕು`, etc.).
   - **All 31 Karnataka Districts** bilingual fuzzy matching (`karnataka_localities.json`).

### Slide 5: Key Features Built
- **Auto Mode & Template Mode:** Automatically pairs labels & values on unknown forms, or maps boxes onto predefined templates (Ration Card, Income Certificate).
- **Interactive Bounding-Box Review:** Color-coded confidence boxes (Green ≥ 85%, Amber 60–85%, Red < 60%), tap to edit, draw/delete boxes, and re-run OCR on a single box.
- **Batch Scanning:** Scan/upload multiple pages in a row; saved in a persistent **IndexedDB (Dexie)** queue that resumes even if the app restarts.
- **Learn from Corrections:** Saves user edits + image crops locally and exports a training-ready **ZIP dataset** (`crops/*.png` + `labels.csv`) from Settings.
- **Editable JSON → Layout-Matching PDF:** Converts extracted text into an **editable JSON** editor and generates a **multi-page PDF** preserving the exact layout & positions of the original scanned image (with full Kannada Unicode rendering).

### Slide 6: Tech Stack
- **Frontend (Mobile Web App):** React 19, TypeScript, TanStack Router, Tailwind CSS
- **Offline PWA & Storage:** `vite-plugin-pwa` (Workbox Service Worker), Cache Storage, Dexie (IndexedDB)
- **On-Device AI Inference:** `onnxruntime-web` (WASM in Web Worker), PP-OCRv4 Detection, PP-OCRv4 Kannada, PP-OCRv5 Latin, Tesseract.js (WASM fallback)
- **Online AI (Optional):** Google Gemini Vision API (`gemini-3.8-flash`)
- **Export & Utilities:** `jspdf` + Canvas rendering (Kannada + English PDF), `jszip` (corrections dataset), `fuse.js` (fuzzy matching)
- **Optional Cloud Sync:** Supabase (Auth + Postgres + Storage)

### Slide 7: Architecture Flow (For Diagram)
`Mobile Camera` → `Blur/Brightness Check` → `Web Worker (DBNet Detection + Kannada/Latin ONNX)` or `Gemini AI (if Online)` → `Kannada Normalization & 31-District Fuzzy Snap` → `Interactive Review & Dexie Storage` → `Editable JSON → Layout-Matching PDF / CSV / ZIP`

---

## Quick Start (Developer Setup)

```bash
npm install --legacy-peer-deps
npm run fetch-models  # downloads & SHA-256 verifies ONNX models into public/models/
npm run dev           # development server
npm test              # run unit tests (Vitest)
npm run build         # production build + PWA service worker
npm run preview       # preview production build
```

### Optional Environment Variables (`.env`)
Copy `.env.example` to `.env` (never commit `.env`):
```env
# Optional Gemini Vision AI (Online mode on Scan screen)
VITE_GEMINI_API_KEY=your_key_here
VITE_GEMINI_MODEL=gemini-3.8-flash

# Optional Supabase Sync
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

---

## Project Structure

```text
src/
  config/
    ocrModels.ts             ← Canonical ONNX tensor contracts, class counts & thresholds
    quality.ts               ← Blur/brightness thresholds & EN+KN warning messages
  db/
    schema.ts                ← Dexie (IndexedDB) tables: forms, fields, corrections, batchQueue
  workers/
    ocr.worker.ts            ← Web Worker entry (single ORT WASM init + pipeline dispatch)
    gemini-engine.ts         ← Optional online Gemini Vision OCR with bbox parsing
    tesseract-engine.ts      ← Offline Tesseract WASM fallback
    pipeline/
      detect.ts              ← PP-OCRv4 DBNet detection + padded quad crop + reading order
      paddle-engine.ts       ← PP-OCRv4 Kannada + PP-OCRv5 Latin CTC + contrast & script routing
  lib/formlens/
    kannadaNormalize.ts      ← Kannada NFC normalization & form lexicon snapping
    fuzzySnap.ts             ← Bilingual EN+KN fuzzy matcher for all 31 Karnataka districts
    boxAssignment.ts         ← Template IoU assignment & Auto label/value pairing
    jsonPdf.ts               ← Editable JSON editor & layout-preserving Kannada+English PDF
    imageQuality.ts          ← Offline Laplacian blur & brightness check
    corrections.ts           ← Corrections ZIP dataset exporter (PNG crops + labels.csv)
    exports.ts               ← JSON, CSV, PDF & Annotated PNG exports
  components/formlens/       ← CameraCapture, LensOverlay, BoxReviewOverlay, JsonToPdfDialog
  routes/                    ← setup, scan, review.$id, forms, settings, install
public/
  models/                    ← manifest.json, dictionaries, & fetched ONNX models
  ort/                       ← Self-hosted ONNX Runtime WASM files (no CDN needed)
  data/
    karnataka_localities.json ← All 31 Karnataka districts (English + Kannada + taluks)
  templates/                 ← ration-card.json, income-certificate.json
```

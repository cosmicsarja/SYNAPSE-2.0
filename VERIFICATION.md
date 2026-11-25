# FormLens Verification Report

## 1. Automated Unit Tests (`npm test`)
- Command: `npm test` (`vitest run`)
- Result: **2 test files passed, 7 tests passed**
  - `src/test/app-routing.test.tsx`: 1/1 passed
  - `src/test/ocr-pipeline.test.ts`: 6/6 passed
    - DBNet probability map post-processing (`postProcessDbMap` on synthetic probability map)
    - Reading-order sorting (`sortBoxesReadingOrder`)
    - CTC greedy decoding & dictionary/blank alignment (`buildCtcVocab` + `ctcGreedyDecode`, including mismatch assertion)
    - Box-to-template assignment (`assignBoxesToTemplateFields`, multi-box join & `"Not found"`)
    - Auto-mode fuzzy label/value pairing (`pairLabelsAndValues`)

## 2. Model Fetch & Inspection
- `node scripts/fetch-models.mjs`:
  - Verified MIT licence on `huggingface.co/byrizki/rusto-models`
  - Downloaded & SHA-256 locked in `models.lock.json`:
    - `ppocrv4_det.v1.onnx` (4.53 MB)
    - `ppocrv4_rec_kannada.v1.onnx` (7.33 MB) + `ppocrv4_dict_kannada.v1.txt` (153 lines)
    - `ppocrv5_rec_latin.v1.onnx` (7.54 MB) + `ppocrv5_dict_latin.v1.txt` (502 lines)
- `python3 scripts/inspect_onnx.py`:
  - Confirmed input tensor name `"x"`, output tensor names (`"sigmoid_0.tmp_0"`, `"softmax_2.tmp_0"`, `"fetch_name_0"`), `H=48`, trailing `Softmax` (`row sum = 1.000000`), and `C = dict_lines + 2` (`<blank>` at index `0`, `' '` at end).

## 3. End-to-End ONNX Model Check on Sample Page (`public/bench/pages/sample_mixed_en_kn.png`)
- `ppocrv4_det.v1.onnx` produced `(416, 800)` probability map (`max = 1.0`, `11285` pixels `>= 0.3`).
- `ppocrv4_rec_kannada.v1.onnx` & `ppocrv5_rec_latin.v1.onnx` with `ocrModels.ts` contract:
  - `'Name: Ramesh Kumar'` -> EN `'Name: Ramesh Kumar'` (`1.000`) > KN (`0.965`)
  - `'Mobile: 9876543210'` -> EN `'Mobile: 9876543210'` (`1.000`) > KN (`0.939`)
  - `'ಹೆಸರು: ರಮೇಶ್'` -> KN `'ಹೆಸರು: ರಮಶ್-'` (`0.978`) > EN (`0.376`)
  - `'Pincode: 560001'` -> EN `'Pincode: 560001'` (`1.000`) > KN (`0.940`)
- **Honest accuracy note:** The sample above is clean printed/rendered text. Messy cursive handwriting accuracy with pre-trained PP-OCR models is expected to be lower and should be measured on your own labelled `public/bench/pages/` photos via **Settings > Diagnostics & Benchmark**.

## 4. Production Build & Preview (`npm run build` + `vite preview`)
- `npm run build` exited `0`:
  - `prebuild` verified all locked ONNX models (`SHA-256 OK`).
  - `dist/client/sw.js` generated precaching **57 files (2.34 MB)**, with runtime `CacheFirst` rules for `/models/*.{onnx,json,txt}` and `/ort/*.wasm`.
- `npx vite preview --port 4173`:
  - `/`, `/scan`, `/setup`, `/settings`, `/models/manifest.json`, `/models/ppocrv4_det.v1.onnx`, `/models/ppocrv4_dict_kannada.v1.txt`, `/sw.js`, `/ort/ort-wasm-simd-threaded.wasm` all returned **HTTP 200**.
- **Manual Browser Step Remaining:** Complete the in-app `/setup` offline pack download in Chrome/Edge, switch DevTools Network to **Offline**, reload, and run a scan in **Auto** and **Template** modes to confirm zero network requests in your browser session.

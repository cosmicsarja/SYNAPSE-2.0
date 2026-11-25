# FormLens Pre-Trained Offline OCR Models

Source repository: https://huggingface.co/byrizki/rusto-models  
Verified licence: **MIT**

| File Name | Source | Size | SHA-256 (prefix) | Licence | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ppocrv4_det.v1.onnx` | [HF](https://huggingface.co/byrizki/rusto-models/resolve/main/ppocrv4-mobile/det.onnx) | 4.53 MB (4745517 B) | `d2a7720d45a54257…` | MIT | DBNet text region detection (bounding boxes) |
| `ppocrv4_rec_kannada.v1.onnx` | [HF](https://huggingface.co/byrizki/rusto-models/resolve/main/multilingual/ppocrv4_rec_kannada.onnx) | 7.33 MB (7681381 B) | `9c1e186ea1d13cf6…` | MIT | Kannada script text recognition (SVTR/CRNN CTC) |
| `ppocrv4_dict_kannada.v1.txt` | [HF](https://huggingface.co/byrizki/rusto-models/resolve/main/multilingual/ppocrv4_dict_kannada.txt) | 0.00 MB (452 B) | `fad3f765943275ee…` | MIT | Kannada CTC character dictionary |
| `ppocrv5_rec_latin.v1.onnx` | [HF](https://huggingface.co/byrizki/rusto-models/resolve/main/multilingual/ppocrv5_rec_latin.onnx) | 7.54 MB (7904513 B) | `b20bd37c168a570f…` | MIT | English / Latin & digits text recognition (CTC) |
| `ppocrv5_dict_latin.v1.txt` | [HF](https://huggingface.co/byrizki/rusto-models/resolve/main/multilingual/ppocrv5_dict_latin.txt) | 0.00 MB (1634 B) | `3c0a8a79b612653c…` | MIT | English / Latin CTC character dictionary |

## Verification & Integrity
- `models.lock.json` stores the exact SHA-256 digest and byte size for every file.
- `npm run fetch-models` (also wired into `prebuild`) verifies local files against `models.lock.json` and fails the build on any hash mismatch.
- `public/models/manifest.json` is generated automatically from `models.lock.json` for the in-app offline pack downloader.

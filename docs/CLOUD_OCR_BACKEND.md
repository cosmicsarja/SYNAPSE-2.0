# Hybrid Python OCR Backend Setup (`Handwritten-Form-OCR`)

FormLens supports a **Hybrid Cloud + Offline** mode:
- **Online**: sends cropped form images to your Python `Handwritten-Form-OCR` FastAPI backend (EasyOCR / TrOCR / OpenCV preprocessing).
- **Offline (or unreachable)**: automatically falls back to FormLens's on-device `tesseract.js` (`eng` + `kan`) engine.

---

## 1. Adapt `bishowdip/Handwritten-Form-OCR` for Kannada + English

Clone the Python repo separately:

```bash
git clone https://github.com/bishowdip/Handwritten-Form-OCR.git
cd Handwritten-Form-OCR
```

1. **Change OCR languages from Nepali (`ne`) to Kannada (`kn`)**:
   - In `app/core/ocr_engine.py` and `training/configs/config.yaml`:
     - EasyOCR: `['en', 'ne']` → `['en', 'kn']`
     - Tesseract: `eng+nep` → `eng+kan`
2. **Enable CORS for your Vercel domain** in `main.py`:
   ```python
   from fastapi.middleware.cors import CORSMiddleware
   app.add_middleware(
       CORSMiddleware,
       allow_origins=["https://<your-app>.vercel.app", "http://localhost:3000"],
       allow_methods=["*"],
       allow_headers=["*"],
   )
   ```
3. *(Optional for Google Lens bounding-box highlights)*: Return `lines` in `/extract`:
   ```json
   {
     "fullText": "...",
     "lines": [
       { "text": "Ramesh Kumar", "confidence": 0.94, "bbox": { "x0": 40, "y0": 50, "x1": 320, "y1": 85 } }
     ]
   }
   ```
   FormLens supports **both** `{ fullText, lines }` and the default `/extract` `{ fields, metadata }` JSON response.

---

## 2. Deploy & Connect

1. Deploy the Python repo with `docker/Dockerfile` on Render, Railway, or Hugging Face Spaces.
2. Either:
   - Set `VITE_OCR_API_URL=https://your-ocr-api.onrender.com` in Vercel Environment Variables, **or**
   - Open FormLens → **Settings → OCR ENGINE → Hybrid Cloud + Offline OCR**, paste the URL, and tap **Test**.

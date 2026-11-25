"""
FormLens Python OCR Backend
Combines:
  1. SubhrajyotiSen/KannadaHandwritingRecognition pre-trained Keras CNNs
     (cnn_model.h5 + cnn_model_ottak.h5) for handwritten Kannada recognition
  2. EasyOCR (['kn', 'en']) for full-page Google Lens bounding-box detection
     and mixed Kannada + English + numbers recognition.
"""
import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import easyocr

from kannada_pipeline import KannadaHandwritingRecognizer

app = FastAPI(title="FormLens Kannada + English OCR API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("[FormLens API] Loading EasyOCR (kn + en)...")
easy_reader = easyocr.Reader(["kn", "en"], gpu=False)

print("[FormLens API] Loading KannadaHandwritingRecognition CNN models...")
kannada_cnn = KannadaHandwritingRecognizer()
print("[FormLens API] All pre-trained models ready!")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "models": ["kannada_handwriting_cnn", "easyocr_kn_en"],
    }


@app.post("/extract")
@app.post("/api/v1/ocr")
async def extract_ocr(
    file: UploadFile = File(...),
    lang: str = Form("eng+kan"),
):
    raw = await file.read()
    nparr = np.frombuffer(raw, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        return {"fullText": "", "lines": []}

    h, w = img_bgr.shape[:2]

    # 1. Detect & recognize text boxes with EasyOCR (kn + en)
    results = easy_reader.readtext(img_bgr)
    lines = []

    for bbox, text, conf in results:
        text = str(text).strip()
        if not text:
            continue
        x0 = max(0, int(min(pt[0] for pt in bbox)))
        y0 = max(0, int(min(pt[1] for pt in bbox)))
        x1 = min(w, int(max(pt[0] for pt in bbox)))
        y1 = min(h, int(max(pt[1] for pt in bbox)))

        # If Kannada mode is requested and EasyOCR confidence is low on a box,
        # also try the pre-trained KannadaHandwritingRecognition CNN on that crop
        if "kan" in lang and conf < 0.45 and (y1 - y0) >= 16 and (x1 - x0) >= 16:
            crop = img_bgr[y0:y1, x0:x1]
            try:
                kn_text = kannada_cnn.recognize_image(crop)
                if kn_text:
                    text = kn_text
                    conf = max(float(conf), 0.72)
            except Exception:
                pass

        lines.append({
            "text": text,
            "confidence": float(conf),
            "bbox": {"x0": x0, "y0": y0, "x1": x1, "y1": y1},
        })

    # 2. If EasyOCR found nothing in Kannada mode, run full-image Kannada CNN pipeline
    if not lines and "kan" in lang:
        try:
            kn_text = kannada_cnn.recognize_image(img_bgr)
            if kn_text:
                lines.append({
                    "text": kn_text,
                    "confidence": 0.78,
                    "bbox": {"x0": 10, "y0": 10, "x1": max(20, w - 10), "y1": max(40, h - 10)},
                })
        except Exception:
            pass

    full_text = "\n".join(line["text"] for line in lines)
    return {"fullText": full_text, "lines": lines}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

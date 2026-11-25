"""
FormLens Python OCR Backend
Combines:
  1. OpenCV preprocessing from user pipeline (resize_to_working_width + bilateralFilter + CLAHE)
  2. EasyOCR (['kn', 'en']) with handwriting-tuned thresholds for automatic bounding block detection
  3. SubhrajyotiSen/KannadaHandwritingRecognition (pretrained Keras CNNs: cnn_model.h5 + cnn_model_ottak.h5)
  4. Per-block script/language classification ('kn' | 'en' | 'mixed' | 'number')

Exposes:
  GET  /health
  POST /extract            (used by FormLens cloud-engine.ts)
  POST /api/v1/ocr         (alias)
  POST /extract-kannada    (pure KannadaHandwritingRecognition CNN pipeline)
"""
import os
import re
import cv2
import numpy as np
import easyocr
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from kannada_pipeline import KannadaHandwritingRecognizer

MAX_WORKING_WIDTH = 1800
DEFAULT_BOX_PAD_NORM = (-0.004, -0.004, 0.006, 0.005)

app = FastAPI(title="FormLens Kannada + English Auto-Detect OCR API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("[OCR Backend] Loading KannadaHandwritingRecognition CNN models...")
kannada_cnn = KannadaHandwritingRecognizer()

print("[OCR Backend] Loading EasyOCR (kn + en)...")
easy_reader_kn_en = easyocr.Reader(["kn", "en"], gpu=False)


def resize_to_working_width(gray: np.ndarray, max_width: int = MAX_WORKING_WIDTH) -> tuple[np.ndarray, float]:
    h, w = gray.shape[:2]
    if w <= max_width:
        return gray.copy(), 1.0
    scale = max_width / float(w)
    new_size = (max_width, max(1, int(round(h * scale))))
    return cv2.resize(gray, new_size, interpolation=cv2.INTER_AREA), scale


def preprocess_gray(gray: np.ndarray) -> np.ndarray:
    denoised = cv2.bilateralFilter(gray, d=7, sigmaColor=50, sigmaSpace=50)
    clahe = cv2.createCLAHE(clipLimit=1.8, tileGridSize=(8, 8))
    return clahe.apply(denoised)


def detect_block_language(text: str) -> str:
    has_kn = bool(re.search(r"[\u0C80-\u0CFF]", text))
    has_en = bool(re.search(r"[A-Za-z]", text))
    has_digit = bool(re.search(r"\d", text))
    if has_kn and has_en:
        return "mixed"
    if has_kn:
        return "kn"
    if has_en:
        return "en"
    if has_digit:
        return "number"
    return "en"


def pad_and_map_bbox(
    bbox_pts: list,
    proc_w: int,
    proc_h: int,
    orig_w: int,
    orig_h: int,
    scale: float,
) -> dict[str, int]:
    x0 = min(pt[0] for pt in bbox_pts)
    y0 = min(pt[1] for pt in bbox_pts)
    x1 = max(pt[0] for pt in bbox_pts)
    y1 = max(pt[1] for pt in bbox_pts)

    pdx1, pdy1, pdx2, pdy2 = DEFAULT_BOX_PAD_NORM
    x0 += pdx1 * proc_w
    y0 += pdy1 * proc_h
    x1 += pdx2 * proc_w
    y1 += pdy2 * proc_h

    inv = 1.0 / scale if scale > 0 else 1.0
    return {
        "x0": max(0, min(orig_w - 2, int(round(x0 * inv)))),
        "y0": max(0, min(orig_h - 2, int(round(y0 * inv)))),
        "x1": max(1, min(orig_w, int(round(x1 * inv)))),
        "y1": max(1, min(orig_h, int(round(y1 * inv)))),
    }


@app.get("/health")
def health():
    return {
        "status": "ok",
        "models": ["kannada_cnn_h5", "kannada_ottak_h5", "easyocr_kn_en"],
        "languages": ["kn", "en"],
    }


def _decode_image(raw_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(raw_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Invalid image file")
    return img


@app.post("/extract")
@app.post("/api/v1/ocr")
async def extract(
    file: UploadFile = File(...),
    lang: str = Form("eng+kan"),
):
    raw = await file.read()
    img = _decode_image(raw)
    orig_h, orig_w = img.shape[:2]

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    resized_gray, scale = resize_to_working_width(gray, MAX_WORKING_WIDTH)
    proc_gray = preprocess_gray(resized_gray)
    proc_h, proc_w = proc_gray.shape[:2]

    # Handwriting-tuned EasyOCR detection + recognition
    results = easy_reader_kn_en.readtext(
        proc_gray,
        text_threshold=0.55,
        low_text=0.3,
        contrast_ths=0.1,
        adjust_contrast=0.5,
        mag_ratio=1.5,
    )

    lines = []
    for bbox, text, conf in results:
        t = str(text).strip()
        if not t:
            continue
        mapped_bbox = pad_and_map_bbox(bbox, proc_w, proc_h, orig_w, orig_h, scale)
        block_lang = detect_block_language(t)

        # Optional second-pass Kannada CNN check for low-confidence Kannada blocks
        if block_lang == "kn" and float(conf) < 0.45:
            crop = img[mapped_bbox["y0"]:mapped_bbox["y1"], mapped_bbox["x0"]:mapped_bbox["x1"]]
            if crop.size > 0:
                cnn_text = kannada_cnn.recognize_image(crop)
                if cnn_text:
                    t = cnn_text
                    conf = max(float(conf), 0.72)
                    block_lang = detect_block_language(t)

        lines.append(
            {
                "text": t,
                "language": block_lang,
                "confidence": float(conf),
                "bbox": mapped_bbox,
            }
        )

    # Full-page fallback to KannadaHandwritingRecognition CNN if pure Kannada mode missed text
    if lang == "kan" and not lines:
        cnn_text = kannada_cnn.recognize_image(img)
        if cnn_text:
            lines = [
                {
                    "text": cnn_text,
                    "language": detect_block_language(cnn_text),
                    "confidence": 0.85,
                    "bbox": {"x0": 10, "y0": 10, "x1": max(20, orig_w - 10), "y1": max(40, orig_h - 10)},
                }
            ]

    full_text = "\n".join(l["text"] for l in lines)
    return {"fullText": full_text, "lines": lines}


@app.post("/extract-kannada")
async def extract_kannada_cnn(file: UploadFile = File(...)):
    raw = await file.read()
    img = _decode_image(raw)
    h, w = img.shape[:2]
    text = kannada_cnn.recognize_image(img)
    lines = (
        [
            {
                "text": text,
                "language": detect_block_language(text),
                "confidence": 0.85,
                "bbox": {"x0": 10, "y0": 10, "x1": max(20, w - 10), "y1": max(40, h - 10)},
            }
        ]
        if text
        else []
    )
    return {"fullText": text, "lines": lines}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)

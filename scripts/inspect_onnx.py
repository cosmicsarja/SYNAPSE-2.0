#!/usr/bin/env python3
"""
Inspects the downloaded PP-OCR ONNX models & dictionaries:
- Prints input/output names, shapes, dtypes
- Checks whether the recognition models end with Softmax or raw logits
- Asserts output class count C matches dictionary length + expected blank/space entries
"""
import json
import sys
from pathlib import Path
import numpy as np
import onnx
import onnxruntime as ort

MODELS_DIR = Path("public/models")

def inspect_model(onnx_path: Path, dict_path: Path | None = None):
    print(f"\n=== {onnx_path.name} ===")
    model = onnx.load(str(onnx_path))
    last_op = model.graph.node[-1].op_type if model.graph.node else "unknown"
    has_trailing_softmax = last_op == "Softmax"

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    inputs = [
        {"name": i.name, "shape": i.shape, "type": i.type}
        for i in sess.get_inputs()
    ]
    outputs = [
        {"name": o.name, "shape": o.shape, "type": o.type}
        for o in sess.get_outputs()
    ]
    print("Inputs :", json.dumps(inputs))
    print("Outputs:", json.dumps(outputs))
    print("Last ONNX op:", last_op, "| isProbabilities:", has_trailing_softmax)

    # Run a dummy forward pass to check exact output tensor sum (softmax check) and shape
    in_shape = [d if isinstance(d, int) and d > 0 else (1 if idx == 0 else (3 if idx == 1 else (48 if "rec" in onnx_path.name else 640))) for idx, d in enumerate(inputs[0]["shape"])]
    if "rec" in onnx_path.name and len(in_shape) == 4:
        in_shape[3] = 320
    dummy = np.zeros(in_shape, dtype=np.float32)
    out = sess.run(None, {inputs[0]["name"]: dummy})[0]
    print("Dummy input shape:", in_shape, "-> output shape:", list(out.shape))
    if out.ndim == 3:
        row_sum = float(out[0, 0, :].sum())
        print(f"Row sum at [0,0,:]: {row_sum:.6f} (min={out.min():.4f}, max={out.max():.4f})")
        C = out.shape[-1]
        if dict_path is not None:
            lines = dict_path.read_text(encoding="utf-8").splitlines()
            print(f"Dict {dict_path.name} lines: {len(lines)}, model C: {C}, diff (C - len): {C - len(lines)}")
            # Standard PaddleOCR CTC: index 0 = blank, 1..N = dict lines, optionally N+1 = space ' '
            if C not in (len(lines) + 1, len(lines) + 2):
                raise AssertionError(
                    f"Class count mismatch for {onnx_path.name}: model C={C}, dict lines={len(lines)}"
                )
    return {
        "inputs": inputs,
        "outputs": outputs,
        "hasTrailingSoftmax": has_trailing_softmax,
        "dummyInputShape": in_shape,
        "dummyOutputShape": list(out.shape),
    }

def main():
    det = inspect_model(MODELS_DIR / "ppocrv4_det.v1.onnx")
    kn = inspect_model(MODELS_DIR / "ppocrv4_rec_kannada.v1.onnx", MODELS_DIR / "ppocrv4_dict_kannada.v1.txt")
    en = inspect_model(MODELS_DIR / "ppocrv5_rec_latin.v1.onnx", MODELS_DIR / "ppocrv5_dict_latin.v1.txt")
    print("\nAll ONNX model inspections & dictionary assertions PASSED.")

if __name__ == "__main__":
    main()

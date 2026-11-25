"""
KannadaHandwritingRecognition pipeline wrapper.
Loads the pre-trained Keras CNN models (cnn_model.h5 + cnn_model_ottak.h5) once
using tf_keras + custom LRN2D layer, segments lines/words/characters/ottaksharas,
and reconstructs Kannada Unicode text.
"""
import os
import sys
import tempfile
import cv2
import numpy as np
import tensorflow as tf
import tf_keras

# Ensure local imports (CNN, Unicode, preprocessing) resolve cleanly
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from CNN.ottakshara_dict import ottakshara_mapping
from preprocessing.segment_sentence import segment_sentence
from preprocessing.segment_word import segment_word
from preprocessing.segment_character import segment_character
from preprocessing.augment import augment
from Unicode.seqgen import sequenceGen
from Unicode.printdoc import unicode_to_kn


class LRN2D(tf_keras.layers.Layer):
    """Local Response Normalization layer compatible with legacy Keras 2 .h5 weights."""

    def __init__(self, alpha=1e-4, k=2, beta=0.75, n=5, **kwargs):
        super().__init__(**kwargs)
        self.alpha = alpha
        self.k = k
        self.beta = beta
        self.n = n

    def call(self, x):
        return tf.nn.local_response_normalization(
            x,
            depth_radius=self.n // 2,
            bias=self.k,
            alpha=self.alpha,
            beta=self.beta,
        )

    def get_config(self):
        cfg = super().get_config()
        cfg.update({"alpha": self.alpha, "k": self.k, "beta": self.beta, "n": self.n})
        return cfg


class KannadaHandwritingRecognizer:
    def __init__(self):
        os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
        model_dir = os.path.join(BACKEND_DIR, "CNN")
        self.char_model = tf_keras.models.load_model(
            os.path.join(model_dir, "cnn_model.h5"),
            custom_objects={"LRN2D": LRN2D},
            compile=False,
        )
        self.ottak_model = tf_keras.models.load_model(
            os.path.join(model_dir, "cnn_model_ottak.h5"),
            custom_objects={"LRN2D": LRN2D},
            compile=False,
        )

    @staticmethod
    def _predict_image(img_path: str, model) -> int:
        img = cv2.imread(img_path, cv2.IMREAD_GRAYSCALE)
        if img is None:
            return 0
        if img.shape != (52, 52):
            img = cv2.resize(img, (52, 52), interpolation=cv2.INTER_AREA)
        x = np.reshape(img, (1, 52, 52, 1))
        probs = model.predict(x, verbose=0)[0]
        return int(np.argmax(probs))

    def recognize_image(self, image_bgr: np.ndarray) -> str:
        with tempfile.TemporaryDirectory() as tmpdir:
            seg_dir = os.path.join(tmpdir, "segmented")
            aug_dir = os.path.join(tmpdir, "augmented")
            os.makedirs(seg_dir, exist_ok=True)
            os.makedirs(aug_dir, exist_ok=True)

            sentences = segment_sentence(image_bgr, seg_dir)
            if not sentences:
                return ""

            for i, sent in enumerate(sentences):
                words = segment_word(sent, seg_dir, i)
                for j, word in enumerate(words):
                    characters, ottaksharas = segment_character(word, seg_dir)
                    for key, ch_img in characters.items():
                        name = f"{i+1:02d}-{j+1:02d}-{key+1:02d}-0.png"
                        cv2.imwrite(os.path.join(seg_dir, name), ch_img)
                    for key, ot_img in ottaksharas.items():
                        name = f"{i+1:02d}-{j+1:02d}-{key+1:02d}-1.png"
                        cv2.imwrite(os.path.join(seg_dir, name), ot_img)

            seg_files = sorted(f for f in os.listdir(seg_dir) if f.endswith(".png"))
            if not seg_files:
                return ""

            # augment() expects rootdir containing a Segmented_* subfolder
            # Wrap seg_dir inside a parent so augment reads it cleanly
            wrap_root = os.path.join(tmpdir, "wrap")
            wrap_seg = os.path.join(wrap_root, "Segmented_input")
            os.makedirs(wrap_root, exist_ok=True)
            os.symlink(seg_dir, wrap_seg)
            augment(wrap_root, aug_dir)

            aug_files = sorted(f for f in os.listdir(aug_dir) if f.endswith(".png"))
            if not aug_files:
                return ""

            predictions = {}
            for fname in aug_files:
                fpath = os.path.abspath(os.path.join(aug_dir, fname))
                if "-1" in fname:
                    idx = self._predict_image(fpath, self.ottak_model)
                    predictions[fname] = ottakshara_mapping.get(idx, 0)
                else:
                    predictions[fname] = self._predict_image(fpath, self.char_model)

            sequence = sequenceGen(predictions)
            text = unicode_to_kn(sequence)
            return text.strip()

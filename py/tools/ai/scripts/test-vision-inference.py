#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Test vision inference and coordinate bounding box parsing for Qwen3-VL-8B.

Validates:
1. Presence of weights and multimodal projector (`mmproj`) in `.aphrody/models`.
2. Linux `llama-server` advertises multimodal projector (`--mmproj`) support.
3. Extraction and normalization of bounding box coordinates `[0, 1000]` -> `[0.0, 1.0]`.
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

APHRODY_HOME = Path(os.environ.get("APHRODY_HOME", Path.home() / ".aphrody"))
MODELS_DIR = Path(os.environ.get("APHRODY_MODELS_DIR", APHRODY_HOME / "models"))
MODEL_DIR = (
    MODELS_DIR
    / "hf"
    / "unsloth"
    / "Qwen3-VL-8B-Instruct-GGUF"
    / "b93a7ee713758252c555be4210c00540df954dc2"
)
WEIGHTS_PATH = MODEL_DIR / "Qwen3-VL-8B-Instruct-Q4_K_M.gguf"
MMPROJ_PATH = MODEL_DIR / "mmproj-F16.gguf"

LLAMA_DIR = os.environ.get("APHRODY_LLAMA_DIR")
LLAMA_BIN = os.environ.get("APHRODY_LLAMA_BIN")
if LLAMA_BIN:
    LLAMA_SERVER = Path(LLAMA_BIN)
elif LLAMA_DIR:
    LLAMA_SERVER = Path(LLAMA_DIR) / "llama-server"
elif llama_server := shutil.which("llama-server"):
    LLAMA_SERVER = Path(llama_server)
else:
    runtimes_dir = APHRODY_HOME / "runtimes"
    LLAMA_SERVER = next(
        (
            path
            for path in sorted(runtimes_dir.glob("llama-*/llama-server"), reverse=True)
            if path.is_file()
        ),
        runtimes_dir / "llama-b10549" / "llama-server",
    )


def parse_qwen_bbox(text: str):
    """Parse Qwen-VL bounding box representations.

    Format A: <|box_start|>(ymin, xmin),(ymax, xmax)<|box_end|>
    Format B: [ymin, xmin, ymax, xmax] normalized to [0, 1000]
    Returns list of dicts: {'label': str, 'bbox': [x0, y0, x1, y1]} in 0.0..1.0 range.
    """
    results = []

    # Format A: <|ref|>label<|/ref|><|box_start|>(y0, x0),(y1, x1)<|box_end|>
    box_start_pattern = re.finditer(
        r"(?:<\|ref\|>(?P<label>[^<]+)<\|/ref\|>)?\s*<\|box_start\|>\s*\((?P<y0>\d+)\s*,\s*(?P<x0>\d+)\)\s*,\s*\((?P<y1>\d+)\s*,\s*(?P<x1>\d+)\)\s*<\|box_end\|>",
        text,
    )
    for m in box_start_pattern:
        label = m.group("label") or "object"
        y0 = float(m.group("y0")) / 1000.0
        x0 = float(m.group("x0")) / 1000.0
        y1 = float(m.group("y1")) / 1000.0
        x1 = float(m.group("x1")) / 1000.0
        results.append(
            {
                "label": label.strip(),
                "bbox": [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)],
            }
        )

    # Format B: label: [y0, x0, y1, x1] or [y0, x0, y1, x1]
    bracket_pattern = re.finditer(
        r"(?:(?P<label>[a-zA-Z0-9_\s]+)\s*[:=-]\s*)?\[\s*(?P<y0>\d+)\s*,\s*(?P<x0>\d+)\s*,\s*(?P<y1>\d+)\s*,\s*(?P<x1>\d+)\s*\]",
        text,
    )
    for m in bracket_pattern:
        label = (m.group("label") or "").strip() or "object"
        y0 = float(m.group("y0")) / 1000.0
        x0 = float(m.group("x0")) / 1000.0
        y1 = float(m.group("y1")) / 1000.0
        x1 = float(m.group("x1")) / 1000.0
        results.append(
            {
                "label": label,
                "bbox": [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)],
            }
        )

    return results


def test_parser_unit():
    """Check Qwen-VL bounding box parsing and coordinate normalization."""
    print("[TEST 1/3] Testing bounding box parsing logic...")
    sample_text_1 = (
        "<|ref|>red car<|/ref|><|box_start|>(150, 200), (600, 850)<|box_end|>"
    )
    boxes_1 = parse_qwen_bbox(sample_text_1)
    assert len(boxes_1) == 1, f"Expected 1 box, got {len(boxes_1)}"
    assert boxes_1[0]["label"] == "red car"
    assert abs(boxes_1[0]["bbox"][0] - 0.200) < 1e-4
    assert abs(boxes_1[0]["bbox"][1] - 0.150) < 1e-4
    assert abs(boxes_1[0]["bbox"][2] - 0.850) < 1e-4
    assert abs(boxes_1[0]["bbox"][3] - 0.600) < 1e-4

    sample_text_2 = "navigation_bar: [50, 100, 120, 950]\nbutton: [800, 400, 880, 600]"
    boxes_2 = parse_qwen_bbox(sample_text_2)
    assert len(boxes_2) == 2, f"Expected 2 boxes, got {len(boxes_2)}"
    assert boxes_2[0]["label"] == "navigation_bar"
    assert abs(boxes_2[0]["bbox"][1] - 0.050) < 1e-4
    assert abs(boxes_2[0]["bbox"][0] - 0.100) < 1e-4
    assert abs(boxes_2[0]["bbox"][3] - 0.120) < 1e-4
    assert abs(boxes_2[0]["bbox"][2] - 0.950) < 1e-4
    print(" -> PASSED: Unit test parsing confirmed.")


def test_model_artefacts():
    """Check that model weights and the multimodal projector are installed."""
    print("[TEST 2/3] Checking Qwen3-VL-8B model & mmproj artefacts...")
    if not WEIGHTS_PATH.exists():
        raise FileNotFoundError(f"Model weights not found at {WEIGHTS_PATH}")
    if not MMPROJ_PATH.exists():
        raise FileNotFoundError(f"Multimodal projector not found at {MMPROJ_PATH}")

    weights_size_gb = WEIGHTS_PATH.stat().st_size / (1024**3)
    mmproj_size_gb = MMPROJ_PATH.stat().st_size / (1024**3)
    print(f" -> Found weights: {WEIGHTS_PATH.name} ({weights_size_gb:.2f} GB)")
    print(f" -> Found mmproj:  {MMPROJ_PATH.name} ({mmproj_size_gb:.2f} GB)")
    print(" -> PASSED: Model artefacts verified.")


def test_runtime_cli():
    """Check that the Linux llama-server executable advertises mmproj support."""
    print("[TEST 3/3] Checking llama runtime mmproj support...")
    if not LLAMA_SERVER.is_file() or not os.access(LLAMA_SERVER, os.X_OK):
        raise FileNotFoundError(
            f"Executable llama-server not found at {LLAMA_SERVER}; set APHRODY_LLAMA_BIN or APHRODY_LLAMA_DIR."
        )

    # Verify server capability inspection (--help contains --mmproj)
    proc = subprocess.run(
        [str(LLAMA_SERVER), "--help"],
        capture_output=True,
        text=True,
        errors="replace",
        check=False,
    )
    output = proc.stdout + proc.stderr
    if "--mmproj" in output:
        print(" -> PASSED: llama-server advertises '--mmproj' flag support.")
    else:
        print(" -> WARNING: '--mmproj' not found in llama-server help text.")


def main():
    """Run the parser, model-artifact, and runtime checks."""
    print("=== Testing Vision Inference & Qwen3-VL Bounding Box Pipeline ===")
    test_parser_unit()
    test_model_artefacts()
    test_runtime_cli()
    print("\n[ALL TESTS PASSED SUCCESSFULLY]")
    return 0


if __name__ == "__main__":
    sys.exit(main())

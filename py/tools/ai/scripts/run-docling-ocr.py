#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Run document OCR and high-fidelity extraction using Granite Docling 258M.

Usage:
    uv run tools/ai/scripts/run-docling-ocr.py path/to/document.pdf --format markdown --out output.md
    uv run tools/ai/scripts/run-docling-ocr.py path/to/image.png --format json --out output.json
    uv run tools/ai/scripts/run-docling-ocr.py path/to/image.png --device cuda
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from aphrody.document.docling_extractor import DoclingExtractor


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run OCR and document parsing with Granite Docling 258M."
    )
    parser.add_argument(
        "input",
        type=str,
        help="Path to input document (PDF or image).",
    )
    parser.add_argument(
        "--format",
        "-f",
        choices=["markdown", "json", "both"],
        default="markdown",
        help="Output format to emit (default: markdown).",
    )
    parser.add_argument(
        "--out",
        "-o",
        type=str,
        default=None,
        help="Optional output file path. Prints to stdout if omitted.",
    )
    parser.add_argument(
        "--device",
        "-d",
        choices=["auto", "cuda", "cpu"],
        default="auto",
        help="Compute device (auto, cuda, cpu).",
    )
    parser.add_argument(
        "--max-tokens",
        "-n",
        type=int,
        default=1024,
        help="Token budget per page (default: 1024).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)

    if not input_path.exists():
        print(f"Error: input file '{input_path}' not found.", file=sys.stderr)
        sys.exit(1)

    extractor = DoclingExtractor(
        device=args.device,
        max_tokens=args.max_tokens,
    )

    if not extractor.verify_model_present():
        print(
            f"Error: Granite Docling model weights not found at {extractor.weights_path}",
            file=sys.stderr,
        )
        sys.exit(1)

    result = extractor.extract_document(input_path)

    if args.format == "markdown":
        output_text = result.markdown
    elif args.format == "json":
        output_text = json.dumps(result.to_dict(), indent=2, ensure_ascii=False)
    else:  # both
        output_text = (
            f"--- MARKDOWN ---\n{result.markdown}\n\n--- JSON METADATA ---\n"
            + json.dumps(result.to_dict(), indent=2, ensure_ascii=False)
        )

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output_text, encoding="utf-8")
        print(
            f"Successfully processed {len(result.pages)} page(s) in {result.total_elapsed_ms} ms. Saved to {out_path}"
        )
    else:
        print(output_text)


if __name__ == "__main__":
    main()

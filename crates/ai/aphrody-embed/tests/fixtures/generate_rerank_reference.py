"""Regenerate tests/fixtures/rerank_reference.json with sentence-transformers' CrossEncoder.

Usage (from this directory, venv on disk as in generate_reference.py):
    <venv>/bin/python generate_rerank_reference.py
"""

import json
import platform
from pathlib import Path

import sentence_transformers
import torch
import transformers
from sentence_transformers import CrossEncoder

PAIRS = [
    (
        "How many people live in Berlin?",
        "Berlin had a population of 3,520,031 registered inhabitants in an area of 891.82 square kilometers.",
    ),
    (
        "How many people live in Berlin?",
        "Berlin is well known for its museums, galleries and a vibrant nightlife scene.",
    ),
    (
        "what is a web crawler",
        "A web crawler, sometimes called a spider, is an Internet bot that systematically browses "
        "the World Wide Web and is typically operated by search engines for the purpose of web indexing.",
    ),
]

MODELS = [
    ("cross-encoder/ms-marco-MiniLM-L6-v2", "233902d25c440f23af6f7d6e94d2946bac0bee0a"),
    ("BAAI/bge-reranker-base", "2cfc18c9415c912f9d8155881c133215df768a70"),
]


def main() -> None:
    torch.set_num_threads(4)
    cases = []
    for model_id, revision in MODELS:
        model = CrossEncoder(model_id, revision=revision, device="cpu")
        scores = model.predict([list(p) for p in PAIRS], batch_size=8, convert_to_numpy=True)
        cases.append(
            {
                "model": model_id,
                "revision": revision,
                "activation": type(model.activation_fn).__name__,
                "scores": [round(float(s), 7) for s in scores],
            }
        )
    out = {
        "produced_by": {
            "script": "tests/fixtures/generate_rerank_reference.py",
            "sentence_transformers": sentence_transformers.__version__,
            "transformers": transformers.__version__,
            "torch": torch.__version__,
            "python": platform.python_version(),
            "note": "CrossEncoder(model_id, revision).predict(pairs); scores include the "
            "model's default activation (Identity for ms-marco, Sigmoid for bge-reranker).",
        },
        "pairs": [list(p) for p in PAIRS],
        "cases": cases,
    }
    path = Path(__file__).with_name("rerank_reference.json")
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {path}")
    print(json.dumps(cases, indent=1))


if __name__ == "__main__":
    main()

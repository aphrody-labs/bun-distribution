"""Generate the pinned reranker reference fixture with SentenceTransformers."""

from __future__ import annotations

import argparse
import platform
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .generate_reference import _write_json_atomically

PAIRS = (
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
        (
            "A web crawler, sometimes called a spider, is an Internet bot that systematically browses "
            "the World Wide Web and is typically operated by search engines for the purpose of web indexing."
        ),
    ),
)

MODELS = (
    ("cross-encoder/ms-marco-MiniLM-L6-v2", "233902d25c440f23af6f7d6e94d2946bac0bee0a"),
    ("BAAI/bge-reranker-base", "2cfc18c9415c912f9d8155881c133215df768a70"),
)


@dataclass(frozen=True, slots=True)
class RerankFixtureGenerator:
    """Generate a reproducible reranker fixture at an explicit destination."""

    output_path: Path
    num_threads: int = 4

    def __post_init__(self) -> None:
        if self.num_threads < 1:
            raise ValueError("num_threads must be positive")

    def generate(self) -> Path:
        """Run the pinned CPU cross-encoders and atomically write their scores."""
        import sentence_transformers
        import torch
        import transformers
        from sentence_transformers import CrossEncoder

        torch.set_num_threads(self.num_threads)
        cases: list[dict[str, Any]] = []
        for model_id, revision in MODELS:
            model = CrossEncoder(model_id, revision=revision, device="cpu")
            scores = model.predict(
                [list(pair) for pair in PAIRS], batch_size=8, convert_to_numpy=True
            )
            cases.append(
                {
                    "model": model_id,
                    "revision": revision,
                    "activation": type(model.activation_fn).__name__,
                    "scores": [round(float(score), 7) for score in scores],
                }
            )

        document = {
            "produced_by": {
                "script": "aphrody_embedding_fixtures.generate_rerank_reference",
                "sentence_transformers": sentence_transformers.__version__,
                "transformers": transformers.__version__,
                "torch": torch.__version__,
                "python": platform.python_version(),
                "note": "CrossEncoder(model_id, revision).predict(pairs); scores include the "
                "model's default activation (Identity for ms-marco, Sigmoid for bge-reranker).",
            },
            "pairs": [list(pair) for pair in PAIRS],
            "cases": cases,
        }
        _write_json_atomically(self.output_path, document)
        return self.output_path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="destination JSON file")
    parser.add_argument("--threads", type=int, default=4, help="CPU threads per model")
    args = parser.parse_args(argv)
    if args.threads < 1:
        parser.error("--threads must be positive")
    output = RerankFixtureGenerator(args.output, args.threads).generate()
    print(f"wrote {output} ({len(MODELS)} cases)")


if __name__ == "__main__":
    main()

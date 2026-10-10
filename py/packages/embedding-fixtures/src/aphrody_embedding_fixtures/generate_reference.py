"""Generate the pinned embedding reference fixture with SentenceTransformers."""

from __future__ import annotations

import argparse
import json
import platform
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

LONG = (
    "Web crawlers discover pages by following hyperlinks, fetching documents over HTTP, "
    "and storing their content for later processing. A modern crawler must respect "
    "politeness delays, deduplicate near-identical pages, render JavaScript-heavy "
    "applications, and prioritise the frontier so that important pages are refreshed "
    "first. Once the text has been extracted, it is split into chunks, embedded into a "
    "dense vector space, and written to an approximate nearest neighbour index. "
) * 4

SENTENCES = (
    "The quick brown fox jumps over the lazy dog.",
    "BXC indexes the entire web so AI agents can search it without an API key.",
    "Le café de la gare ouvre à 7h30 et ferme à 22h ; les croissants sont excellents.",
    "How do I reset my password?",
    LONG,
)

MODELS = (
    (
        "sentence-transformers/all-MiniLM-L6-v2",
        "1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
        "passage",
        "",
    ),
    (
        "BAAI/bge-small-en-v1.5",
        "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a",
        "passage",
        "",
    ),
    (
        "BAAI/bge-small-en-v1.5",
        "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a",
        "query",
        "Represent this sentence for searching relevant passages: ",
    ),
    (
        "intfloat/multilingual-e5-small",
        "614241f622f53c4eeff9890bdc4f31cfecc418b3",
        "passage",
        "passage: ",
    ),
    (
        "intfloat/multilingual-e5-small",
        "614241f622f53c4eeff9890bdc4f31cfecc418b3",
        "query",
        "query: ",
    ),
)


@dataclass(frozen=True, slots=True)
class EmbeddingFixtureGenerator:
    """Generate a reproducible embedding fixture at an explicit destination."""

    output_path: Path
    num_threads: int = 4

    def __post_init__(self) -> None:
        if self.num_threads < 1:
            raise ValueError("num_threads must be positive")

    def generate(self) -> Path:
        """Run the pinned CPU models and atomically write their reference vectors."""
        import sentence_transformers
        import torch
        import transformers
        from sentence_transformers import SentenceTransformer

        torch.set_num_threads(self.num_threads)
        cases: list[dict[str, Any]] = []
        for model_id, revision, kind, prefix in MODELS:
            model = SentenceTransformer(model_id, revision=revision, device="cpu")
            vectors = model.encode(
                [prefix + sentence for sentence in SENTENCES],
                batch_size=8,
                convert_to_numpy=True,
            )
            cases.append(
                {
                    "model": model_id,
                    "revision": revision,
                    "kind": kind,
                    "max_seq_length": model.max_seq_length,
                    "embeddings": [
                        [round(float(value), 8) for value in vector]
                        for vector in vectors
                    ],
                }
            )

        document = {
            "produced_by": {
                "script": "aphrody_embedding_fixtures.generate_reference",
                "sentence_transformers": sentence_transformers.__version__,
                "transformers": transformers.__version__,
                "torch": torch.__version__,
                "python": platform.python_version(),
                "note": "SentenceTransformer(model_id, revision).encode(prefix + sentence); "
                "vectors include the model's own Pooling + Normalize modules.",
            },
            "sentences": SENTENCES,
            "cases": cases,
        }
        _write_json_atomically(self.output_path, document)
        return self.output_path


def _write_json_atomically(path: Path, document: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as stream:
            temporary = stream.name
            json.dump(document, stream, indent=1, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
        Path(temporary).replace(path)
    finally:
        if temporary is not None:
            Path(temporary).unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="destination JSON file")
    parser.add_argument("--threads", type=int, default=4, help="CPU threads per model")
    args = parser.parse_args(argv)
    if args.threads < 1:
        parser.error("--threads must be positive")
    output = EmbeddingFixtureGenerator(args.output, args.threads).generate()
    print(f"wrote {output} ({len(MODELS)} cases)")


if __name__ == "__main__":
    main()

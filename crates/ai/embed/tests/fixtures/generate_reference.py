"""Regenerate tests/fixtures/reference.json with the official sentence-transformers stack.

Usage (from this directory):
    python3 -m venv /tmp/st
    /tmp/st/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
    /tmp/st/bin/pip install sentence-transformers
    /tmp/st/bin/python generate_reference.py
"""

import json
import platform
from pathlib import Path

import sentence_transformers
import torch
import transformers
from sentence_transformers import SentenceTransformer

LONG = (
    "Web crawlers discover pages by following hyperlinks, fetching documents over HTTP, "
    "and storing their content for later processing. A modern crawler must respect "
    "politeness delays, deduplicate near-identical pages, render JavaScript-heavy "
    "applications, and prioritise the frontier so that important pages are refreshed "
    "first. Once the text has been extracted, it is split into chunks, embedded into a "
    "dense vector space, and written to an approximate nearest neighbour index. "
) * 4  # ~330 word pieces: exercises truncation at max_seq_len.

SENTENCES = [
    "The quick brown fox jumps over the lazy dog.",
    "BXC indexes the entire web so AI agents can search it without an API key.",
    "Le café de la gare ouvre à 7h30 et ferme à 22h ; les croissants sont excellents.",
    "How do I reset my password?",
    LONG,
]

MODELS = [
    # (id, revision, kind, prefix)
    ("sentence-transformers/all-MiniLM-L6-v2", "1110a243fdf4706b3f48f1d95db1a4f5529b4d41", "passage", ""),
    ("BAAI/bge-small-en-v1.5", "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a", "passage", ""),
    (
        "BAAI/bge-small-en-v1.5",
        "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a",
        "query",
        "Represent this sentence for searching relevant passages: ",
    ),
    ("intfloat/multilingual-e5-small", "614241f622f53c4eeff9890bdc4f31cfecc418b3", "passage", "passage: "),
    ("intfloat/multilingual-e5-small", "614241f622f53c4eeff9890bdc4f31cfecc418b3", "query", "query: "),
]


def main() -> None:
    torch.set_num_threads(4)
    cases = []
    for model_id, revision, kind, prefix in MODELS:
        model = SentenceTransformer(model_id, revision=revision, device="cpu")
        texts = [prefix + s for s in SENTENCES]
        vectors = model.encode(texts, batch_size=8, convert_to_numpy=True)
        cases.append(
            {
                "model": model_id,
                "revision": revision,
                "kind": kind,
                "max_seq_length": model.max_seq_length,
                "embeddings": [[round(float(x), 8) for x in v] for v in vectors],
            }
        )
    out = {
        "produced_by": {
            "script": "tests/fixtures/generate_reference.py",
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
    path = Path(__file__).with_name("reference.json")
    path.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {path} ({len(cases)} cases)")


if __name__ == "__main__":
    main()

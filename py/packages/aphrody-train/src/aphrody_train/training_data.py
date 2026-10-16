# SPDX-License-Identifier: Apache-2.0
"""Validated JSONL triples shared by the embedding and reranking trainers."""

import json
from pathlib import Path


def load_triples(path: str) -> list[dict[str, str]]:
    """Load and validate query/positive/negative triples from a JSONL file."""
    source = Path(path)
    if not source.is_file():
        raise ValueError(f"triples file does not exist: {source}")

    triples = []
    with source.open(encoding="utf-8") as stream:
        for line_number, raw in enumerate(stream, 1):
            if not raw.strip():
                continue
            try:
                row = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"invalid JSON at {source}:{line_number}: {exc}"
                ) from exc
            query = row.get("query") or row.get("anchor")
            positive = row.get("positive")
            negative = row.get("negative")
            if (
                not isinstance(query, str)
                or not query.strip()
                or not isinstance(positive, str)
                or not positive.strip()
                or not isinstance(negative, str)
                or not negative.strip()
            ):
                raise ValueError(
                    f"{source}:{line_number} must contain nonempty query, positive and negative strings"
                )
            triples.append(
                {
                    "query": query.strip(),
                    "positive": positive.strip(),
                    "negative": negative.strip(),
                }
            )
    if not triples:
        raise ValueError(f"triples file contains no valid training rows: {source}")
    return triples

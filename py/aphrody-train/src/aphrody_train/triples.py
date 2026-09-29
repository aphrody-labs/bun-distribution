# SPDX-License-Identifier: Apache-2.0
"""Dataset triples generator with gold-leak guard."""

import hashlib
import json
import os
import re

import click

from .protocol import TrainEmitter


def load_gold_queries_and_urls(gold_path: str) -> tuple[set[str], set[str]]:
    """Load query strings and expected URLs from the gold evaluation set."""
    queries = set()
    urls = set()
    if not os.path.isfile(gold_path):
        raise ValueError(f"gold evaluation file does not exist: {gold_path}")

    with open(gold_path, encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
                for key, target in (
                    ("query", queries),
                    ("q", queries),
                    ("expected_url", urls),
                    ("expectUrl", urls),
                    ("expectTitle", urls),
                    ("expect", urls),
                ):
                    value = item.get(key)
                    if isinstance(value, str) and value.strip():
                        target.add(value.strip().lower())
                    elif isinstance(value, list):
                        target.update(
                            val.strip().lower()
                            for val in value
                            if isinstance(val, str) and val.strip()
                        )
            except Exception:
                pass
    return queries, urls


def is_gold_leak(
    query: str, positive: str, gold_queries: set[str], gold_urls: set[str]
) -> bool:
    """Check whether a query or positive passage leaks into the gold test set."""
    q_lower = query.strip().lower()
    for gq in gold_queries:
        if gq and (q_lower == gq or (len(gq) >= 10 and gq in q_lower)):
            return True

    pos_lower = positive.strip().lower()
    for gq in gold_queries:
        if len(gq) > 8 and gq in pos_lower:
            return True

    return any(u and u in pos_lower for u in gold_urls)


def generate_triples(
    chunks: list[dict],
    gold_path: str = "",
    emitter: TrainEmitter = None,
) -> tuple[list[dict], int]:
    """Generate training triples from chunks while enforcing the gold-leak guard."""
    gold_queries, gold_urls = (
        load_gold_queries_and_urls(gold_path) if gold_path else (set(), set())
    )

    triples = []
    leak_count = 0
    total = len(chunks)

    if len(chunks) < 2:
        raise ValueError(
            "at least two source chunks are required for distinct negatives"
        )

    for idx, chunk in enumerate(chunks):
        text = chunk.get("text", "")
        if len(text.strip()) < 30:
            continue

        # Extract title or first sentence as query basis
        sentences = re.split(r"[.!?\n]", text)
        query = sentences[0].strip() if sentences else text[:60].strip()
        if len(query) < 10:
            query = f"Search for: {text[:40].strip()}"

        positive = text

        # Select a negative from a different chunk.
        neg_idx = (idx + max(1, len(chunks) // 2)) % len(chunks)
        negative = chunks[neg_idx].get("text", "")
        if (
            not isinstance(negative, str)
            or not negative.strip()
            or negative == positive
        ):
            continue

        # Gold-leak guard check
        chunk_url = chunk.get("url", "").strip().lower()
        if (
            chunk_url
            and any(u and (u in chunk_url or chunk_url in u) for u in gold_urls)
        ) or is_gold_leak(query, positive, gold_queries, gold_urls):
            leak_count += 1
            continue

        triple = {
            "query": query,
            "positive": positive,
            "negative": negative,
            "chunk_id": chunk.get("id", f"c_{idx}"),
        }
        triples.append(triple)

        if emitter and (idx + 1) % 10 == 0:
            emitter.progress(step=idx + 1, total_steps=total, loss=0.0)

    if not triples:
        raise ValueError(
            "no triples remain after validation and gold-leak filtering"
        )
    return triples, leak_count


@click.command()
@click.option("--job-id", default="job-triples", help="Job identifier")
@click.option("--input-chunks", required=True, help="Input chunks JSONL path")
@click.option(
    "--output-triples", required=True, help="Output triples JSONL path"
)
@click.option(
    "--gold-file", default="", help="Path to gold eval JSONL for leakage check"
)
def main(job_id: str, input_chunks: str, output_triples: str, gold_file: str):
    """Generate training triples from chunks, discarding gold-set leaks."""
    emitter = TrainEmitter(job_id)
    emitter.start(
        "dataset_triples",
        total_steps=0,
        metadata={"gold_file": gold_file},
    )
    try:
        if not os.path.isfile(input_chunks):
            raise ValueError(
                f"source chunks file does not exist: {input_chunks}"
            )
        chunks = []
        with open(input_chunks, encoding="utf-8") as f:
            for line_number, line in enumerate(f, 1):
                if line.strip():
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError as exc:
                        raise ValueError(
                            f"invalid JSON at {input_chunks}:{line_number}: {exc}"
                        ) from exc
                    if not isinstance(chunk, dict):
                        raise ValueError(
                            f"{input_chunks}:{line_number} requires a dictionary"
                        )
                    text_val = chunk.get("text") or chunk.get("markdown") or chunk.get("content")
                    if not isinstance(text_val, str):
                        raise ValueError(
                            f"{input_chunks}:{line_number} requires a text string"
                        )
                    chunk_norm = dict(chunk)
                    chunk_norm["text"] = text_val
                    chunks.append(chunk_norm)
        triples, leaks = generate_triples(chunks, gold_file, emitter)
    except Exception as exc:
        emitter.error(str(exc))
        raise click.ClickException(str(exc)) from exc

    os.makedirs(os.path.dirname(output_triples) or ".", exist_ok=True)
    with open(output_triples, "w", encoding="utf-8") as f:
        for t in triples:
            f.write(json.dumps(t) + "\n")

    # Compute sha256 of generated triples
    hasher = hashlib.sha256()
    with open(output_triples, "rb") as f:
        hasher.update(f.read())
    sha = hasher.hexdigest()
    size = os.path.getsize(output_triples)

    emitter.artifact("triples", output_triples, sha, size)
    emitter.done(
        summary=f"Generated {len(triples)} triples; filtered {leaks} gold-leaks."
    )


if __name__ == "__main__":
    main()

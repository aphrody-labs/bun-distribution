# SPDX-License-Identifier: Apache-2.0
"""Canonical text hashing shared by training rows, gold rows and leak gates.

The canonical form is: Unicode NFC, optional ``str.casefold`` (followed by NFC
again, because case folding can produce decomposed text), every run of Unicode
whitespace collapsed to one ASCII space, leading and trailing whitespace
removed. The digest is the lowercase hex SHA-256 of the UTF-8 bytes.

``text_sha256`` in emitted JSONL is computed without casefolding, so the
registry can reproduce it as ``sha256(convert_to(normalize(..., NFC)))`` after
collapsing whitespace. The in-memory leak gates also casefold, which only makes
them stricter.
"""

import hashlib
import json
import re
import unicodedata
from collections.abc import Iterable, Iterator
from pathlib import Path

import click

from .protocol import TrainEmitter

URL_PATTERN = re.compile(r"https?://[^\s<>\"'`)\]}]+", re.IGNORECASE)
# Segment boundaries for exact-hash matching of embedded sentences or lines.
SEGMENT_SPLIT = re.compile(r"[.!?;:\n\r。！？]+")
SEGMENT_STRIP = " \t\"'`«»“”‘’()[]{}<>,-–—*#_|.!?;:…。！？"
# Shorter segments match too many unrelated rows to be a useful gold signal.
MIN_SEGMENT_CHARS = 12


def normalize_text(text: str, *, casefold: bool = False) -> str:
    """Return the canonical form of ``text`` used for every content hash."""
    value = unicodedata.normalize("NFC", text)
    if casefold:
        value = unicodedata.normalize("NFC", value.casefold())
    return " ".join(value.split())


def text_sha256(text: str, *, casefold: bool = False) -> str:
    """Return the hex SHA-256 of the canonical form of ``text``."""
    canonical = normalize_text(text, casefold=casefold)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def normalize_url(url: str) -> str:
    """Canonical URL key: casefolded text without fragment or trailing slash."""
    value = normalize_text(url, casefold=True)
    value = value.split("#", 1)[0]
    return value.rstrip("/")


def url_sha256(url: str) -> str:
    """Return the hex SHA-256 of a canonical URL key."""
    return hashlib.sha256(normalize_url(url).encode("utf-8")).hexdigest()


def find_urls(text: str) -> list[str]:
    """Return the http(s) URLs embedded in ``text``."""
    return [match.rstrip(".,;:!?") for match in URL_PATTERN.findall(text)]


def _segment_key(text: str) -> str:
    return normalize_text(text, casefold=True).strip(SEGMENT_STRIP)


def segments(text: str) -> Iterator[str]:
    """Yield the whole text and its sentence/line segments, casefold-normalised.

    Every value is trimmed of surrounding quotes and punctuation, so a gold
    query quoted or embedded as one sentence of a longer text produces the
    same key as the gold query itself.
    """
    whole = _segment_key(text)
    if whole:
        yield whole
    for part in SEGMENT_SPLIT.split(text):
        value = _segment_key(part)
        if len(value) >= MIN_SEGMENT_CHARS and value != whole:
            yield value


def segment_hashes(text: str) -> set[str]:
    """Return SHA-256 keys for the whole text and each of its segments."""
    return {
        hashlib.sha256(value.encode("utf-8")).hexdigest() for value in segments(text)
    }


def iter_strings(value) -> Iterable[str]:
    """Yield every string nested in a JSON-like value, keys excluded."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from iter_strings(item)
    elif isinstance(value, list | tuple):
        for item in value:
            yield from iter_strings(item)


GOLD_QUERY_KEYS = ("query", "q")
GOLD_TARGET_KEYS = ("expected_url", "expectUrl", "expectTitle", "expect")


def gold_values(row: dict, keys: tuple[str, ...]) -> list[str]:
    """Return the nonempty string values of ``keys`` in a gold row."""
    values = []
    for key in keys:
        value = row.get(key)
        if isinstance(value, str) and value.strip():
            values.append(value.strip())
        elif isinstance(value, list):
            values.extend(
                item.strip() for item in value if isinstance(item, str) and item.strip()
            )
    return values


def hash_gold_row(row: dict) -> dict:
    """Return a gold row with additive ``text_sha256`` and target hashes."""
    queries = gold_values(row, GOLD_QUERY_KEYS)
    targets = gold_values(row, GOLD_TARGET_KEYS)
    hashed = dict(row)
    if queries:
        hashed["text_sha256"] = text_sha256(queries[0])
        hashed["text_casefold_sha256"] = text_sha256(queries[0], casefold=True)
    if targets:
        hashed["target_sha256"] = [
            url_sha256(value) if URL_PATTERN.match(value) else text_sha256(value)
            for value in targets
        ]
    return hashed


@click.group()
def main() -> None:
    """Content-hash helpers for training and gold JSONL."""


@main.command("gold")
@click.option("--job-id", default="hash-gold")
@click.option(
    "--gold-file",
    required=True,
    type=click.Path(exists=True, dir_okay=False, path_type=Path),
)
@click.option("--output", required=True, type=click.Path(path_type=Path))
def gold(job_id: str, gold_file: Path, output: Path) -> None:
    """Write a copy of a gold JSONL with additive ``text_sha256`` fields."""
    emitter = TrainEmitter(job_id)
    emitter.start("hash_gold", 0, {"gold_file": str(gold_file)})
    try:
        rows = []
        with gold_file.open(encoding="utf-8") as stream:
            for number, raw in enumerate(stream, 1):
                if not raw.strip():
                    continue
                try:
                    row = json.loads(raw)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"invalid gold JSON at line {number}") from exc
                if not isinstance(row, dict):
                    raise ValueError(f"invalid gold record at line {number}")
                rows.append(hash_gold_row(row))
        if not rows:
            raise ValueError("gold file has no records")
        output.parent.mkdir(parents=True, exist_ok=True)
        payload = "".join(
            json.dumps(row, ensure_ascii=False) + "\n" for row in rows
        ).encode("utf-8")
        output.write_bytes(payload)
    except Exception as exc:
        emitter.error(str(exc))
        raise click.ClickException(str(exc)) from exc
    emitter.artifact(
        "gold_hashes",
        str(output),
        hashlib.sha256(payload).hexdigest(),
        len(payload),
    )
    emitter.done(f"Hashed {len(rows)} gold rows", stats={"gold_rows": len(rows)})


if __name__ == "__main__":
    main()

# SPDX-License-Identifier: Apache-2.0
"""Gold-leak anti-join, MinHash near-duplicate clustering and split assignment.

The leak gate is an exact anti-join on content hashes held in memory: a row
leaks when one of its keys is also a gold key. Keys are the casefolded
canonical hashes of every string in the row, of each sentence or line in those
strings (see :func:`aphrody_train.hashing.segments`), and of every URL. The
former substring heuristic remains available as an explicit opt-in.
"""

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .hashing import (
    GOLD_QUERY_KEYS,
    GOLD_TARGET_KEYS,
    URL_PATTERN,
    find_urls,
    gold_values,
    iter_strings,
    normalize_text,
    normalize_url,
    segment_hashes,
)

DEFAULT_NEAR_DUP_THRESHOLD = 0.8
DEFAULT_NUM_PERM = 128
DEFAULT_SHINGLE_SIZE = 5
DEFAULT_MINHASH_SEED = 1


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def url_keys(url: str) -> set[str]:
    """Hash keys for a URL: the canonical URL and, if not trivial, its path.

    A relative gold target such as ``/wiki/page`` matches any row URL with the
    same path; this is deliberately conservative.
    """
    canonical = normalize_url(url)
    keys = {_sha256(canonical)}
    path = canonical
    if "://" in canonical:
        parts = urlsplit(canonical)
        path = parts.path + (f"?{parts.query}" if parts.query else "")
    path = path.rstrip("/")
    if path.startswith("/") and len(path) > 1:
        keys.add(_sha256("path:" + path))
    return keys


class NearDupUnavailableError(RuntimeError):
    """Raised when MinHash clustering is requested but datasketch is missing."""


@dataclass
class GoldIndex:
    """Hash sets of a gold evaluation file for the in-memory anti-join."""

    text_keys: set[str] = field(default_factory=set)
    url_hashes: set[str] = field(default_factory=set)
    queries: set[str] = field(default_factory=set)
    urls: set[str] = field(default_factory=set)
    rows: int = 0
    legacy_substring: bool = False

    @classmethod
    def from_values(
        cls,
        queries: Iterable[str],
        targets: Iterable[str],
        *,
        legacy_substring: bool = False,
    ) -> "GoldIndex":
        """Build the index from gold query strings and target URLs/titles."""
        index = cls(legacy_substring=legacy_substring)
        for query in queries:
            index.add_query(query)
        for target in targets:
            index.add_target(target)
        return index

    @classmethod
    def from_file(
        cls,
        path: str | Path,
        *,
        require_entries: bool = True,
        legacy_substring: bool = False,
    ) -> "GoldIndex":
        """Read a gold JSONL strictly; malformed lines disable the export."""
        source = Path(path)
        if not source.is_file():
            raise ValueError(f"gold evaluation file does not exist: {source}")
        index = cls(legacy_substring=legacy_substring)
        with source.open(encoding="utf-8") as stream:
            for number, raw in enumerate(stream, 1):
                if not raw.strip():
                    continue
                try:
                    row = json.loads(raw)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"invalid gold JSON at line {number}") from exc
                if not isinstance(row, dict):
                    raise ValueError(f"invalid gold record at line {number}")
                index.rows += 1
                for query in gold_values(row, GOLD_QUERY_KEYS):
                    index.add_query(query)
                for target in gold_values(row, GOLD_TARGET_KEYS):
                    index.add_target(target)
        if require_entries and index.is_empty():
            raise ValueError("gold file has no queries or expected URLs")
        return index

    def add_query(self, query: str) -> None:
        """Index one gold query."""
        if not query.strip():
            return
        self.queries.add(query.strip().lower())
        self.text_keys |= segment_hashes(query)

    def add_target(self, target: str) -> None:
        """Index one gold target: a URL, a relative path or a title."""
        value = target.strip()
        if not value:
            return
        self.urls.add(value.lower())
        if URL_PATTERN.match(value) or value.startswith("/"):
            self.url_hashes |= url_keys(value)
        else:
            self.text_keys |= segment_hashes(value)

    def is_empty(self) -> bool:
        """Return whether the index holds no gold key at all."""
        return not self.text_keys and not self.url_hashes

    def match(self, texts: Iterable[str], urls: Iterable[str] = ()) -> str | None:
        """Return the matched key kind (``text``, ``url``, ``substring``) or None."""
        if self.is_empty():
            return None
        texts = [text for text in texts if isinstance(text, str)]
        all_urls = [url for url in urls if isinstance(url, str) and url.strip()]
        for text in texts:
            if segment_hashes(text) & self.text_keys:
                return "text"
            all_urls.extend(find_urls(text))
        for url in all_urls:
            if url_keys(url) & self.url_hashes:
                return "url"
        if self.legacy_substring and self._substring_leak(texts, all_urls):
            return "substring"
        return None

    def match_row(self, row) -> str | None:
        """Anti-join every string nested in a JSON-like row."""
        return self.match(list(iter_strings(row)))

    def _substring_leak(self, texts: list[str], urls: list[str]) -> bool:
        """The pre-hash heuristic: gold strings contained in row text."""
        haystack = "\n".join(texts).lower()
        lowered_urls = [url.strip().lower() for url in urls]
        for query in self.queries:
            if len(query) >= 10 and query in haystack:
                return True
        for url in self.urls:
            if url and url in haystack:
                return True
            if any(url and (url in row or row in url) for row in lowered_urls):
                return True
        return False


def shingles(text: str, size: int = DEFAULT_SHINGLE_SIZE) -> set[str]:
    """Word n-gram shingles of the casefolded canonical text."""
    words = normalize_text(text, casefold=True).split(" ")
    if len(words) <= size:
        return {" ".join(words)}
    return {" ".join(words[i : i + size]) for i in range(len(words) - size + 1)}


def near_duplicate_clusters(
    texts: list[str],
    *,
    threshold: float = DEFAULT_NEAR_DUP_THRESHOLD,
    num_perm: int = DEFAULT_NUM_PERM,
    shingle_size: int = DEFAULT_SHINGLE_SIZE,
    seed: int = DEFAULT_MINHASH_SEED,
) -> list[int]:
    """Cluster near-duplicate texts with MinHash LSH (datasketch).

    Returns, for each text, the index of its cluster representative: the
    lowest input index in the connected component of pairs whose estimated
    Jaccard similarity is at least ``threshold``. The result depends only on
    the texts, their order and the parameters.
    """
    if not 0.0 < threshold <= 1.0:
        raise ValueError("near-duplicate threshold must be in (0, 1]")
    if num_perm < 16:
        raise ValueError("MinHash needs at least 16 permutations")
    try:
        from datasketch import MinHash, MinHashLSH
    except ImportError as exc:
        raise NearDupUnavailableError(
            "MinHash clustering needs datasketch; run uv sync --package "
            f"aphrody-train --extra dedup; underlying error: {exc}"
        ) from exc

    parent = list(range(len(texts)))

    def find(item: int) -> int:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item

    def union(left: int, right: int) -> None:
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            low, high = sorted((root_left, root_right))
            parent[high] = low

    try:
        lsh = MinHashLSH(threshold=threshold, num_perm=num_perm)
    except ValueError as exc:
        raise ValueError(
            f"MinHash LSH cannot band {num_perm} permutations at threshold "
            f"{threshold}; lower the threshold or raise the permutations: {exc}"
        ) from exc
    signatures: list[Any] = []
    for index, text in enumerate(texts):
        signature = MinHash(num_perm=num_perm, seed=seed)
        signature.update_batch(
            [value.encode("utf-8") for value in sorted(shingles(text, shingle_size))]
        )
        for key in lsh.query(signature):
            other = int(key)
            if signature.jaccard(signatures[other]) >= threshold:
                union(index, other)
        lsh.insert(str(index), signature)
        signatures.append(signature)
    return [find(index) for index in range(len(texts))]


def assign_split(cluster_key: str, val_fraction: float, seed: str) -> str:
    """Deterministically assign a whole cluster to ``train`` or ``val``."""
    if not 0.0 <= val_fraction < 1.0:
        raise ValueError("validation fraction must be in [0, 1)")
    if val_fraction == 0.0:
        return "train"
    digest = hashlib.sha256(f"{seed}\0{cluster_key}".encode()).digest()
    position = int.from_bytes(digest[:8], "big") / 2**64
    return "val" if position < val_fraction else "train"

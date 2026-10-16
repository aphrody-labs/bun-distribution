# SPDX-License-Identifier: Apache-2.0
"""Hard-negative mining and reranker scoring for training triples.

Mining uses ``sentence_transformers.util.mine_hard_negatives`` (verified
against sentence-transformers 5.7.0 and 6.1.0, which share the signature) with
positive-aware settings from NV-Retriever: ``range_max=50``,
``max_score=0.8``, ``relative_margin=0.05``, ``sampling_strategy="top"``.
Candidates from the same source document or near-duplicate cluster as the
positive are removed afterwards, because the library cannot exclude per row.
"""

import contextlib
import functools
import sys
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal, cast

DEFAULT_MINER_MODEL = "intfloat/multilingual-e5-small"


class MiningUnavailableError(RuntimeError):
    """Raised when mining dependencies or the miner model cannot be used."""


@dataclass(frozen=True)
class MiningConfig:
    """Parameters forwarded to ``mine_hard_negatives``."""

    model: str = DEFAULT_MINER_MODEL
    range_min: int = 0
    range_max: int = 50
    max_score: float | None = 0.8
    relative_margin: float | None = 0.05
    sampling_strategy: str = "top"
    # Candidates requested per query before same-document filtering.
    pool: int = 8
    batch_size: int = 32
    device: str | None = None

    def prompts(self) -> tuple[str | None, str | None]:
        """E5 models need ``query: `` and ``passage: `` prefixes."""
        if "e5" in self.model.lower():
            return "query: ", "passage: "
        return None, None

    def as_metadata(self) -> dict:
        """Mining parameters for event metadata and dataset lineage."""
        query_prompt, corpus_prompt = self.prompts()
        return {
            "miner_model": self.model,
            "range_min": self.range_min,
            "range_max": self.range_max,
            "max_score": self.max_score,
            "relative_margin": self.relative_margin,
            "sampling_strategy": self.sampling_strategy,
            "pool": self.pool,
            "query_prompt": query_prompt,
            "corpus_prompt": corpus_prompt,
        }


@functools.lru_cache(maxsize=2)
def _bi_encoder(model: str, device: str | None):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model, device=device)


Candidates = list[tuple[str, float]]
Miner = Callable[[list[tuple[str, str]], list[str], MiningConfig], list[Candidates]]


def mine_candidates(
    pairs: list[tuple[str, str]], corpus: list[str], config: MiningConfig
) -> list[Candidates]:
    """Return ranked ``(text, score)`` negative candidates per (query, positive).

    Library output is printed to stdout, which carries the JSONL protocol, so it
    is redirected to stderr while mining runs.
    """
    if config.pool < 1:
        raise ValueError("mining pool must be at least 1")
    if config.range_max - config.range_min < 1:
        raise ValueError("mining range_max must exceed range_min")
    try:
        from datasets import Dataset
        from sentence_transformers.util import mine_hard_negatives
    except ImportError as exc:
        raise MiningUnavailableError(
            "hard-negative mining needs sentence-transformers and datasets "
            f"(--extra mine or --extra full); underlying error: {exc}"
        ) from exc
    with contextlib.redirect_stdout(sys.stderr):
        try:
            model = _bi_encoder(config.model, config.device)
        except Exception as exc:
            raise MiningUnavailableError(
                f"miner model {config.model!r} could not be loaded: {exc}"
            ) from exc
        query_prompt, corpus_prompt = config.prompts()
        dataset = Dataset.from_dict(
            {
                "anchor": [query for query, _ in pairs],
                "positive": [positive for _, positive in pairs],
            }
        )
        mined = mine_hard_negatives(
            dataset,
            model,
            anchor_column_name="anchor",
            positive_column_name="positive",
            corpus=list(corpus),
            range_min=config.range_min,
            range_max=config.range_max,
            max_score=config.max_score,
            relative_margin=config.relative_margin,
            num_negatives=min(config.pool, config.range_max - config.range_min),
            sampling_strategy=cast(Literal["random", "top"], config.sampling_strategy),
            query_prompt=query_prompt,
            corpus_prompt=corpus_prompt,
            output_format="triplet",
            output_scores=True,
            batch_size=config.batch_size,
            verbose=False,
        )
    found: dict[tuple[str, str], Candidates] = defaultdict(list)
    for row in mined:
        found[(row["anchor"], row["positive"])].append(
            (row["negative"], float(row["scores"][1]))
        )
    return [found.get(pair, []) for pair in pairs]


def choose(
    candidates: Candidates,
    excluded: Callable[[str], bool],
    limit: int,
) -> Candidates:
    """Keep the first ``limit`` candidates that are not excluded, in rank order."""
    chosen: Candidates = []
    seen = set()
    for text, score in candidates:
        if text in seen or excluded(text):
            continue
        seen.add(text)
        chosen.append((text, score))
        if len(chosen) >= limit:
            break
    return chosen


def positional(count: int, excluded: Callable[[int, int], bool]) -> list[int | None]:
    """The original positional negative ``(idx + n/2) % n``.

    When that candidate is excluded (same document, same cluster or identical
    text), the next position is tried; ``None`` means no candidate remains.
    """
    offset = max(1, count // 2)
    result: list[int | None] = []
    for index in range(count):
        choice = None
        for step in range(count - 1):
            candidate = (index + offset + step) % count
            if candidate != index and not excluded(index, candidate):
                choice = candidate
                break
        result.append(choice)
    return result


class RerankerScorer:
    """Cross-encoder scores for FlagEmbedding-style reranker JSONL."""

    def __init__(self, model: str, device: str | None = None, batch_size: int = 32):
        try:
            from sentence_transformers import CrossEncoder
        except ImportError as exc:
            raise MiningUnavailableError(
                "reranker scoring needs sentence-transformers "
                f"(--extra mine or --extra full); underlying error: {exc}"
            ) from exc
        with contextlib.redirect_stdout(sys.stderr):
            try:
                self._model = CrossEncoder(model, device=device)
            except Exception as exc:
                raise MiningUnavailableError(
                    f"reranker model {model!r} could not be loaded: {exc}"
                ) from exc
        self.model = model
        self._batch_size = batch_size

    def score(self, pairs: Sequence[tuple[str, str]]) -> list[float]:
        """Return one relevance score per (query, passage) pair."""
        if not pairs:
            return []
        with contextlib.redirect_stdout(sys.stderr):
            scores = self._model.predict(
                list(pairs),
                batch_size=self._batch_size,
                show_progress_bar=False,
            )
        return [float(value) for value in list(scores)]

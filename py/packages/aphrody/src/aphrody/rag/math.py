# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""RAG math adapters. All calculations belong to aphrody-rag-core.

The historical py_* names remain import-compatible aliases. A matching native
wheel is required; a missing extension never selects a divergent Python kernel.
"""

from __future__ import annotations

try:
    from aphrody.aphrody_rust import (
        cosine_similarity as rust_cosine_similarity,
    )
    from aphrody.aphrody_rust import (
        reciprocal_rank_fusion as rust_reciprocal_rank_fusion,
    )
    from aphrody.aphrody_rust import (
        top_k_cosine_similarity as rust_top_k_cosine_similarity,
    )

    HAS_RUST = True
except ImportError:
    HAS_RUST = False


def _require_native() -> None:
    if not HAS_RUST:
        raise ImportError(
            "RAG math requires the aphrody native wheel built from aphrody-rag-core"
        )


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    """Calculate cosine similarity through the canonical native core."""
    _require_native()
    return rust_cosine_similarity(v1, v2)


def top_k_cosine_similarity(
    query: list[float],
    embeddings: list[list[float]],
    k: int,
) -> list[tuple[int, float]]:
    """Return top-K through the canonical native core adapter."""
    _require_native()
    return rust_top_k_cosine_similarity(query, embeddings, k)


def reciprocal_rank_fusion(
    rankings: list[list[int]],
    k: float = 60.0,
) -> list[tuple[int, float]]:
    """Fuse ranks with the core's one-based rank contribution."""
    _require_native()
    return rust_reciprocal_rank_fusion(rankings, k)


# Public compatibility names; these no longer implement separate calculations.
py_cosine_similarity = cosine_similarity
py_top_k_cosine_similarity = top_k_cosine_similarity
py_reciprocal_rank_fusion = reciprocal_rank_fusion

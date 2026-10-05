# SPDX-License-Identifier: Apache-2.0
"""Core math contract without importing optional graph/model providers."""

import importlib.util
from pathlib import Path

import pytest

import aphrody

spec = importlib.util.spec_from_file_location(
    "rag_core_adapter", Path(aphrody.__file__).parent / "rag/math.py"
)
assert spec and spec.loader
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


@pytest.mark.parametrize(
    "rankings,k,expected",
    [
        ([], 60.0, []),
        ([[]], 0.0, []),
        ([[7]], 60.0, [(7, 1 / 61)]),
        ([[2, 2], [3]], 0.0, [(2, 1.5), (3, 1.0)]),
        ([[2], [3]], 60.0, [(2, 1 / 61), (3, 1 / 61)]),
    ],
)
def test_rrf_core_contract(rankings, k, expected):
    actual = adapter.reciprocal_rank_fusion(rankings, k)
    assert [item for item, _ in actual] == [item for item, _ in expected]
    assert [score for _, score in actual] == pytest.approx(
        [score for _, score in expected]
    )
    assert adapter.py_reciprocal_rank_fusion is adapter.reciprocal_rank_fusion


def test_missing_extension_is_explicit(monkeypatch):
    monkeypatch.setattr(adapter, "HAS_RUST", False)
    with pytest.raises(ImportError, match="native wheel"):
        adapter.reciprocal_rank_fusion([[1]])


def test_vectors_and_native_errors():
    assert adapter.cosine_similarity([0, 0], [0, 0]) == 0
    assert adapter.top_k_cosine_similarity([1, 0], [[0, 1], [1, 0], [1]], 2) == [
        (1, 1.0),
        (0, 0.0),
    ]
    with pytest.raises(ValueError):
        adapter.cosine_similarity([], [])

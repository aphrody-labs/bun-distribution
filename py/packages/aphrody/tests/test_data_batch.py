# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Tests for Polars and Apache Arrow zero-copy data batching architecture."""

from __future__ import annotations

import math
import sys
from typing import Any
from unittest.mock import patch

import numpy as np
import pytest
from pydantic import ValidationError

from aphrody import (
    DataBatch,
    VectorBatch,
    analyze_batch,
    analyze_vector_batch,
)


def test_data_batch_pydantic_validation() -> None:
    """Verify DataBatch model validation with Pydantic V2."""
    batch = DataBatch(batch_name="test-batch", values=[1.5, 2.5, 3.5])
    assert batch.batch_name == "test-batch"
    assert batch.values == [1.5, 2.5, 3.5]
    assert len(batch) == 3
    assert batch[1] == 2.5
    assert list(batch) == [1.5, 2.5, 3.5]

    # Acceptance of numpy array
    np_arr = np.array([10.0, 20.0, 30.0], dtype=np.float64)
    batch_from_np = DataBatch(batch_name="from-np", values=np_arr)
    assert batch_from_np.values == [10.0, 20.0, 30.0]

    # Default values and metadata
    empty_batch = DataBatch()
    assert empty_batch.batch_name == "batch"
    assert empty_batch.values == []
    assert empty_batch.metadata == {}

    # Invalid input validation
    with pytest.raises(ValidationError):
        DataBatch(values=["invalid_string_val"])  # type: ignore[arg-type]


def test_vector_batch_pydantic_validation() -> None:
    """Verify VectorBatch model validation with Pydantic V2."""
    vecs = [[1.0, 2.0], [3.0, 4.0]]
    vb = VectorBatch(
        batch_name="vec-test",
        vectors=vecs,
        labels=["row0", "row1"],
        metadata={"source": "unit-test"},
    )
    assert vb.batch_name == "vec-test"
    assert vb.count == 2
    assert vb.dim == 2
    assert vb.shape == (2, 2)
    assert vb.labels == ["row0", "row1"]
    assert vb.metadata["source"] == "unit-test"
    assert vb[0] == [1.0, 2.0]
    assert list(vb) == vecs

    # From 2D numpy array
    np_vecs = np.array([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]])
    vb_np = VectorBatch(vectors=np_vecs)
    assert vb_np.count == 2
    assert vb_np.dim == 3

    # From 1D numpy array (treated as single vector row)
    vb_1d = VectorBatch(vectors=np.array([1.0, 2.0, 3.0]))
    assert vb_1d.count == 1
    assert vb_1d.dim == 3

    # Invalid 3D shape validation
    with pytest.raises(ValidationError):
        VectorBatch(vectors=np.ones((2, 2, 2)))  # type: ignore[arg-type]


def test_data_batch_to_polars_and_arrow() -> None:
    """Verify DataBatch zero-copy export to Arrow and Polars."""
    pa = pytest.importorskip("pyarrow", reason="requires pyarrow")
    pl = pytest.importorskip("polars", reason="requires polars")

    values = [1.0, 4.0, 9.0, 16.0]
    batch = DataBatch(batch_name="squares", values=values)

    # Arrow Table export
    arrow_tbl = batch.to_arrow()
    assert isinstance(arrow_tbl, pa.Table)
    assert arrow_tbl.num_rows == 4
    assert arrow_tbl.column_names == ["values"]
    assert arrow_tbl["values"].to_pylist() == values

    # Polars DataFrame export
    df = batch.to_polars()
    assert isinstance(df, pl.DataFrame)
    assert df.shape == (4, 1)
    assert df.columns == ["values"]
    assert df["values"].to_list() == values

    # Empty batch export
    empty_df = DataBatch().to_polars()
    assert isinstance(empty_df, pl.DataFrame)
    assert empty_df.shape == (0, 1)


def test_vector_batch_to_polars_and_arrow() -> None:
    """Verify VectorBatch export to Arrow and Polars in both list and column formats."""
    pa = pytest.importorskip("pyarrow", reason="requires pyarrow")
    pl = pytest.importorskip("polars", reason="requires polars")

    vecs = [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]
    labels = ["alpha", "beta"]
    vb = VectorBatch(batch_name="test-vecs", vectors=vecs, labels=labels)

    # Arrow Table export with list column
    arrow_tbl = vb.to_arrow(as_columns=False)
    assert isinstance(arrow_tbl, pa.Table)
    assert arrow_tbl.num_rows == 2
    assert arrow_tbl.column_names == ["label", "vector"]
    assert arrow_tbl["label"].to_pylist() == labels
    assert arrow_tbl["vector"].to_pylist() == vecs

    # Arrow Table export with per-dimension columns
    arrow_cols_tbl = vb.to_arrow(as_columns=True)
    assert arrow_cols_tbl.column_names == ["label", "dim_0", "dim_1", "dim_2"]
    assert arrow_cols_tbl["dim_0"].to_pylist() == [1.0, 4.0]
    assert arrow_cols_tbl["dim_1"].to_pylist() == [2.0, 5.0]
    assert arrow_cols_tbl["dim_2"].to_pylist() == [3.0, 6.0]

    # Polars DataFrame export with list column
    df = vb.to_polars(as_columns=False)
    assert isinstance(df, pl.DataFrame)
    assert df.columns == ["label", "vector"]
    assert df["label"].to_list() == labels
    assert df["vector"].to_list() == vecs

    # Polars DataFrame export with separate columns
    df_cols = vb.to_polars(as_columns=True)
    assert isinstance(df_cols, pl.DataFrame)
    assert df_cols.columns == ["label", "dim_0", "dim_1", "dim_2"]
    assert df_cols["dim_0"].to_list() == [1.0, 4.0]
    assert df_cols["dim_2"].to_list() == [3.0, 6.0]


def test_data_batch_statistics_rspyts_parity() -> None:
    """Verify parity with rspyts test_data_batch and analyze_batch behavior."""
    batch = DataBatch(batch_name="batch-01", values=[1.0, 2.0, 3.0])
    res = analyze_batch(batch)

    assert res["sum"] == pytest.approx(6.0)
    assert res["mean"] == pytest.approx(2.0)
    assert res["min"] == pytest.approx(1.0)
    assert res["max"] == pytest.approx(3.0)
    assert res["sum_sq"] == pytest.approx(14.0)
    assert res["count"] == pytest.approx(3.0)

    # Empty batch
    empty_res = analyze_batch(DataBatch())
    assert empty_res["sum"] == 0.0
    assert empty_res["mean"] == 0.0
    assert empty_res["min"] == 0.0
    assert empty_res["max"] == 0.0
    assert empty_res["sum_sq"] == 0.0
    assert empty_res["count"] == 0.0


def test_data_batch_vector_normalization() -> None:
    """Verify vector normalization on DataBatch (L2 norm = 1.0)."""
    batch = DataBatch(batch_name="to-norm", values=[1.0, 2.0, 2.0])
    normed = batch.normalize()

    expected = [1.0 / 3.0, 2.0 / 3.0, 2.0 / 3.0]
    for actual, exp in zip(normed.values, expected, strict=True):
        assert actual == pytest.approx(exp)

    # Norm of normalized vector is 1.0
    norm_len = math.sqrt(sum(x * x for x in normed.values))
    assert norm_len == pytest.approx(1.0)

    # Normalization of empty batch
    assert DataBatch().normalize().values == []

    # Normalization of zero vector
    zero_batch = DataBatch(values=[0.0, 0.0, 0.0])
    assert zero_batch.normalize().values == [0.0, 0.0, 0.0]


def test_vector_batch_statistics_and_native_kernels() -> None:
    """Verify VectorBatch statistics and integration with native rag kernels."""
    vecs = [
        [1.0, 2.0, 2.0],  # norm = 3.0
        [3.0, 4.0, 0.0],  # norm = 5.0
    ]
    vb = VectorBatch(batch_name="vbatch", vectors=vecs)

    # Sum
    assert vb.sum() == pytest.approx(12.0)
    assert vb.sum(axis=0) == [4.0, 6.0, 2.0]
    assert vb.sum(axis=1) == [5.0, 7.0]

    # Mean
    assert vb.mean() == pytest.approx(2.0)
    assert vb.mean(axis=0) == [
        pytest.approx(2.0),
        pytest.approx(3.0),
        pytest.approx(1.0),
    ]
    assert vb.mean(axis=1) == [pytest.approx(5.0 / 3.0), pytest.approx(7.0 / 3.0)]

    # Min and Max
    assert vb.min() == pytest.approx(0.0)
    assert vb.min(axis=0) == [1.0, 2.0, 0.0]
    assert vb.min(axis=1) == [1.0, 0.0]

    assert vb.max() == pytest.approx(4.0)
    assert vb.max(axis=0) == [3.0, 4.0, 2.0]
    assert vb.max(axis=1) == [2.0, 4.0]

    # Sum of squares
    # 1+4+4 = 9, 9+16+0 = 25 -> total 34
    assert vb.sum_squares() == pytest.approx(34.0)
    assert vb.sum_squares(axis=0) == [10.0, 20.0, 4.0]
    assert vb.sum_squares(axis=1) == [9.0, 25.0]

    # Normalization (interfacing with aphrody.rag.vectors)
    normed_vb = vb.normalize()
    assert normed_vb.vectors[0] == [
        pytest.approx(1.0 / 3.0),
        pytest.approx(2.0 / 3.0),
        pytest.approx(2.0 / 3.0),
    ]
    assert normed_vb.vectors[1] == [
        pytest.approx(0.6),
        pytest.approx(0.8),
        pytest.approx(0.0),
    ]

    # Cosine similarity matrix
    sims = vb.similarity_matrix()
    assert sims.shape == (2, 2)
    assert sims[0, 0] == pytest.approx(1.0)
    assert sims[1, 1] == pytest.approx(1.0)
    # Cosine sim between [1/3, 2/3, 2/3] and [0.6, 0.8, 0.0]
    # (1/3)*0.6 + (2/3)*0.8 + 0 = 0.2 + 0.53333333 = 0.73333333
    assert sims[0, 1] == pytest.approx(11.0 / 15.0)

    # analyze_vector_batch summary
    summary = analyze_vector_batch(vb)
    assert summary["count"] == 2.0
    assert summary["dim"] == 3.0
    assert summary["sum"] == pytest.approx(12.0)
    assert summary["sum_sq"] == pytest.approx(34.0)


def test_vector_batch_fallback_behavior() -> None:
    """Verify pure NumPy / Python fallbacks when native rag vector kernels are disabled."""
    vecs = [[1.0, 2.0, 2.0], [3.0, 4.0, 0.0]]
    vb = VectorBatch(batch_name="fallback-test", vectors=vecs)

    with patch.dict(sys.modules, {"aphrody.rag.vectors": None}):
        # Mean fallback
        mean_res = vb.mean(axis=0)
        assert mean_res == [pytest.approx(2.0), pytest.approx(3.0), pytest.approx(1.0)]

        # Normalization fallback
        normed = vb.normalize()
        assert normed.vectors[0] == [
            pytest.approx(1.0 / 3.0),
            pytest.approx(2.0 / 3.0),
            pytest.approx(2.0 / 3.0),
        ]
        assert normed.vectors[1] == [
            pytest.approx(0.6),
            pytest.approx(0.8),
            pytest.approx(0.0),
        ]


def test_optional_polars_error_handling(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify graceful handling and descriptive error if polars is missing."""
    import aphrody._optional as opt

    def fake_require_polars(purpose: str = "DataFrame export") -> Any:
        raise RuntimeError(
            f"polars is required for {purpose}; install the data extra: uv pip install 'aphrody[data]'"
        )

    monkeypatch.setattr(opt, "require_polars", fake_require_polars)
    monkeypatch.setattr("aphrody.data_batch.require_polars", fake_require_polars)

    batch = DataBatch(values=[1.0, 2.0])
    with pytest.raises(RuntimeError, match="polars is required"):
        batch.to_polars()

    vb = VectorBatch(vectors=[[1.0, 2.0]])
    with pytest.raises(RuntimeError, match="polars is required"):
        vb.to_polars()

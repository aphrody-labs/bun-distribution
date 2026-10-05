# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""High-performance Polars and Apache Arrow zero-copy data batching architecture.

Provides Pydantic V2 models for contiguous float data and vector embeddings,
integrating zero-copy Arrow memory exchange to Polars DataFrames and native Rust
accelerated vector arithmetic kernels with pure Python/NumPy fallbacks.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from aphrody._optional import require_polars, require_pyarrow

if TYPE_CHECKING:
    import polars as pl
    import pyarrow as pa

try:
    import numpy as np

    _HAS_NUMPY = True
except ImportError:  # pragma: no cover
    _HAS_NUMPY = False
    np = None  # type: ignore[assignment]

__all__ = [
    "DataBatch",
    "VectorBatch",
    "analyze_batch",
    "analyze_vector_batch",
]


class DataBatch(BaseModel):
    """Contiguous 1D floating-point data batch with Arrow and Polars zero-copy support."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    batch_name: str = Field(
        default="batch",
        description="Name or identifier of the sample data batch",
    )
    values: list[float] = Field(
        default_factory=list,
        description="Contiguous vector of float64 numeric values",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary user or system metadata associated with this batch",
    )

    @field_validator("values", mode="before")
    @classmethod
    def _validate_values(cls, v: Any) -> list[float]:
        if _HAS_NUMPY and isinstance(v, np.ndarray):
            return [float(x) for x in v.ravel().tolist()]
        if isinstance(v, (list, tuple)):
            return [float(x) for x in v]
        return v

    def __len__(self) -> int:
        return len(self.values)

    def __iter__(self):
        return iter(self.values)

    def __getitem__(self, index: int) -> float:
        return self.values[index]

    def to_numpy(self) -> np.ndarray:
        """Export values as a 1D C-contiguous float64 NumPy array."""
        if not _HAS_NUMPY:
            raise RuntimeError("NumPy is required to export to a NumPy array")
        return np.asarray(self.values, dtype=np.float64, order="C")

    def to_arrow(self) -> pa.Table:
        """Export the batch as an Apache Arrow Table with zero-copy buffer sharing."""
        pa = require_pyarrow("Arrow Table export")
        arr = pa.array(self.values, type=pa.float64())
        return pa.Table.from_arrays([arr], names=["values"])

    def to_polars(self) -> pl.DataFrame:
        """Export the batch to a Polars DataFrame with Apache Arrow zero-copy exchange."""
        pl = require_polars("DataFrame export")
        try:
            arrow_table = self.to_arrow()
            return pl.from_arrow(arrow_table)
        except Exception:
            return pl.DataFrame({"values": self.values})

    def sum(self) -> float:
        """Compute the sum of batch values."""
        if not self.values:
            return 0.0
        return float(sum(self.values))

    def mean(self) -> float:
        """Compute the arithmetic mean of batch values."""
        if not self.values:
            return 0.0
        return float(self.sum() / len(self.values))

    def min(self) -> float:
        """Compute the minimum value in the batch."""
        if not self.values:
            return 0.0
        return float(min(self.values))

    def max(self) -> float:
        """Compute the maximum value in the batch."""
        if not self.values:
            return 0.0
        return float(max(self.values))

    def sum_squares(self) -> float:
        """Compute the sum of squared values."""
        if not self.values:
            return 0.0
        return float(sum(x * x for x in self.values))

    def sum_of_squares(self) -> float:
        """Alias for sum_squares."""
        return self.sum_squares()

    def normalize(self) -> DataBatch:
        """Normalize values to a unit L2-norm vector.

        Uses native aphrody.rag.vectors kernel when available, with pure
        Python/NumPy fallback.
        """
        if not self.values:
            return DataBatch(
                batch_name=f"{self.batch_name}_normalized",
                values=[],
                metadata=dict(self.metadata),
            )

        # Try native rag-core kernel
        if _HAS_NUMPY:
            try:
                from aphrody.rag import vectors as rag_vectors

                arr = np.asarray([self.values], dtype="<f8", order="C")
                normed = rag_vectors.normalize(arr)
                return DataBatch(
                    batch_name=f"{self.batch_name}_normalized",
                    values=normed[0].tolist(),
                    metadata=dict(self.metadata),
                )
            except Exception:
                pass

        # Pure Python / NumPy fallback
        sq_sum = sum(x * x for x in self.values)
        if sq_sum <= 0.0:
            return DataBatch(
                batch_name=f"{self.batch_name}_normalized",
                values=[0.0 for _ in self.values],
                metadata=dict(self.metadata),
            )
        inv_norm = 1.0 / math.sqrt(sq_sum)
        return DataBatch(
            batch_name=f"{self.batch_name}_normalized",
            values=[float(x * inv_norm) for x in self.values],
            metadata=dict(self.metadata),
        )

    def summary(self) -> dict[str, float]:
        """Compute summary statistics for the batch."""
        if not self.values:
            return {
                "sum": 0.0,
                "mean": 0.0,
                "min": 0.0,
                "max": 0.0,
                "sum_sq": 0.0,
                "count": 0.0,
            }
        return {
            "sum": self.sum(),
            "mean": self.mean(),
            "min": self.min(),
            "max": self.max(),
            "sum_sq": self.sum_squares(),
            "count": float(len(self.values)),
        }


def analyze_batch(batch: DataBatch) -> dict[str, float]:
    """Analyze a DataBatch, computing summary statistics."""
    return batch.summary()


class VectorBatch(BaseModel):
    """2D vector embedding batch supporting zero-copy Polars / Arrow exchange and native acceleration."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    batch_name: str = Field(
        default="vector-batch",
        description="Name or identifier of the vector batch",
    )
    vectors: list[list[float]] = Field(
        default_factory=list,
        description="2D list of vector embeddings (rows of float64 values)",
    )
    labels: list[str] = Field(
        default_factory=list,
        description="Optional list of string identifiers or labels corresponding to each vector",
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Arbitrary user or system metadata associated with this vector batch",
    )

    @field_validator("vectors", mode="before")
    @classmethod
    def _validate_vectors(cls, v: Any) -> list[list[float]]:
        if _HAS_NUMPY and isinstance(v, np.ndarray):
            if v.ndim == 1:
                return [[float(x) for x in v]]
            elif v.ndim == 2:
                return [[float(x) for x in row] for row in v]
            else:
                raise ValueError("Vectors array must be 1D or 2D")
        if isinstance(v, (list, tuple)):
            result: list[list[float]] = []
            for item in v:
                if _HAS_NUMPY and isinstance(item, np.ndarray):
                    result.append([float(x) for x in item.ravel()])
                elif isinstance(item, (list, tuple)):
                    result.append([float(x) for x in item])
                elif isinstance(item, (int, float)):
                    result.append([float(item)])
                else:
                    result.append(list(item))
            return result
        return v

    @property
    def count(self) -> int:
        """Return the number of vectors in this batch."""
        return len(self.vectors)

    @property
    def dim(self) -> int:
        """Return the dimensionality of the vectors in this batch."""
        if not self.vectors:
            return 0
        return len(self.vectors[0])

    @property
    def shape(self) -> tuple[int, int]:
        """Return (count, dim) shape tuple."""
        return (self.count, self.dim)

    def __len__(self) -> int:
        return len(self.vectors)

    def __iter__(self):
        return iter(self.vectors)

    def __getitem__(self, index: int) -> list[float]:
        return self.vectors[index]

    def to_numpy(self) -> np.ndarray:
        """Export vectors as a 2D C-contiguous float64 NumPy array."""
        if not _HAS_NUMPY:
            raise RuntimeError("NumPy is required to export to a NumPy array")
        if not self.vectors:
            return np.empty((0, 0), dtype=np.float64)
        return np.asarray(self.vectors, dtype=np.float64, order="C")

    def to_arrow(self, as_columns: bool = False) -> pa.Table:
        """Export the vector batch as an Apache Arrow Table with zero-copy buffer sharing."""
        pa = require_pyarrow("Arrow Table export")
        if as_columns and self.vectors and self.dim > 0:
            arrays = []
            names = []
            if self.labels:
                arrays.append(pa.array(self.labels, type=pa.string()))
                names.append("label")
            for d in range(self.dim):
                col_vals = [row[d] for row in self.vectors]
                arrays.append(pa.array(col_vals, type=pa.float64()))
                names.append(f"dim_{d}")
            return pa.Table.from_arrays(arrays, names=names)
        else:
            arrays = []
            names = []
            if self.labels:
                arrays.append(pa.array(self.labels, type=pa.string()))
                names.append("label")
            if self.vectors:
                vec_arr = pa.array(self.vectors, type=pa.list_(pa.float64()))
            else:
                vec_arr = pa.array([], type=pa.list_(pa.float64()))
            arrays.append(vec_arr)
            names.append("vector")
            return pa.Table.from_arrays(arrays, names=names)

    def to_polars(self, as_columns: bool = False) -> pl.DataFrame:
        """Export the vector batch to a Polars DataFrame with Apache Arrow zero-copy exchange."""
        pl = require_polars("DataFrame export")
        try:
            arrow_table = self.to_arrow(as_columns=as_columns)
            return pl.from_arrow(arrow_table)
        except Exception:
            data: dict[str, Any] = {}
            if self.labels:
                data["label"] = self.labels
            if as_columns and self.vectors and self.dim > 0:
                for d in range(self.dim):
                    data[f"dim_{d}"] = [row[d] for row in self.vectors]
            else:
                data["vector"] = self.vectors
            return pl.DataFrame(data)

    def sum(self, axis: int | None = None) -> float | list[float]:
        """Compute the sum across all values, per dimension (axis=0), or per vector (axis=1)."""
        if not self.vectors or self.dim == 0:
            return 0.0 if axis is None else []

        if _HAS_NUMPY:
            arr = self.to_numpy()
            if axis is None:
                return float(arr.sum())
            return arr.sum(axis=axis).tolist()

        if axis is None:
            return float(sum(x for row in self.vectors for x in row))
        elif axis == 0:
            dim = self.dim
            sums = [0.0] * dim
            for row in self.vectors:
                for d in range(dim):
                    sums[d] += row[d]
            return sums
        elif axis == 1:
            return [float(sum(row)) for row in self.vectors]
        else:
            raise ValueError(f"Invalid axis {axis}, must be None, 0, or 1")

    def mean(self, axis: int | None = None) -> float | list[float]:
        """Compute the mean across all values, per dimension (axis=0), or per vector (axis=1).

        When axis=0, uses native aphrody.rag.vectors kernel if available.
        """
        if not self.vectors or self.dim == 0:
            return 0.0 if axis is None else []

        if axis == 0:
            # Dimension-wise centroid mean
            if _HAS_NUMPY:
                try:
                    from aphrody.rag import vectors as rag_vectors

                    arr = self.to_numpy()
                    mean_emb = rag_vectors.mean(arr)
                    return mean_emb.tolist()
                except Exception:
                    pass
                return self.to_numpy().mean(axis=0).tolist()
            else:
                dim = self.dim
                count = len(self.vectors)
                sums = [0.0] * dim
                for row in self.vectors:
                    for d in range(dim):
                        sums[d] += row[d]
                return [s / count for s in sums]

        if axis == 1:
            if _HAS_NUMPY:
                return self.to_numpy().mean(axis=1).tolist()
            return [float(sum(row) / len(row)) for row in self.vectors]

        if axis is None:
            if _HAS_NUMPY:
                return float(self.to_numpy().mean())
            total = sum(x for row in self.vectors for x in row)
            total_count = len(self.vectors) * self.dim
            return float(total / total_count)

        raise ValueError(f"Invalid axis {axis}, must be None, 0, or 1")

    def min(self, axis: int | None = None) -> float | list[float]:
        """Compute the minimum element across all values or specified axis."""
        if not self.vectors or self.dim == 0:
            return 0.0 if axis is None else []

        if _HAS_NUMPY:
            arr = self.to_numpy()
            if axis is None:
                return float(arr.min())
            return arr.min(axis=axis).tolist()

        if axis is None:
            return float(min(min(row) for row in self.vectors))
        elif axis == 0:
            dim = self.dim
            mins = list(self.vectors[0])
            for row in self.vectors[1:]:
                for d in range(dim):
                    if row[d] < mins[d]:
                        mins[d] = row[d]
            return mins
        elif axis == 1:
            return [float(min(row)) for row in self.vectors]
        raise ValueError(f"Invalid axis {axis}, must be None, 0, or 1")

    def max(self, axis: int | None = None) -> float | list[float]:
        """Compute the maximum element across all values or specified axis."""
        if not self.vectors or self.dim == 0:
            return 0.0 if axis is None else []

        if _HAS_NUMPY:
            arr = self.to_numpy()
            if axis is None:
                return float(arr.max())
            return arr.max(axis=axis).tolist()

        if axis is None:
            return float(max(max(row) for row in self.vectors))
        elif axis == 0:
            dim = self.dim
            maxs = list(self.vectors[0])
            for row in self.vectors[1:]:
                for d in range(dim):
                    if row[d] > maxs[d]:
                        maxs[d] = row[d]
            return maxs
        elif axis == 1:
            return [float(max(row)) for row in self.vectors]
        raise ValueError(f"Invalid axis {axis}, must be None, 0, or 1")

    def sum_squares(self, axis: int | None = None) -> float | list[float]:
        """Compute sum of squared coordinates."""
        if not self.vectors or self.dim == 0:
            return 0.0 if axis is None else []

        if _HAS_NUMPY:
            arr = self.to_numpy()
            sq = arr * arr
            if axis is None:
                return float(sq.sum())
            return sq.sum(axis=axis).tolist()

        if axis is None:
            return float(sum(x * x for row in self.vectors for x in row))
        elif axis == 0:
            dim = self.dim
            sq_sums = [0.0] * dim
            for row in self.vectors:
                for d in range(dim):
                    sq_sums[d] += row[d] * row[d]
            return sq_sums
        elif axis == 1:
            return [float(sum(x * x for x in row)) for row in self.vectors]
        raise ValueError(f"Invalid axis {axis}, must be None, 0, or 1")

    def sum_of_squares(self, axis: int | None = None) -> float | list[float]:
        """Alias for sum_squares."""
        return self.sum_squares(axis=axis)

    def normalize(self) -> VectorBatch:
        """Normalize each vector to unit L2 norm.

        Uses native aphrody.rag.vectors kernel when available, with pure
        Python/NumPy fallback.
        """
        if not self.vectors:
            return VectorBatch(
                batch_name=f"{self.batch_name}_normalized",
                vectors=[],
                labels=list(self.labels),
                metadata=dict(self.metadata),
            )

        # Try native rag-core kernel
        if _HAS_NUMPY:
            try:
                from aphrody.rag import vectors as rag_vectors

                arr = self.to_numpy()
                normed = rag_vectors.normalize(arr)
                return VectorBatch(
                    batch_name=f"{self.batch_name}_normalized",
                    vectors=normed.tolist(),
                    labels=list(self.labels),
                    metadata=dict(self.metadata),
                )
            except Exception:
                pass

            # Pure NumPy fallback
            arr = self.to_numpy()
            norms = np.linalg.norm(arr, axis=1, keepdims=True)
            norms[norms == 0.0] = 1.0
            normed = arr / norms
            return VectorBatch(
                batch_name=f"{self.batch_name}_normalized",
                vectors=normed.tolist(),
                labels=list(self.labels),
                metadata=dict(self.metadata),
            )

        # Pure Python fallback
        normed_rows: list[list[float]] = []
        for row in self.vectors:
            sq_sum = sum(x * x for x in row)
            if sq_sum <= 0.0:
                normed_rows.append([0.0 for _ in row])
            else:
                inv_norm = 1.0 / math.sqrt(sq_sum)
                normed_rows.append([float(x * inv_norm) for x in row])

        return VectorBatch(
            batch_name=f"{self.batch_name}_normalized",
            vectors=normed_rows,
            labels=list(self.labels),
            metadata=dict(self.metadata),
        )

    def similarity_matrix(
        self, other: VectorBatch | None = None, normalized: bool = True
    ) -> np.ndarray:
        """Compute pairwise cosine similarities with another VectorBatch or self."""
        if not _HAS_NUMPY:
            raise RuntimeError("NumPy is required to compute similarity matrix")
        left_vb = self.normalize() if normalized else self
        right_vb = (
            (other.normalize() if normalized else other)
            if other is not None
            else left_vb
        )
        left = left_vb.to_numpy()
        right = right_vb.to_numpy()
        try:
            from aphrody.rag import vectors as rag_vectors

            return rag_vectors.similarities(left, right)
        except Exception:
            return np.dot(left, right.T)

    def summary(self) -> dict[str, float]:
        """Compute summary statistics for the vector batch."""
        if not self.vectors or self.dim == 0:
            return {
                "sum": 0.0,
                "mean": 0.0,
                "min": 0.0,
                "max": 0.0,
                "sum_sq": 0.0,
                "count": 0.0,
                "dim": 0.0,
            }
        s = self.sum()
        m = self.mean()
        mi = self.min()
        ma = self.max()
        ss = self.sum_squares()
        return {
            "sum": float(s) if isinstance(s, (int, float)) else 0.0,
            "mean": float(m) if isinstance(m, (int, float)) else 0.0,
            "min": float(mi) if isinstance(mi, (int, float)) else 0.0,
            "max": float(ma) if isinstance(ma, (int, float)) else 0.0,
            "sum_sq": float(ss) if isinstance(ss, (int, float)) else 0.0,
            "count": float(self.count),
            "dim": float(self.dim),
        }


def analyze_vector_batch(batch: VectorBatch) -> dict[str, float]:
    """Analyze a VectorBatch, computing summary statistics."""
    return batch.summary()

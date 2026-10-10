# SPDX-License-Identifier: Apache-2.0
"""Shared NumPy buffer boundary for rag-core, without optional graph providers."""

from types import ModuleType

import numpy as np

_native: ModuleType | None

try:
    from aphrody import aphrody_rust as _native
except ImportError:
    _native = None


def _kernel(name: str):
    function = getattr(_native, name, None)
    if function is None:
        raise ImportError("RAG requires the native wheel with rag-core vector kernels")
    return function


class _Vectors:
    """Adapt precision and shapes only; arithmetic belongs to the native core."""

    def __init__(self, precision: str):
        self.precision = precision
        self.dtype = "<f4" if precision == "f32" else "<f8"

    def batch(self, rows: np.ndarray) -> np.ndarray:
        array = np.asarray(rows, dtype=self.dtype, order="C")
        if array.ndim != 2:
            raise ValueError("embedding batch must be two-dimensional")
        return array

    def normalize(self, rows: np.ndarray) -> np.ndarray:
        array = self.batch(rows)
        result = _kernel(f"normalize_embeddings_{self.precision}")(
            array.tobytes(), *array.shape
        )
        return np.frombuffer(result, dtype=self.dtype).reshape(array.shape)

    def pairwise(
        self, operation: str, left: np.ndarray, right: np.ndarray
    ) -> np.ndarray:
        left_array, right_array = self.batch(left), self.batch(right)
        if left_array.shape[1] != right_array.shape[1]:
            raise ValueError("embedding dimensions do not match")
        result = _kernel(f"{operation}_{self.precision}")(
            left_array.tobytes(),
            right_array.tobytes(),
            left_array.shape[0],
            right_array.shape[0],
            left_array.shape[1],
        )
        return np.frombuffer(result, dtype=self.dtype).reshape(
            left_array.shape[0], right_array.shape[0]
        )

    def similarities(self, left: np.ndarray, right: np.ndarray) -> np.ndarray:
        return self.pairwise("embedding_similarities", left, right)

    def mean(self, rows: np.ndarray) -> np.ndarray:
        array = self.batch(rows)
        result = _kernel(f"mean_embeddings_{self.precision}")(
            array.tobytes(), *array.shape
        )
        return np.frombuffer(result, dtype=self.dtype)


_f32, _f64 = _Vectors("f32"), _Vectors("f64")
normalize_f32 = _f32.normalize
similarities_f32 = _f32.similarities
normalize = _f64.normalize
similarities = _f64.similarities
mean = _f64.mean


def update_centers(
    rows: np.ndarray, labels: np.ndarray, centers: np.ndarray
) -> np.ndarray:
    """Update spherical centers while retaining empty clusters."""
    array, old_centers = _f64.batch(rows), _f64.batch(centers)
    if array.shape[1] != old_centers.shape[1]:
        raise ValueError("embedding dimensions do not match")
    result = _kernel("update_cosine_centers_f64")(
        array.tobytes(),
        np.asarray(labels).tolist(),
        old_centers.tobytes(),
        array.shape[0],
        old_centers.shape[0],
        array.shape[1],
    )
    return np.frombuffer(result, dtype="<f8").reshape(old_centers.shape)


def centroid_mean(rows: np.ndarray) -> np.ndarray:
    """Keep UMAP float32 means at their native precision; otherwise use float64."""
    core = _f32 if np.asarray(rows).dtype == np.float32 else _f64
    return core.mean(rows)


def squared_distances(left: np.ndarray, right: np.ndarray) -> np.ndarray:
    """Compute direct squared distances, retaining UMAP float32 arithmetic."""
    single = (
        np.asarray(left).dtype == np.float32 and np.asarray(right).dtype == np.float32
    )
    return (_f32 if single else _f64).pairwise(
        "squared_embedding_distances", left, right
    )

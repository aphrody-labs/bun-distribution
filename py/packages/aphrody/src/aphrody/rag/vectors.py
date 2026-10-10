# SPDX-License-Identifier: Apache-2.0
"""Compatibility surface for the shared rag-core NumPy buffer adapter."""

from aphrody._rag_vectors import (
    centroid_mean,
    mean,
    normalize,
    similarities,
    squared_distances,
    update_centers,
)

__all__ = [
    "centroid_mean",
    "mean",
    "normalize",
    "similarities",
    "squared_distances",
    "update_centers",
]

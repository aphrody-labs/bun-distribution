# SPDX-License-Identifier: Apache-2.0
"""Shared buffer boundary keeps the different native precision contracts."""

import numpy as np
import pytest

from aphrody import _rag_vectors as vectors


def test_precision_contracts_are_not_collapsed():
    tiny = np.array([[1e-14, 0.0]])
    np.testing.assert_allclose(vectors.normalize_f32(tiny), [[1, 0]])
    np.testing.assert_allclose(vectors.normalize(tiny), [[0.01, 0]])
    assert vectors.normalize_f32(tiny).flags.writeable
    assert vectors.normalize(tiny).flags.writeable


@pytest.mark.parametrize("dtype", [np.float32, np.float64])
def test_shared_pairwise_shape_validation(dtype):
    with pytest.raises(ValueError, match="two-dimensional"):
        vectors.squared_distances(np.ones(3, dtype=dtype), np.ones((1, 3), dtype=dtype))
    with pytest.raises(ValueError, match="dimensions"):
        vectors.squared_distances(
            np.ones((1, 3), dtype=dtype), np.ones((1, 2), dtype=dtype)
        )


def test_mixed_precision_distance_promotes_and_preserves_strides():
    left = np.arange(12, dtype=np.float32).reshape(2, 6)[:, ::2]
    right = np.array([[0, 1e-10, 1]], dtype=np.float64)
    result = vectors.squared_distances(left, right)
    assert result.dtype == np.float64
    np.testing.assert_allclose(result, ((left[:, None, :] - right) ** 2).sum(axis=2))

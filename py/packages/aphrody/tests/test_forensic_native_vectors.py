# SPDX-License-Identifier: Apache-2.0
"""Float32 forensic arithmetic parity and the native buffer boundary."""

import subprocess
import sys

import numpy as np
import pytest

from aphrody import _rag_vectors as vectors


@pytest.mark.parametrize("width", [1, 2, 8, 33, 129, 257])
def test_normalization_matches_numpy_float32(width):
    rows = np.random.default_rng(17).normal(size=(5, width)).astype(np.float32)
    rows[0] = 0
    norms = np.linalg.norm(rows, axis=1, keepdims=True)
    norms[norms == 0] = 1
    expected = rows / norms
    actual = vectors.normalize_f32(rows)
    assert actual.dtype == np.float32
    assert actual.flags.writeable
    np.testing.assert_array_equal(actual, expected)


def test_scores_match_numpy_and_keep_noncontiguous_input_order():
    rng = np.random.default_rng(29)
    left = rng.normal(size=(8, 66)).astype(np.float32)[:, ::2]
    right = rng.normal(size=(6, 33)).astype(np.float32)[::-1]
    actual = vectors.similarities_f32(left, right)
    assert actual.dtype == np.float32
    assert actual.shape == (8, 6)
    np.testing.assert_allclose(actual, left @ right.T, rtol=2e-6, atol=2e-6)
    assert (
        np.argsort(-actual[:, 0]).tolist()
        == np.argsort(-(left @ right.T)[:, 0]).tolist()
    )


def test_empty_axes_nonfinite_values_and_native_buffer_errors():
    assert vectors.normalize_f32(np.empty((0, 3), dtype=np.float32)).shape == (0, 3)
    assert vectors.normalize_f32(np.empty((3, 0), dtype=np.float32)).shape == (3, 0)
    np.testing.assert_array_equal(
        vectors.similarities_f32(np.empty((3, 0)), np.empty((2, 0))),
        np.zeros((3, 2)),
    )
    assert vectors.similarities_f32(np.empty((0, 3)), np.ones((2, 3))).shape == (0, 2)
    assert np.isnan(vectors.normalize_f32(np.array([[np.nan]], dtype=np.float32))[0, 0])
    with pytest.raises(ValueError, match="dimensions"):
        vectors.similarities_f32(np.ones((1, 3)), np.ones((1, 2)))
    with pytest.raises(ValueError, match="two-dimensional"):
        vectors.normalize_f32(np.ones(3))
    with pytest.raises(ValueError, match="buffer length"):
        vectors._native.normalize_embeddings_f32(b"\0" * 4, 2, 1)
    with pytest.raises(ValueError, match="buffer length"):
        vectors._native.embedding_similarities_f32(b"\0" * 4, b"\0" * 3, 1, 1, 1)


def test_missing_kernel_fails_explicitly_without_numpy_fallback(monkeypatch):
    monkeypatch.setattr(vectors, "_native", None)
    with pytest.raises(ImportError, match="native wheel"):
        vectors.normalize_f32(np.ones((1, 3)))
    with pytest.raises(ImportError, match="native wheel"):
        vectors.similarities_f32(np.ones((1, 3)), np.ones((1, 3)))


def test_forensic_embedding_does_not_require_graph_extras():
    subprocess.run(
        [
            sys.executable,
            "-c",
            """
import sys
class BlockGraphs:
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'networkx', 'sklearn', 'umap'}:
            raise ModuleNotFoundError('optional graph provider was imported')
sys.meta_path.insert(0, BlockGraphs())
from aphrody.forensic.rag import _embed_texts
class Embedder:
    def embed(self, texts):
        return [[3, 4], [0, 0]]
rows = _embed_texts(Embedder(), ['one', 'two'])
assert rows.dtype.name == 'float32'
assert rows[1].tolist() == [0, 0]
assert 'aphrody.rag' not in sys.modules
""",
        ],
        check=True,
    )

# SPDX-License-Identifier: Apache-2.0
"""Float64 migration checks against the former NumPy RAPTOR arithmetic."""

import pytest

# aphrody.rag needs the `rag` extra (networkx, scikit-learn, umap-learn).
pytest.importorskip("networkx", reason="install aphrody[rag]")
np = pytest.importorskip("numpy", reason="install aphrody[rag]")

from aphrody import _rag_vectors as native_vectors  # noqa: E402
from aphrody.rag import vectors  # noqa: E402
from aphrody.rag.raptor import (  # noqa: E402
    RecursiveAbstractiveProcessing4TreeOrganizedRetrieval as Builder,
)
from aphrody.rag.raptor import (  # noqa: E402
    _PsiTreeNode,
)


def reference_normalize(rows):
    rows = np.asarray(rows, dtype=np.float64)
    return rows / np.maximum(np.linalg.norm(rows, axis=1, keepdims=True), 1e-12)


def reference_buckets(rows, bucket_size):
    rows = reference_normalize(rows)
    groups, buckets = [np.arange(len(rows), dtype=int)], []
    while groups:
        group = np.asarray(groups.pop(), dtype=int)
        if len(group) <= bucket_size:
            buckets.append(group.tolist())
            continue
        fanout = min(max(2, int(np.ceil(len(group) / bucket_size))), len(group), 32)
        batch = rows[group]
        centers = batch[np.linspace(0, len(batch) - 1, num=fanout, dtype=int)].copy()
        for _ in range(5):
            labels = np.argmax(batch @ centers.T, axis=1)
            for center_id in range(fanout):
                mask = labels == center_id
                if not np.any(mask):
                    continue
                center = batch[mask].mean(axis=0)
                norm = np.linalg.norm(center)
                centers[center_id] = center / norm if norm > 0 else center
        labels = np.argmax(batch @ centers.T, axis=1)
        split = [group[labels == center].tolist() for center in range(fanout)]
        split = [bucket for bucket in split if bucket]
        if len(split) <= 1:
            split = [
                group[start : start + bucket_size].tolist()
                for start in range(0, len(group), bucket_size)
            ]
        groups.extend(split)
    return sorted(
        (bucket for bucket in buckets if bucket),
        key=lambda bucket: (len(bucket), bucket[0]),
    )


def builder(size=8):
    return Builder(
        4,
        lambda *args: "",
        lambda *args: [],
        "",
        tree_builder="psi",
        psi_bucket_size=size,
    )


@pytest.mark.parametrize(
    "rows",
    [
        np.array([[3.0, 4.0], [0.0, 0.0], [1e-14, 0.0], [1e-12, 0.0]]),
        np.random.default_rng(13).normal(size=(31, 97)),
        np.random.default_rng(14).normal(size=(22, 64))[::2, ::2],
        np.array([[1.0, 2.0]], dtype=">f8"),
        np.empty((0, 5)),
    ],
)
def test_normalization_preserves_precision_shapes_and_writability(rows):
    actual = vectors.normalize(rows)
    np.testing.assert_allclose(
        actual, reference_normalize(rows), rtol=1e-14, atol=1e-15
    )
    assert actual.dtype == np.float64 and actual.shape == rows.shape
    assert actual.flags.writeable


def test_nonfinite_propagation_and_invalid_shapes():
    rows = np.array([[np.nan, 1.0], [np.inf, 1.0]])
    with np.errstate(invalid="ignore"):
        np.testing.assert_allclose(
            vectors.normalize(rows), reference_normalize(rows), equal_nan=True
        )
    with pytest.raises(ValueError):
        vectors.normalize(np.array([1.0, 2.0]))
    with pytest.raises(ValueError):
        vectors.similarities(np.ones((1, 2)), np.ones((1, 3)))
    with pytest.raises(ValueError):
        vectors.mean(np.empty((0, 2)))


def test_batch_product_and_means_retain_float64():
    rng = np.random.default_rng(15)
    left, right = rng.normal(size=(17, 97)), rng.normal(size=(13, 97))
    np.testing.assert_allclose(
        vectors.similarities(left, right),
        left @ right.T,
        rtol=1e-13,
        atol=1e-13,
    )
    np.testing.assert_allclose(
        vectors.mean(left), left.mean(axis=0), rtol=1e-14, atol=1e-15
    )
    precise = 1.0 + 1e-10
    assert (
        vectors.similarities(np.array([[precise]]), np.array([[1.0]]))[0, 0] == precise
    )


@pytest.mark.parametrize(
    "rows",
    [
        np.random.default_rng(20).normal(size=(37, 16)),
        np.zeros((37, 16)),
        np.ones((37, 16)),
        np.tile([[1.0, 0.0], [-1.0, 0.0]], (20, 1)),
    ],
)
def test_psi_bucket_membership_limits_and_order_match_original(rows):
    nodes = [_PsiTreeNode(index=i, embedding=row) for i, row in enumerate(rows)]
    actual = [
        [node.index for node in bucket]
        for bucket in builder()._split_psi_buckets(nodes)
    ]
    assert actual == reference_buckets(rows, 8)
    assert max(map(len, actual)) <= 8
    assert sorted(index for bucket in actual for index in bucket) == list(
        range(len(rows))
    )


@pytest.mark.parametrize(
    "rows",
    [
        np.random.default_rng(21).normal(size=(20, 17)),
        np.zeros((20, 17)),
        np.ones((20, 17)),
    ],
)
def test_leaf_pair_ranking_preserves_existing_numpy_tie_order(rows):
    normalized = reference_normalize(rows)
    lower = np.tril_indices(len(rows), -1)
    order = np.argsort((normalized @ normalized.T)[lower], axis=0)[::-1]
    expected = np.stack([lower[0][order], lower[1][order]], axis=-1)
    nodes = [_PsiTreeNode(index=i, embedding=row) for i, row in enumerate(rows)]
    np.testing.assert_array_equal(builder()._rank_leaf_pairs(nodes), expected)


def test_empty_centers_and_missing_native_are_explicit(monkeypatch):
    rows, centers = (
        np.array([[1.0, 0.0], [-1.0, 0.0]]),
        np.array([[1.0, 0.0], [0.0, 1.0]]),
    )
    np.testing.assert_array_equal(
        vectors.update_centers(rows, np.array([0, 0]), centers),
        [[0.0, 0.0], [0.0, 1.0]],
    )
    monkeypatch.setattr(native_vectors, "_native", None)
    with pytest.raises(ImportError, match="native wheel"):
        vectors.normalize(rows)


def reference_refinement(rows, labels, max_iter):
    labels = labels.copy()
    for _ in range(max_iter):
        unique = np.unique(labels)
        if len(unique) <= 1:
            return labels
        centers = np.stack([rows[labels == label].mean(axis=0) for label in unique])
        distances = ((rows[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        new = unique[np.argmin(distances, axis=1)]
        if np.array_equal(new, labels):
            break
        remap = {old: new for new, old in enumerate(np.unique(new))}
        labels = np.array([remap[int(label)] for label in new])
    return labels


@pytest.mark.parametrize("dtype", [np.float32, np.float64])
@pytest.mark.parametrize("width", [0, 1, 7, 8, 12, 16, 97, 129, 257])
def test_squared_distances_match_numpy_without_normalization(width, dtype):
    rng = np.random.default_rng(54)
    left, right = (
        rng.normal(size=(13, width)).astype(dtype),
        rng.normal(size=(5, width)).astype(dtype),
    )
    expected = ((left[:, None, :] - right[None, :, :]) ** 2).sum(axis=2)
    actual = vectors.squared_distances(left, right)
    np.testing.assert_allclose(
        actual,
        expected,
        rtol=1e-6 if dtype == np.float32 else 1e-14,
        atol=1e-14,
    )
    assert actual.dtype == dtype
    assert actual.shape == (13, 5) and actual.flags.writeable
    assert vectors.squared_distances(np.empty((0, width)), right).shape == (
        0,
        5,
    )
    assert vectors.squared_distances(left, np.empty((0, width))).shape == (
        13,
        0,
    )


@pytest.mark.parametrize("dtype", [np.float32, np.float64])
@pytest.mark.parametrize("max_iter", [0, 1, 5])
@pytest.mark.parametrize("kind", ["random", "ties", "near-ties", "nonfinite"])
def test_centroid_refinement_preserves_labels_order_and_stopping(kind, max_iter, dtype):
    rng = np.random.default_rng(55)
    if kind == "random":
        rows = rng.normal(size=(21, 97))
    elif kind == "ties":
        rows = np.zeros((21, 3))
    elif kind == "near-ties":
        rows = np.tile([[0.0, 1.0], [0.0, -1.0], [1e-12, 0.0]], (7, 1))
    else:
        rows = rng.normal(size=(21, 3))
        rows[0, 0] = np.nan
    rows = rows.astype(dtype)
    labels = np.tile([-4, 2, 19], 7)
    original = labels.copy()
    np.testing.assert_array_equal(
        builder()._adjust_tree_nodes(rows, labels, max_iter),
        reference_refinement(rows, labels, max_iter),
    )
    np.testing.assert_array_equal(labels, original)


def test_squared_distance_shape_and_missing_extension_fail_explicitly(
    monkeypatch,
):
    with pytest.raises(ValueError):
        vectors.squared_distances(np.ones((2, 3)), np.ones((2, 4)))
    monkeypatch.setattr(native_vectors, "_native", None)
    with pytest.raises(ImportError, match="native wheel"):
        vectors.squared_distances(np.ones((2, 3)), np.ones((2, 3)))


def test_umap_float32_centroid_rounding_changes_assignment_if_promoted():
    rows = (
        100000 + np.random.default_rng(37).integers(-20, 21, (16, 3)) * 0.008
    ).astype(np.float32)
    labels = np.arange(16) % 3
    expected = reference_refinement(rows, labels, 1)
    promoted = reference_refinement(rows.astype(np.float64), labels, 1)
    assert expected[1] == 1 and promoted[1] == 2
    np.testing.assert_array_equal(
        builder()._adjust_tree_nodes(rows, labels, 1), expected
    )

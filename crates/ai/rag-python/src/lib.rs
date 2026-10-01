// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

use pyo3::prelude::*;
use pyo3::types::PyByteArray;

fn vector_error(error: &'static str) -> PyErr {
    pyo3::exceptions::PyValueError::new_err(error)
}

#[pyfunction]
fn unpack_embeddings(data: &[u8], rows: usize, width: usize) -> PyResult<Vec<Vec<f64>>> {
    if rows.checked_mul(width).and_then(|size| size.checked_mul(8)) != Some(data.len()) {
        return Err(vector_error("packed embedding dimensions do not match buffer length"));
    }
    if width == 0 {
        return Ok(vec![vec![]; rows]);
    }
    let values: Vec<f64> =
        data.as_chunks::<8>().0.iter().map(|bytes| f64::from_le_bytes(*bytes)).collect();
    Ok(values.chunks_exact(width).map(<[f64]>::to_vec).collect())
}

fn pack_values<'a>(
    py: Python<'_>,
    values: impl ExactSizeIterator<Item = &'a f64>,
) -> PyResult<Py<PyByteArray>> {
    let size =
        values.len().checked_mul(8).ok_or_else(|| vector_error("packed result size overflow"))?;
    PyByteArray::new_with(py, size, |bytes| {
        for (chunk, value) in bytes.as_chunks_mut::<8>().0.iter_mut().zip(values) {
            chunk.copy_from_slice(&value.to_le_bytes());
        }
        Ok(())
    })
    .map(Bound::unbind)
}

fn pack_embeddings(py: Python<'_>, values: &[Vec<f64>]) -> PyResult<Py<PyByteArray>> {
    let flattened: Vec<f64> = values.iter().flatten().copied().collect();
    pack_values(py, flattened.iter())
}

#[pyfunction]
fn normalize_embeddings_f64(
    py: Python<'_>,
    data: &[u8],
    rows: usize,
    width: usize,
) -> PyResult<Py<PyByteArray>> {
    let batch = unpack_embeddings(data, rows, width)?;
    let result =
        py.detach(|| aphrody_rag_core::vectors_f64::normalize(&batch)).map_err(vector_error)?;
    pack_embeddings(py, &result)
}

#[pyfunction]
fn embedding_similarities_f64(
    py: Python<'_>,
    left: &[u8],
    right: &[u8],
    left_rows: usize,
    right_rows: usize,
    width: usize,
) -> PyResult<Py<PyByteArray>> {
    if left_rows.checked_mul(width).and_then(|size| size.checked_mul(8)) != Some(left.len())
        || right_rows.checked_mul(width).and_then(|size| size.checked_mul(8)) != Some(right.len())
    {
        return Err(vector_error("packed embedding dimensions do not match buffer length"));
    }
    let left_batch: Vec<f64> =
        left.as_chunks::<8>().0.iter().map(|bytes| f64::from_le_bytes(*bytes)).collect();
    let right_batch: Vec<f64> =
        right.as_chunks::<8>().0.iter().map(|bytes| f64::from_le_bytes(*bytes)).collect();
    let result = py
        .detach(|| {
            aphrody_rag_core::vectors_f64::similarities_flat(
                &left_batch,
                &right_batch,
                left_rows,
                right_rows,
                width,
            )
        })
        .map_err(vector_error)?;
    pack_values(py, result.iter())
}

#[pyfunction]
fn mean_embeddings_f64(
    py: Python<'_>,
    data: &[u8],
    rows: usize,
    width: usize,
) -> PyResult<Py<PyByteArray>> {
    let batch = unpack_embeddings(data, rows, width)?;
    let result = py.detach(|| aphrody_rag_core::vectors_f64::mean(&batch)).map_err(vector_error)?;
    pack_values(py, result.iter())
}

#[pyfunction]
fn update_cosine_centers_f64(
    py: Python<'_>,
    data: &[u8],
    labels: Vec<usize>,
    centers: &[u8],
    rows: usize,
    center_rows: usize,
    width: usize,
) -> PyResult<Py<PyByteArray>> {
    let batch = unpack_embeddings(data, rows, width)?;
    let centers_batch = unpack_embeddings(centers, center_rows, width)?;
    let result = py
        .detach(|| aphrody_rag_core::vectors_f64::update_centers(&batch, &labels, &centers_batch))
        .map_err(vector_error)?;
    pack_embeddings(py, &result)
}

#[pyfunction]
fn cosine_similarity(v1: Vec<f32>, v2: Vec<f32>) -> PyResult<f32> {
    if v1.len() != v2.len() || v1.is_empty() {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "Vectors must be non-empty and of same length",
        ));
    }
    Ok(aphrody_rag_core::fusion::cosine(&v1, &v2))
}

#[pyfunction]
fn top_k_cosine_similarity(
    query: Vec<f32>,
    embeddings: Vec<Vec<f32>>,
    k: usize,
) -> PyResult<Vec<(usize, f32)>> {
    if query.is_empty() {
        return Err(pyo3::exceptions::PyValueError::new_err("Query vector must be non-empty"));
    }
    let mut results = Vec::with_capacity(embeddings.len());
    for (idx, emb) in embeddings.iter().enumerate() {
        if emb.len() != query.len() {
            continue;
        }
        let score = aphrody_rag_core::fusion::cosine(&query, emb);
        results.push((idx, score));
    }
    results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    results.truncate(k);
    Ok(results)
}

#[pyfunction]
#[pyo3(signature = (rankings, k=None))]
fn reciprocal_rank_fusion(
    rankings: Vec<Vec<usize>>,
    k: Option<f32>,
) -> PyResult<Vec<(usize, f32)>> {
    let lists: Vec<&[usize]> = rankings.iter().map(Vec::as_slice).collect();
    Ok(aphrody_rag_core::fusion::rrf(&lists, f64::from(k.unwrap_or(60.0)))
        .into_iter()
        .map(|(id, score)| (id, score as f32))
        .collect())
}

#[pymodule]
fn aphrody_rust(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(normalize_embeddings_f64, m)?)?;
    m.add_function(wrap_pyfunction!(embedding_similarities_f64, m)?)?;
    m.add_function(wrap_pyfunction!(mean_embeddings_f64, m)?)?;
    m.add_function(wrap_pyfunction!(update_cosine_centers_f64, m)?)?;
    m.add_function(wrap_pyfunction!(cosine_similarity, m)?)?;
    m.add_function(wrap_pyfunction!(top_k_cosine_similarity, m)?)?;
    m.add_function(wrap_pyfunction!(reciprocal_rank_fusion, m)?)?;
    Ok(())
}

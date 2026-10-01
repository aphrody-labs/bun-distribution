// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

use pyo3::prelude::*;

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
        .into_iter().map(|(id, score)| (id, score as f32)).collect())
}

#[pymodule]
fn aphrody_rust(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(cosine_similarity, m)?)?;
    m.add_function(wrap_pyfunction!(top_k_cosine_similarity, m)?)?;
    m.add_function(wrap_pyfunction!(reciprocal_rank_fusion, m)?)?;
    Ok(())
}

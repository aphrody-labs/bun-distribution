//! Recall@10 against exact brute force on 20k embedding-like vectors
//! (dim 384, 200 Gaussian clusters with low-rank in-cluster structure).
//! Run with `cargo test --release --test recall -- --nocapture` to see the
//! numbers.

use std::time::Instant;

use aphrody_web_index::{
    Index, IndexParams, Quantization, SearchOptions,
    synth::{ClusterSpec, ClusteredGenerator, brute_force_topk, recall_at_k},
};

const N: usize = 20_000;
const DIM: usize = 384;
const QUERIES: usize = 200;
const K: usize = 10;

fn search_all(index: &Index, queries: &[f32], opts: SearchOptions) -> Vec<Vec<u64>> {
    let (rows, _) = queries.as_chunks::<DIM>();
    rows.iter()
        .map(|q| index.search_with(q, opts, None).unwrap().into_iter().map(|(k, _)| k).collect())
        .collect()
}

#[test]
fn recall_at_10_on_clustered_embeddings() {
    let generator = ClusteredGenerator::new(ClusterSpec::embedding_like(DIM, 200, 0xB8C_2026));
    let base = generator.generate(N, 1);
    let queries = generator.generate(QUERIES, 2);
    let truth: Vec<Vec<u64>> = brute_force_topk(&base, &queries, DIM, K)
        .into_iter()
        .map(|ids| ids.into_iter().map(u64::from).collect())
        .collect();
    let keys: Vec<u64> = (0..N as u64).collect();

    let mut report = Vec::new();
    for (label, quantization) in [("int8", Quantization::Int8), ("f32", Quantization::None)] {
        let params = IndexParams { quantization, ..IndexParams::new(DIM) };
        assert_eq!(params.m, 16);
        assert_eq!(params.ef_search, 128);
        let index = Index::new(params).unwrap();
        let t = Instant::now();
        index.add_batch_flat(&keys, &base).unwrap();
        let build = t.elapsed();

        let default_opts = SearchOptions { k: K, ef: None, rescore_multiplier: None };
        let recall = recall_at_k(&truth, &search_all(&index, &queries, default_opts), K);
        report.push(format!("{label}: build {build:.2?}, recall@10 (defaults) = {recall:.4}"));
        assert!(recall >= 0.95, "{label} recall@10 {recall}");

        if quantization == Quantization::Int8 {
            let no_rescore = SearchOptions { rescore_multiplier: Some(0), ..default_opts };
            let raw = recall_at_k(&truth, &search_all(&index, &queries, no_rescore), K);
            report.push(format!("int8 without rescoring: recall@10 = {raw:.4}"));
            assert!(raw >= 0.80, "int8 without rescoring recall@10 {raw}");
        }
    }
    for line in report {
        println!("{line}");
    }
}

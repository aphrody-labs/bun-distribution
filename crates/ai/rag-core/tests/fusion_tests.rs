// SPDX-License-Identifier: Apache-2.0
//! Fusion, dedup, source-weighting/quota, MMR, and vector-kernel tests.

use aphrody_rag_core::fusion::{
    QuotaRule, ScoreScaling, SourceWeight, WeightedCandidate, apply_source_weights, cosine,
    cosine_with_norm, dedup_by_key, dot, dot_i8, fuse_scores, l2_normalize, merge_top_k,
    minmax_normalize, mmr, norm, quantize_i8, rrf, rrf_weighted, top_k_dot, top_k_exact, top_k_i8,
};

#[test]
fn rrf_favors_items_ranked_high_in_multiple_lists() {
    let a = ["x", "y", "z"];
    let b = ["y", "z", "x"];
    let fused = rrf(&[&a, &b], 60.0);
    // "y" is rank 1 in b and rank 2 in a: sum(1/(60+2), 1/(60+1)) — the best
    // combined score among the three.
    assert_eq!(fused[0].0, "y");
    let ids: Vec<&str> = fused.iter().map(|(id, _)| *id).collect();
    assert_eq!(ids.len(), 3);
    assert!(ids.contains(&"x") && ids.contains(&"z"));
}

#[test]
fn rrf_ties_break_by_first_appearance() {
    // Two disjoint singleton lists produce identical scores for both ids;
    // "a" appeared first (list 0), so it must sort first.
    let a = ["a"];
    let b = ["b"];
    let fused = rrf(&[&a, &b], 60.0);
    assert_eq!(fused[0].0, "a");
    assert_eq!(fused[1].0, "b");
    assert!((fused[0].1 - fused[1].1).abs() < f64::EPSILON);
}

#[test]
fn rrf_weighted_scales_each_list() {
    let a = ["p"];
    let b = ["q"];
    let fused = rrf_weighted(&[(&a[..], 10.0), (&b[..], 1.0)], 60.0);
    assert_eq!(fused[0].0, "p");
    assert!(fused[0].1 > fused[1].1);
}

#[test]
fn dedup_by_key_keeps_first_occurrence() {
    let items = vec![("a", 1), ("b", 2), ("a", 3)];
    let deduped = dedup_by_key(items, |(k, _)| *k);
    assert_eq!(deduped, vec![("a", 1), ("b", 2)]);
}

fn candidate(id: &str, source: &str, kind: &str, score: f64) -> WeightedCandidate<String> {
    WeightedCandidate {
        id: id.to_string(),
        source_id: Some(source.to_string()),
        kind: Some(kind.to_string()),
        score,
    }
}

#[test]
fn apply_source_weights_boosts_then_fills_quota() {
    // 5 "wiki" hits outrank 3 "manga" hits before boosting.
    let mut cands = vec![
        candidate("w1", "wiki", "page", 0.9),
        candidate("w2", "wiki", "page", 0.8),
        candidate("w3", "wiki", "page", 0.7),
        candidate("w4", "wiki", "page", 0.6),
        candidate("w5", "wiki", "page", 0.5),
        candidate("m1", "manga", "panel", 0.4),
        candidate("m2", "manga", "panel", 0.35),
    ];
    cands.reverse(); // input order shouldn't matter
    let weights = vec![SourceWeight { source_id: "manga".to_string(), weight: 2.2 }];
    let quota = QuotaRule { source_id: "manga".to_string(), quota: 2, min_score: 0.3 };
    let top = apply_source_weights(cands, &weights, Some(&quota), &[], 3);
    let manga_count = top.iter().filter(|c| c.source_id.as_deref() == Some("manga")).count();
    assert_eq!(manga_count, 2, "{top:?}");
    assert_eq!(top.len(), 3);
}

#[test]
fn apply_source_weights_quota_evicts_filler_never_protected() {
    let cands = vec![
        candidate("protected", "wiki", "canon", 0.9),
        candidate("filler", "wiki", "other", 0.8),
        candidate("m1", "manga", "panel", 0.7),
    ];
    let weights = vec![SourceWeight { source_id: "manga".to_string(), weight: 1.0 }];
    let quota = QuotaRule { source_id: "manga".to_string(), quota: 1, min_score: 0.0 };
    let top = apply_source_weights(cands, &weights, Some(&quota), &["canon".to_string()], 2);
    let ids: Vec<&str> = top.iter().map(|c| c.id.as_str()).collect();
    assert!(ids.contains(&"protected"), "{ids:?}");
    assert!(ids.contains(&"m1"), "{ids:?}");
    assert!(!ids.contains(&"filler"), "{ids:?}");
}

#[test]
fn mmr_diversifies_away_from_near_duplicates() {
    let candidates = vec![
        ("a".to_string(), vec![1.0_f32, 0.0], 1.0),
        ("a_dup".to_string(), vec![0.99_f32, 0.01], 0.95),
        ("b".to_string(), vec![0.0_f32, 1.0], 0.9),
    ];
    let picked = mmr(&candidates, 0.5, 2);
    assert_eq!(picked[0], "a");
    assert_eq!(picked[1], "b", "MMR should prefer the diverse 'b' over the near-duplicate 'a_dup'");
}

#[test]
fn vector_kernels_agree_on_identical_vectors() {
    let v = [1.0_f32, 2.0, 3.0];
    assert!((cosine(&v, &v) - 1.0).abs() < 1e-6);
    assert!((dot(&v, &v) - 14.0).abs() < 1e-6);
    let mut n = v;
    l2_normalize(&mut n);
    assert!((dot(&n, &n) - 1.0).abs() < 1e-5);
}

#[test]
fn quantize_i8_round_trips_within_tolerance() {
    let v = [1.0_f32, -1.0, 0.5, -0.5, 0.0];
    let (q, scale) = quantize_i8(&v);
    for (orig, q_i) in v.iter().zip(&q) {
        let back = f32::from(*q_i) * scale;
        assert!((back - orig).abs() < 0.02, "{orig} vs {back}");
    }
    // dot_i8 on the vector's own quantization approximates the true self-dot
    // (sum of squares == 2.5) once rescaled by `scale * scale`.
    let approx_self_dot = dot_i8(&q, &q) as f32 * scale * scale;
    assert!((approx_self_dot - dot(&v, &v)).abs() < 0.05, "approx={approx_self_dot}");
}

#[test]
fn quantize_i8_all_zero_input_is_exact() {
    let v = [0.0_f32; 4];
    let (q, scale) = quantize_i8(&v);
    assert_eq!(scale, 0.0);
    assert!(q.iter().all(|&x| x == 0));
}

#[test]
fn top_k_exact_returns_best_k_by_cosine() {
    let query = [1.0_f32, 0.0];
    let matrix: Vec<f32> = vec![
        0.0, 1.0, // row 0: orthogonal
        1.0, 0.0, // row 1: identical
        0.9, 0.1, // row 2: close
        -1.0, 0.0, // row 3: opposite
    ];
    let top = top_k_exact(&query, &matrix, 2, 2);
    assert_eq!(top.len(), 2);
    assert_eq!(top[0].0, 1);
    assert_eq!(top[1].0, 2);
}

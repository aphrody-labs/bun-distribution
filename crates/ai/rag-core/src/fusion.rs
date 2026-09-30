// SPDX-License-Identifier: Apache-2.0
//! Rank fusion, source-weighted re-ranking, diversification (MMR), and the
//! small vector-math kernels retrieval needs: dot product, cosine
//! similarity, int8 scalar quantization, and a bounded-heap exact top-k
//! scan. No parallelism here by design (`docs/plans/codex-oss.md` P8/P9):
//! the host crate (`aphrody-rag`) parallelises with rayon over shards; this
//! crate stays single-threaded and wasm-safe.

use std::{
    cmp::Ordering,
    collections::{BinaryHeap, HashMap, HashSet},
    hash::Hash,
};

/// Reciprocal Rank Fusion: `score(id) = sum_over_lists(1 / (k + rank + 1))`,
/// `rank` 0-based. Ties are broken deterministically by first appearance
/// across `lists` (scanning `lists[0]` then `lists[1]`… in order), never by
/// hash-map iteration order.
#[must_use]
pub fn rrf<Id: Clone + Eq + Hash>(lists: &[&[Id]], k: f64) -> Vec<(Id, f64)> {
    let weighted: Vec<(&[Id], f64)> = lists.iter().map(|&l| (l, 1.0)).collect();
    rrf_weighted(&weighted, k)
}

/// [`rrf`] with a per-list weight multiplier: `score(id) = sum(weight_i / (k
/// + rank_i + 1))`.
#[must_use]
pub fn rrf_weighted<Id: Clone + Eq + Hash>(lists: &[(&[Id], f64)], k: f64) -> Vec<(Id, f64)> {
    let mut scores: HashMap<Id, f64> = HashMap::new();
    let mut first_seen: HashMap<Id, usize> = HashMap::new();
    let mut order = 0usize;
    for (list, weight) in lists {
        for (rank, id) in list.iter().enumerate() {
            *scores.entry(id.clone()).or_insert(0.0) += weight / (k + rank as f64 + 1.0);
            first_seen.entry(id.clone()).or_insert_with(|| {
                let o = order;
                order += 1;
                o
            });
        }
    }
    let mut out: Vec<(Id, f64, usize)> = scores
        .into_iter()
        .map(|(id, score)| {
            let seen = first_seen[&id];
            (id, score, seen)
        })
        .collect();
    out.sort_by(|a, b| {
        b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal).then_with(|| a.2.cmp(&b.2))
    });
    out.into_iter().map(|(id, score, _)| (id, score)).collect()
}

/// Keep the first occurrence of each `key_fn(item)`, preserving relative
/// order — the generic form of shenron's URL/title dedup pass in
/// `apps/bot/src/lib/rag.ts`.
#[must_use]
pub fn dedup_by_key<T, K, F>(items: Vec<T>, key_fn: F) -> Vec<T>
where
    K: Eq + Hash,
    F: Fn(&T) -> K,
{
    let mut seen: HashSet<K> = HashSet::new();
    let mut out = Vec::with_capacity(items.len());
    for item in items {
        if seen.insert(key_fn(&item)) {
            out.push(item);
        }
    }
    out
}

/// A multiplicative boost applied to every candidate whose `source_id`
/// matches, before the final sort — shenron's `RAG_MANGA_WEIGHT`.
#[derive(Debug, Clone)]
pub struct SourceWeight {
    pub source_id: String,
    pub weight: f64,
}

/// Guarantee at least `quota` results from `source_id` in the final top-N,
/// provided a candidate scores at least `min_score` (boosted) — shenron's
/// `RAG_MANGA_QUOTA` / `RAG_MANGA_QUOTA_MIN_SCORE`. A quota candidate never
/// evicts a result whose `kind` is in the caller's protected set.
#[derive(Debug, Clone)]
pub struct QuotaRule {
    pub source_id: String,
    pub quota: usize,
    pub min_score: f64,
}

/// A candidate entering the source-weighting / quota stage.
#[derive(Debug, Clone)]
pub struct WeightedCandidate<Id> {
    pub id: Id,
    pub source_id: Option<String>,
    pub kind: Option<String>,
    pub score: f64,
}

fn boosted(weights: &[SourceWeight], c: &WeightedCandidate<impl Clone>) -> f64 {
    let mult = c
        .source_id
        .as_deref()
        .and_then(|sid| weights.iter().find(|w| w.source_id == sid))
        .map_or(1.0, |w| w.weight);
    c.score * mult
}

/// Port of shenron's `boost()` + `MANGA_QUOTA` promotion pass
/// (`apps/bot/src/lib/rag.ts`, read 2026-09-19): sort all candidates by
/// boosted score, take the top `top_n`, then — if a `quota` is configured —
/// promote enough matching, sufficiently-scored candidates from the
/// remainder to satisfy the quota, evicting only non-protected, non-quota
/// entries starting from the bottom of the current top-N.
#[must_use]
pub fn apply_source_weights<Id: Clone + Eq>(
    candidates: Vec<WeightedCandidate<Id>>,
    weights: &[SourceWeight],
    quota: Option<&QuotaRule>,
    protected_kinds: &[String],
    top_n: usize,
) -> Vec<WeightedCandidate<Id>> {
    let mut ordered = candidates;
    ordered.sort_by(|a, b| {
        boosted(weights, b).partial_cmp(&boosted(weights, a)).unwrap_or(Ordering::Equal)
    });

    let mut top: Vec<WeightedCandidate<Id>> = ordered.iter().take(top_n).cloned().collect();
    let rest: Vec<WeightedCandidate<Id>> = ordered.into_iter().skip(top_n).collect();

    if let Some(rule) = quota {
        if rule.quota > 0 {
            let is_quota_source =
                |c: &WeightedCandidate<Id>| c.source_id.as_deref() == Some(rule.source_id.as_str());
            let mut promotable: Vec<WeightedCandidate<Id>> = rest
                .into_iter()
                .filter(|c| is_quota_source(c) && boosted(weights, c) >= rule.min_score)
                .collect();
            promotable.sort_by(|a, b| {
                boosted(weights, b).partial_cmp(&boosted(weights, a)).unwrap_or(Ordering::Equal)
            });

            let mut have = top.iter().filter(|c| is_quota_source(c)).count();
            for promoted in promotable {
                if have >= rule.quota {
                    break;
                }
                let worst = top.iter().rposition(|c| {
                    !is_quota_source(c)
                        && !c
                            .kind
                            .as_deref()
                            .is_some_and(|k| protected_kinds.iter().any(|p| p == k))
                });
                let Some(worst_idx) = worst else { break };
                top[worst_idx] = promoted;
                have += 1;
            }
            top.sort_by(|a, b| {
                boosted(weights, b).partial_cmp(&boosted(weights, a)).unwrap_or(Ordering::Equal)
            });
        }
    }
    top
}

/// Maximal Marginal Relevance: greedily pick `top_n` ids from `candidates`
/// (`(id, embedding, relevance)`) maximising `lambda * relevance - (1 -
/// lambda) * max_similarity_to_already_selected` at each step.
#[must_use]
pub fn mmr<Id: Clone>(candidates: &[(Id, Vec<f32>, f64)], lambda: f64, top_n: usize) -> Vec<Id> {
    let mut selected: Vec<usize> = Vec::new();
    let mut remaining: Vec<usize> = (0..candidates.len()).collect();

    while selected.len() < top_n && !remaining.is_empty() {
        let mut best_pos = 0usize;
        let mut best_score = f64::MIN;
        for (pos, &idx) in remaining.iter().enumerate() {
            let relevance = candidates[idx].2;
            let max_sim = selected
                .iter()
                .map(|&s| f64::from(cosine(&candidates[idx].1, &candidates[s].1)))
                .fold(f64::MIN, f64::max);
            let max_sim = if selected.is_empty() { 0.0 } else { max_sim };
            let score = lambda * relevance - (1.0 - lambda) * max_sim;
            if score > best_score {
                best_score = score;
                best_pos = pos;
            }
        }
        selected.push(remaining.remove(best_pos));
    }
    selected.into_iter().map(|i| candidates[i].0.clone()).collect()
}

/// Dot product of two equal-length vectors (`0.0` on length mismatch).
#[must_use]
pub fn dot(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// L2-normalise `v` in place (no-op on a zero vector).
pub fn l2_normalize(v: &mut [f32]) {
    let norm = dot(v, v).sqrt();
    if norm > 0.0 {
        for x in v.iter_mut() {
            *x /= norm;
        }
    }
}

/// Cosine similarity of two equal-length vectors (`0.0` on length mismatch
/// or either vector being all zeros).
#[must_use]
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    let na = dot(a, a).sqrt();
    let nb = dot(b, b).sqrt();
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot(a, b) / (na * nb)
}

/// Symmetric scalar int8 quantization: `scale = max(|v|) / 127`, `q_i =
/// round(v_i / scale)` clamped to `[-127, 127]`. Returns `(quantized,
/// scale)`; `scale == 0.0` for an all-zero input (quantized is then all
/// zeros too).
#[must_use]
pub fn quantize_i8(v: &[f32]) -> (Vec<i8>, f32) {
    let max_abs = v.iter().fold(0.0_f32, |m, x| m.max(x.abs()));
    if max_abs == 0.0 {
        return (vec![0_i8; v.len()], 0.0);
    }
    let scale = max_abs / 127.0;
    let q = v.iter().map(|x| ((x / scale).round().clamp(-127.0, 127.0)) as i8).collect();
    (q, scale)
}

/// Dot product of two int8-quantized vectors, widened to `i32` to avoid
/// overflow (`i8::MAX * i8::MAX * len` fits comfortably for any realistic
/// embedding dimension).
#[must_use]
pub fn dot_i8(a: &[i8], b: &[i8]) -> i32 {
    a.iter().zip(b).map(|(&x, &y)| i32::from(x) * i32::from(y)).sum()
}

#[derive(PartialEq)]
struct Scored(f32, usize);
impl Eq for Scored {}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.total_cmp(&other.0).then_with(|| other.1.cmp(&self.1))
    }
}

/// Exact top-`k` nearest neighbours of `query` (length `dim`) among the rows
/// of `matrix` (row-major, `matrix.len() / dim` rows), ranked by cosine
/// similarity, using a `k`-bounded binary heap so memory stays `O(k)`
/// regardless of `matrix` size. Returns `(row_index, score)` sorted by score
/// descending, ties broken by ascending row index.
#[must_use]
pub fn top_k_exact(query: &[f32], matrix: &[f32], dim: usize, k: usize) -> Vec<(usize, f32)> {
    if dim == 0 || k == 0 {
        return Vec::new();
    }
    let rows = matrix.len() / dim;
    let mut heap: BinaryHeap<std::cmp::Reverse<Scored>> = BinaryHeap::with_capacity(k + 1);
    for r in 0..rows {
        let row = &matrix[r * dim..(r + 1) * dim];
        let score = cosine(query, row);
        if heap.len() < k {
            heap.push(std::cmp::Reverse(Scored(score, r)));
        } else if let Some(std::cmp::Reverse(worst)) = heap.peek() {
            if score > worst.0 {
                heap.pop();
                heap.push(std::cmp::Reverse(Scored(score, r)));
            }
        }
    }
    let mut out: Vec<(usize, f32)> =
        heap.into_iter().map(|std::cmp::Reverse(Scored(s, i))| (i, s)).collect();
    out.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    out
}

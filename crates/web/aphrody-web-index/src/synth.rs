//! Deterministic synthetic embedding-like data and exact ground truth, shared
//! by the recall tests and `examples/index_bench.rs`.
//!
//! Each point is drawn from one of `clusters` components chosen with
//! weights `1 / sqrt(c + 1)` (uneven cluster sizes):
//!
//! `x = center_c + B_c z + e`, then L2-normalised, where `center_c` is a random
//! unit-scale direction, `B_c` is a random `rank`-dimensional basis scaled so
//! the in-cluster variation has norm ~`subspace_norm`, `z ~ N(0, I)`, and `e`
//! is isotropic noise with norm ~`noise_norm`. This mimics sentence
//! embeddings: strong topical clusters with low intrinsic dimension inside a
//! cluster plus a small full-rank residual.

use std::{cmp::Ordering, collections::BinaryHeap};

use crate::{kernels::dot_f32, rng::SplitMix64};

#[derive(Debug, Clone)]
pub struct ClusterSpec {
    pub dim: usize,
    pub clusters: usize,
    pub rank: usize,
    pub subspace_norm: f32,
    pub noise_norm: f32,
    pub seed: u64,
}

impl ClusterSpec {
    /// The configuration used by tests and benchmarks.
    pub fn embedding_like(dim: usize, clusters: usize, seed: u64) -> Self {
        Self { dim, clusters, rank: 16, subspace_norm: 0.6, noise_norm: 0.25, seed }
    }
}

pub struct ClusteredGenerator {
    spec: ClusterSpec,
    centers: Vec<f32>,
    bases: Vec<f32>,
    cumulative: Vec<f64>,
}

impl ClusteredGenerator {
    pub fn new(spec: ClusterSpec) -> Self {
        let mut rng = SplitMix64::new(spec.seed);
        let d = spec.dim;
        let inv_sqrt_d = 1.0 / (d as f32).sqrt();
        let centers: Vec<f32> =
            (0..spec.clusters * d).map(|_| rng.gaussian() * inv_sqrt_d).collect();
        let basis_scale = spec.subspace_norm / (spec.rank.max(1) as f32).sqrt() * inv_sqrt_d;
        let bases: Vec<f32> =
            (0..spec.clusters * spec.rank * d).map(|_| rng.gaussian() * basis_scale).collect();
        let mut acc = 0f64;
        let cumulative = (0..spec.clusters)
            .map(|c| {
                acc += 1.0 / ((c + 1) as f64).sqrt();
                acc
            })
            .collect();
        Self { spec, centers, bases, cumulative }
    }

    pub fn dim(&self) -> usize {
        self.spec.dim
    }

    /// Write one normalised sample into `out` (length `dim`).
    pub fn sample(&self, rng: &mut SplitMix64, out: &mut [f32]) {
        let d = self.spec.dim;
        let total = *self.cumulative.last().unwrap_or(&1.0);
        let u = rng.next_open01() * total;
        let c = self.cumulative.partition_point(|&w| w < u).min(self.spec.clusters - 1);
        out.copy_from_slice(&self.centers[c * d..(c + 1) * d]);
        for j in 0..self.spec.rank {
            let z = rng.gaussian();
            let b = &self.bases[(c * self.spec.rank + j) * d..(c * self.spec.rank + j + 1) * d];
            for (o, &bv) in out.iter_mut().zip(b) {
                *o += z * bv;
            }
        }
        let noise_scale = self.spec.noise_norm / (d as f32).sqrt();
        for o in out.iter_mut() {
            *o += rng.gaussian() * noise_scale;
        }
        let norm = out.iter().map(|x| x * x).sum::<f32>().sqrt().max(f32::MIN_POSITIVE);
        for o in out.iter_mut() {
            *o /= norm;
        }
    }

    /// Generate `n` flat vectors in parallel; output depends only on
    /// `(spec.seed, stream)`, not on the thread count.
    pub fn generate(&self, n: usize, stream: u64) -> Vec<f32> {
        const BLOCK: usize = 4096;
        let d = self.spec.dim;
        let mut data = vec![0f32; n * d];
        let threads = std::thread::available_parallelism().map_or(1, |t| t.get());
        let blocks: Vec<(usize, &mut [f32])> = data.chunks_mut(BLOCK * d).enumerate().collect();
        let per_thread = blocks.len().div_ceil(threads).max(1);
        let mut groups: Vec<Vec<(usize, &mut [f32])>> = Vec::new();
        let mut it = blocks.into_iter().peekable();
        while it.peek().is_some() {
            groups.push(it.by_ref().take(per_thread).collect());
        }
        std::thread::scope(|scope| {
            for group in groups {
                scope.spawn(move || {
                    for (b, chunk) in group {
                        let mut rng = SplitMix64::new(
                            self.spec.seed
                                ^ stream.wrapping_mul(0xA24B_AED4_963E_E407)
                                ^ (b as u64).wrapping_mul(0x9FB2_1C65_1E98_DF25),
                        );
                        for v in chunk.chunks_mut(d) {
                            self.sample(&mut rng, v);
                        }
                    }
                });
            }
        });
        data
    }
}

#[derive(Clone, Copy)]
struct Hit {
    score: f32,
    id: u32,
}

impl PartialEq for Hit {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Hit {}
impl PartialOrd for Hit {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Hit {
    // Reversed so that `BinaryHeap` is a min-heap on score.
    fn cmp(&self, other: &Self) -> Ordering {
        other.score.total_cmp(&self.score).then_with(|| self.id.cmp(&other.id))
    }
}

/// Exact top-`k` by dot product (cosine for normalised data). Returns row ids
/// ordered by descending score. Parallel and cache-blocked.
pub fn brute_force_topk(base: &[f32], queries: &[f32], dim: usize, k: usize) -> Vec<Vec<u32>> {
    const BASE_BLOCK: usize = 2048;
    let nq = queries.len() / dim;
    let nb = base.len() / dim;
    let threads = std::thread::available_parallelism().map_or(1, |t| t.get());
    let per_thread = nq.div_ceil(threads).max(1);
    let mut results: Vec<Vec<u32>> = vec![Vec::new(); nq];
    std::thread::scope(|scope| {
        for (t, out) in results.chunks_mut(per_thread).enumerate() {
            scope.spawn(move || {
                let q0 = t * per_thread;
                let mut heaps: Vec<BinaryHeap<Hit>> =
                    (0..out.len()).map(|_| BinaryHeap::with_capacity(k + 1)).collect();
                let mut start = 0;
                while start < nb {
                    let end = (start + BASE_BLOCK).min(nb);
                    for (qi, heap) in heaps.iter_mut().enumerate() {
                        let q = &queries[(q0 + qi) * dim..(q0 + qi + 1) * dim];
                        for i in start..end {
                            let score = dot_f32(q, &base[i * dim..(i + 1) * dim]);
                            if heap.len() < k {
                                heap.push(Hit { score, id: i as u32 });
                            } else if heap.peek().is_some_and(|w| score > w.score) {
                                heap.pop();
                                heap.push(Hit { score, id: i as u32 });
                            }
                        }
                    }
                    start = end;
                }
                for (slot, heap) in out.iter_mut().zip(heaps) {
                    *slot = heap.into_sorted_vec().into_iter().map(|h| h.id).collect();
                }
            });
        }
    });
    results
}

/// Mean recall@k: fraction of true neighbours found, averaged over queries.
pub fn recall_at_k(truth: &[Vec<u64>], found: &[Vec<u64>], k: usize) -> f64 {
    if truth.is_empty() {
        return 1.0;
    }
    let mut total = 0f64;
    for (t, f) in truth.iter().zip(found) {
        let t = &t[..k.min(t.len())];
        let hits = f.iter().take(k).filter(|id| t.contains(id)).count();
        total += hits as f64 / t.len().max(1) as f64;
    }
    total / truth.len() as f64
}

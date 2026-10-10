//! Index configuration.

use serde::{Deserialize, Serialize};

use crate::error::{IndexError, Result};

/// Largest supported vector dimension. Keeps i8 dot-product accumulators far
/// from `i32` overflow and bounds per-vector allocations.
pub const MAX_DIM: usize = 65_536;

/// Hard cap on the HNSW level of a node (stored as `u8` on disk).
pub const MAX_LEVEL: usize = 32;

/// Similarity metric.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Metric {
    /// Cosine similarity, computed as a dot product on L2-normalised vectors.
    /// Scores are in `[-1, 1]`, higher is better.
    #[default]
    Cosine,
    /// Squared Euclidean distance. Scores are reported as the *negated*
    /// squared distance so that higher is always better.
    L2,
}

impl Metric {
    pub(crate) fn to_u8(self) -> u8 {
        match self {
            Metric::Cosine => 0,
            Metric::L2 => 1,
        }
    }

    pub(crate) fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Metric::Cosine),
            1 => Some(Metric::L2),
            _ => None,
        }
    }
}

/// Vector representation used during graph traversal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Quantization {
    /// Full-precision f32 vectors are traversed directly.
    None,
    /// Symmetric scalar int8 codes with one f32 scale per vector.
    #[default]
    Int8,
}

impl Quantization {
    pub(crate) fn to_u8(self) -> u8 {
        match self {
            Quantization::None => 0,
            Quantization::Int8 => 1,
        }
    }

    pub(crate) fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Quantization::None),
            1 => Some(Quantization::Int8),
            _ => None,
        }
    }
}

/// HNSW + storage parameters. Every field except `dim` has a default so the
/// struct can be deserialised from a partial JSON object.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct IndexParams {
    /// Vector dimension (required, `1..=MAX_DIM`).
    pub dim: usize,
    pub metric: Metric,
    /// Max links per node on layers >= 1. Layer 0 uses `M0 = 2 * M`.
    pub m: usize,
    /// Candidate list size while inserting.
    pub ef_construction: usize,
    /// Default candidate list size while searching (overridable per query).
    pub ef_search: usize,
    pub quantization: Quantization,
    /// Keep full-precision vectors next to the int8 codes. Required for
    /// rescoring and for lossless `compact()`. Forced on for
    /// `Quantization::None`.
    pub keep_float: bool,
    /// When `keep_float` and int8 traversal are both on, the final candidate
    /// pool of `k * rescore_multiplier` hits is rescored with exact f32
    /// similarities. `0` disables rescoring.
    pub rescore_multiplier: usize,
    /// Algorithm 4 `keepPrunedConnections`: fill the neighbour list back up to
    /// `M` with heuristically pruned candidates.
    pub keep_pruned_connections: bool,
    /// Seed of the level generator.
    pub seed: u64,
    /// Worker threads for `add_batch` (`0` = available parallelism). Not
    /// persisted.
    #[serde(skip_serializing)]
    pub build_threads: usize,
}

impl Default for IndexParams {
    fn default() -> Self {
        Self {
            dim: 0,
            metric: Metric::Cosine,
            m: 16,
            ef_construction: 128,
            ef_search: 128,
            quantization: Quantization::Int8,
            keep_float: true,
            rescore_multiplier: 4,
            keep_pruned_connections: true,
            seed: 0x5EED_B8C1_DE70_0001,
            build_threads: 0,
        }
    }
}

impl IndexParams {
    /// Defaults for a given dimension.
    pub fn new(dim: usize) -> Self {
        Self { dim, ..Self::default() }
    }

    /// Layer-0 connectivity.
    pub fn m0(&self) -> usize {
        self.m * 2
    }

    /// Whether f32 vectors are stored.
    pub fn stores_float(&self) -> bool {
        self.keep_float || self.quantization == Quantization::None
    }

    /// Whether int8 codes are stored.
    pub fn stores_codes(&self) -> bool {
        self.quantization == Quantization::Int8
    }

    /// Whether search rescored with exact vectors by default.
    pub fn rescoring(&self) -> bool {
        self.stores_codes() && self.stores_float() && self.rescore_multiplier > 0
    }

    pub(crate) fn validate(&self) -> Result<()> {
        if self.dim == 0 || self.dim > MAX_DIM {
            return Err(IndexError::InvalidParams(format!(
                "dim must be in 1..={MAX_DIM}, got {}",
                self.dim
            )));
        }
        if !(2..=1024).contains(&self.m) {
            return Err(IndexError::InvalidParams(format!(
                "m must be in 2..=1024, got {}",
                self.m
            )));
        }
        if self.ef_construction == 0 || self.ef_construction > 1 << 20 {
            return Err(IndexError::InvalidParams("ef_construction must be in 1..=1048576".into()));
        }
        if self.ef_search == 0 || self.ef_search > 1 << 20 {
            return Err(IndexError::InvalidParams("ef_search must be in 1..=1048576".into()));
        }
        if self.rescore_multiplier > 1024 {
            return Err(IndexError::InvalidParams("rescore_multiplier must be <= 1024".into()));
        }
        Ok(())
    }

    /// Normalise derived flags (e.g. f32 storage is mandatory without codes).
    pub(crate) fn normalized(mut self) -> Self {
        if self.quantization == Quantization::None {
            self.keep_float = true;
        }
        self
    }
}

/// Per-query overrides.
#[derive(Debug, Clone, Copy, Default)]
pub struct SearchOptions {
    /// Number of results.
    pub k: usize,
    /// Candidate list size; `None` uses `IndexParams::ef_search`.
    pub ef: Option<usize>,
    /// Rescore multiplier; `None` uses `IndexParams::rescore_multiplier`,
    /// `Some(0)` disables rescoring for this query.
    pub rescore_multiplier: Option<usize>,
}

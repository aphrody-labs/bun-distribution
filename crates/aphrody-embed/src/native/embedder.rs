//! Batched, length-bucketed sentence embedding on CPU.

use std::{path::Path, str::FromStr};

use rayon::prelude::*;
use tokenizers::{Encoding, Tokenizer, TruncationDirection, TruncationParams, TruncationStrategy};

#[cfg(feature = "candle")]
use super::candle_backend::CandleBert;
use super::{
    bert::{NativeBert, Sequence},
    error::{Error, Result},
    manifest::{ModelPaths, ModelSpec},
};

/// Whether a text is a search query or an indexed document; selects the model prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TextKind {
    Query,
    #[default]
    Passage,
    /// Text that already carries its model prefix (for example an E5 `query: ` or
    /// `passage: ` string sent by an OpenAI-compatible caller); nothing is prepended.
    Raw,
}

impl FromStr for TextKind {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "query" | "q" => Ok(Self::Query),
            "passage" | "document" | "doc" | "p" | "" => Ok(Self::Passage),
            "raw" | "prefixed" => Ok(Self::Raw),
            other => Err(Error::InvalidInput(format!(
                "unknown text kind `{other}` (expected `query`, `passage` or `raw`)"
            ))),
        }
    }
}

/// Inference engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Backend {
    /// Packed (padding-free) BERT encoder with fused kernels on top of `gemm`. Fastest.
    #[default]
    Native,
    /// `candle-transformers` BERT with padded batches. Reference implementation; requires
    /// the `candle` cargo feature (default).
    Candle,
}

/// Runtime knobs. Zero means "pick the default".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EmbedOptions {
    /// Token budget per text (clamped to the model's `max_seq_len`). 0 = model default.
    pub max_seq_len: usize,
    /// Maximum number of texts in one forward pass. 0 = 32.
    pub batch_size: usize,
    /// Worker threads. 0 = all available cores.
    pub threads: usize,
    pub backend: Backend,
}

pub(crate) const DEFAULT_BATCH_SIZE: usize = 32;

/// Tokens per forward pass above which work is split further. Throughput per CPU-second is
/// flat between 256 and 11k tokens on the reference machine, so the budget is chosen to cap
/// per-thread scratch memory (~4 KiB per token for MiniLM) rather than for speed.
const GROUP_TOKEN_BUDGET: usize = 1024;

enum Engine {
    Native(Box<NativeBert>),
    #[cfg(feature = "candle")]
    Candle(Box<CandleBert>),
}

/// A loaded model ready to embed text. Cheap to share across threads (`Send + Sync`).
pub struct Embedder {
    spec: ModelSpec,
    tokenizer: Tokenizer,
    engine: Engine,
    pool: rayon::ThreadPool,
    max_seq_len: usize,
    batch_size: usize,
    threads: usize,
}

impl std::fmt::Debug for Embedder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Embedder")
            .field("model", &self.spec.id)
            .field("dim", &self.spec.dim)
            .field("max_seq_len", &self.max_seq_len)
            .field("batch_size", &self.batch_size)
            .field("threads", &self.threads)
            .field("backend", &self.backend())
            .finish()
    }
}

impl Embedder {
    /// Load tokenizer, config and safetensors weights (memory-mapped) from `dir`.
    pub fn load(dir: &Path, spec: &ModelSpec, opts: EmbedOptions) -> Result<Self> {
        let paths = ModelPaths::in_dir(dir);
        let engine = match opts.backend {
            Backend::Native => {
                Engine::Native(Box::new(NativeBert::load(&paths.config, &paths.weights)?))
            }
            #[cfg(feature = "candle")]
            Backend::Candle => {
                Engine::Candle(Box::new(CandleBert::load(&paths.config, &paths.weights)?))
            }
            #[cfg(not(feature = "candle"))]
            Backend::Candle => {
                return Err(Error::InvalidInput(
                    "aphrody-embed was built without the `candle` feature".into(),
                ));
            }
        };
        let (max_positions, hidden) = match &engine {
            Engine::Native(model) => (model.dims.max_tokens, model.dims.hidden),
            #[cfg(feature = "candle")]
            Engine::Candle(model) => (model.max_positions, model.hidden),
        };
        if hidden != spec.dim {
            return Err(Error::InvalidInput(format!(
                "{}: checkpoint hidden size {hidden} != manifest dim {}",
                spec.id, spec.dim
            )));
        }
        let max_seq_len = match opts.max_seq_len {
            0 => spec.max_seq_len,
            n => n.min(spec.max_seq_len),
        }
        .min(max_positions);

        let mut tokenizer = Tokenizer::from_file(&paths.tokenizer)
            .map_err(|e| Error::Tokenizer(format!("{}: {e}", paths.tokenizer.display())))?;
        tokenizer
            .with_truncation(Some(TruncationParams {
                direction: TruncationDirection::Right,
                max_length: max_seq_len,
                strategy: TruncationStrategy::LongestFirst,
                stride: 0,
            }))
            .map_err(|e| Error::Tokenizer(e.to_string()))?;
        tokenizer.with_padding(None);

        let threads = resolve_threads(opts.threads);
        let pool = build_pool(threads, "aphrody-embed")?;

        Ok(Self {
            spec: spec.clone(),
            tokenizer,
            engine,
            pool,
            max_seq_len,
            batch_size: if opts.batch_size == 0 {
                DEFAULT_BATCH_SIZE
            } else {
                opts.batch_size
            },
            threads,
        })
    }

    /// Model description this embedder was loaded with.
    pub fn spec(&self) -> &ModelSpec {
        &self.spec
    }

    /// Output dimension.
    pub fn dim(&self) -> usize {
        self.spec.dim
    }

    /// Engine in use.
    pub fn backend(&self) -> Backend {
        match self.engine {
            Engine::Native(_) => Backend::Native,
            #[cfg(feature = "candle")]
            Engine::Candle(_) => Backend::Candle,
        }
    }

    /// Worker threads used for inference.
    pub fn threads(&self) -> usize {
        self.threads
    }

    /// Number of tokens (after truncation, including special tokens) per text.
    pub fn count_tokens(&self, texts: &[&str], kind: TextKind) -> Result<Vec<usize>> {
        let encodings = self.pool.install(|| self.tokenize(texts, kind))?;
        Ok(encodings.iter().map(|e| e.get_ids().len()).collect())
    }

    /// Effective token budget per text.
    pub fn max_seq_len(&self) -> usize {
        self.max_seq_len
    }

    /// Embed `texts`, returning one vector per input in the original order.
    pub fn embed_batch(&self, texts: &[&str], kind: TextKind) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }
        self.pool.install(|| self.embed_in_pool(texts, kind))
    }

    fn embed_in_pool(&self, texts: &[&str], kind: TextKind) -> Result<Vec<Vec<f32>>> {
        let encodings = self.tokenize(texts, kind)?;
        let lens: Vec<usize> = encodings.iter().map(|e| e.get_ids().len()).collect();

        // Longest first: groups hold similar lengths (no padding for the candle backend,
        // balanced work units for the native one).
        let mut order: Vec<usize> = (0..encodings.len()).collect();
        order.sort_by_key(|&i| std::cmp::Reverse(lens[i]));
        let groups = plan_groups(&order, &lens, self.threads, self.batch_size);

        let parallelism = match self.threads / groups.len() {
            0 | 1 => gemm::Parallelism::None,
            n => gemm::Parallelism::Rayon(n),
        };
        let outputs: Vec<Result<Vec<Vec<f32>>>> = groups
            .par_iter()
            .map(|idx| match &self.engine {
                Engine::Native(model) => {
                    let seqs: Vec<Sequence<'_>> = idx
                        .iter()
                        .map(|&i| Sequence::single(encodings[i].get_ids()))
                        .collect();
                    model.embed(&seqs, self.spec.pooling, parallelism)
                }
                #[cfg(feature = "candle")]
                Engine::Candle(model) => model.embed(&encodings, idx, self.spec.pooling),
            })
            .collect();

        let mut result = vec![Vec::new(); texts.len()];
        for (idx, output) in groups.iter().zip(outputs) {
            for (&i, mut vector) in idx.iter().zip(output?) {
                if self.spec.normalize {
                    l2_normalize(&mut vector);
                }
                result[i] = vector;
            }
        }
        Ok(result)
    }

    fn tokenize(&self, texts: &[&str], kind: TextKind) -> Result<Vec<Encoding>> {
        let prefix = match kind {
            TextKind::Query => self.spec.query_prefix.as_str(),
            TextKind::Passage => self.spec.passage_prefix.as_str(),
            TextKind::Raw => "",
        };
        // sentence-transformers strips surrounding whitespace before tokenising; match it
        // (XLM-R/SentencePiece tokenizers would otherwise emit an extra `▁` token).
        let inputs: Vec<String> = texts
            .iter()
            .map(|t| {
                let full = format!("{prefix}{t}");
                match full.trim() {
                    trimmed if trimmed.len() == full.len() => full,
                    trimmed => trimmed.to_string(),
                }
            })
            .collect();
        self.tokenizer
            .encode_batch_fast(inputs, true)
            .map_err(|e| Error::Tokenizer(e.to_string()))
    }
}

/// `0` means all available cores.
pub(crate) fn resolve_threads(threads: usize) -> usize {
    match threads {
        0 => std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1),
        n => n,
    }
}

pub(crate) fn build_pool(threads: usize, name: &'static str) -> Result<rayon::ThreadPool> {
    rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .thread_name(move |i| format!("{name}-{i}"))
        .build()
        .map_err(|e| Error::InvalidInput(format!("thread pool: {e}")))
}

/// Split length-sorted inputs into forward passes of roughly
/// `min(total_tokens / threads, GROUP_TOKEN_BUDGET)` tokens (so every worker gets work and
/// scratch memory stays bounded), never more than `batch_size` texts.
pub(crate) fn plan_groups<'a>(
    order: &'a [usize],
    lens: &[usize],
    threads: usize,
    batch_size: usize,
) -> Vec<&'a [usize]> {
    let total: usize = order.iter().map(|&i| lens[i]).sum();
    let target = total.div_ceil(threads.max(1)).clamp(1, GROUP_TOKEN_BUDGET);
    let mut groups = Vec::new();
    let mut start = 0;
    let mut tokens = 0;
    for (pos, &i) in order.iter().enumerate() {
        tokens += lens[i];
        if tokens >= target || pos + 1 - start == batch_size.max(1) {
            groups.push(&order[start..=pos]);
            start = pos + 1;
            tokens = 0;
        }
    }
    if start < order.len() {
        groups.push(&order[start..]);
    }
    groups
}

/// Scale `v` to unit L2 norm in place (no-op for the zero vector).
pub fn l2_normalize(v: &mut [f32]) {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > f32::EPSILON {
        v.iter_mut().for_each(|x| *x /= norm);
    }
}

/// Cosine similarity of two equally sized vectors.
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na <= f32::EPSILON || nb <= f32::EPSILON {
        0.0
    } else {
        dot / (na * nb)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_send_sync<T: Send + Sync>() {}

    #[test]
    fn embedder_is_send_sync() {
        assert_send_sync::<Embedder>();
    }

    #[test]
    fn groups_cover_every_input_once_and_respect_caps() {
        let lens: Vec<usize> = (0..50).map(|i| 10 + (i * 37) % 200).collect();
        let mut order: Vec<usize> = (0..lens.len()).collect();
        order.sort_by_key(|&i| std::cmp::Reverse(lens[i]));
        for (threads, batch) in [(1, 1), (4, 3), (12, 64), (8, 16)] {
            let groups = plan_groups(&order, &lens, threads, batch);
            let mut seen: Vec<usize> = groups.iter().flat_map(|g| g.iter().copied()).collect();
            seen.sort_unstable();
            assert_eq!(seen, (0..lens.len()).collect::<Vec<_>>());
            assert!(groups.iter().all(|g| !g.is_empty() && g.len() <= batch));
        }
        assert!(plan_groups(&[], &[], 4, 8).is_empty());
    }

    #[test]
    fn text_kind_parsing() {
        assert_eq!("query".parse::<TextKind>().unwrap(), TextKind::Query);
        assert_eq!("Passage".parse::<TextKind>().unwrap(), TextKind::Passage);
        assert_eq!("document".parse::<TextKind>().unwrap(), TextKind::Passage);
        assert_eq!("raw".parse::<TextKind>().unwrap(), TextKind::Raw);
        assert!("image".parse::<TextKind>().is_err());
    }

    #[test]
    fn normalize_and_cosine() {
        let mut v = vec![3.0, 4.0];
        l2_normalize(&mut v);
        assert!((v[0] - 0.6).abs() < 1e-6 && (v[1] - 0.8).abs() < 1e-6);
        assert!((cosine(&[1.0, 0.0], &[2.0, 0.0]) - 1.0).abs() < 1e-6);
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 0.0]), 0.0);
    }
}

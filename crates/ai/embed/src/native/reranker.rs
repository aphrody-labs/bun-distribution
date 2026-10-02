//! Cross-encoder reranking: score (query, passage) pairs with a sequence-classification
//! BERT / XLM-RoBERTa model on the native encoder.

use std::path::Path;

use rayon::prelude::*;
use tokenizers::{
    EncodeInput, Encoding, PostProcessor, Tokenizer, TruncationDirection, TruncationParams,
    TruncationStrategy,
};

use super::{
    bert::{NativeBert, Sequence},
    embedder::{Backend, EmbedOptions, build_pool, plan_groups, resolve_threads},
    error::{Error, Result},
    manifest::{ModelPaths, RerankerSpec, ScoreActivation},
};

/// A loaded cross-encoder. `Send + Sync`; share one instance across threads.
pub struct Reranker {
    spec: RerankerSpec,
    tokenizer: Tokenizer,
    model: NativeBert,
    pool: rayon::ThreadPool,
    max_seq_len: usize,
    batch_size: usize,
    threads: usize,
    /// Special tokens added around a pair (3 for BERT, 4 for XLM-R).
    pair_specials: usize,
}

impl std::fmt::Debug for Reranker {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Reranker")
            .field("model", &self.spec.id)
            .field("max_seq_len", &self.max_seq_len)
            .field("batch_size", &self.batch_size)
            .field("threads", &self.threads)
            .finish()
    }
}

impl Reranker {
    /// Load tokenizer, config and weights (encoder + classification head) from `dir`.
    /// Only [`Backend::Native`] is supported.
    pub fn load(dir: &Path, spec: &RerankerSpec, opts: EmbedOptions) -> Result<Self> {
        if opts.backend != Backend::Native {
            return Err(Error::InvalidInput(
                "the reranker only supports the native backend".into(),
            ));
        }
        let paths = ModelPaths::in_dir(dir);
        let model = NativeBert::load_classifier(&paths.config, &paths.weights)?;
        let max_seq_len = match opts.max_seq_len {
            0 => spec.max_seq_len,
            n => n.min(spec.max_seq_len),
        }
        .min(model.dims.max_tokens);

        let mut tokenizer = Tokenizer::from_file(&paths.tokenizer)
            .map_err(|e| Error::Tokenizer(format!("{}: {e}", paths.tokenizer.display())))?;
        tokenizer
            .with_truncation(Some(TruncationParams {
                direction: TruncationDirection::Right,
                max_length: max_seq_len,
                strategy: TruncationStrategy::OnlySecond,
                stride: 0,
            }))
            .map_err(|e| Error::Tokenizer(e.to_string()))?;
        tokenizer.with_padding(None);
        let pair_specials =
            tokenizer.get_post_processor().map(|p| p.added_tokens(true)).unwrap_or(0);

        let threads = resolve_threads(opts.threads);
        Ok(Self {
            spec: spec.clone(),
            tokenizer,
            model,
            pool: build_pool(threads, "aphrody-rerank")?,
            max_seq_len,
            batch_size: if opts.batch_size == 0 {
                super::embedder::DEFAULT_BATCH_SIZE
            } else {
                opts.batch_size
            },
            threads,
            pair_specials,
        })
    }

    /// Model description this reranker was loaded with.
    pub fn spec(&self) -> &RerankerSpec {
        &self.spec
    }

    /// Effective token budget per (query, passage) pair.
    pub fn max_seq_len(&self) -> usize {
        self.max_seq_len
    }

    /// Relevance score of each passage for `query`, in input order (higher = more
    /// relevant). The spec's activation is applied (raw logits for ms-marco MiniLM).
    ///
    /// Pairs are truncated on the passage side to `max_seq_len`; an over-long query is
    /// first cut to half of the budget.
    pub fn score(&self, query: &str, passages: &[&str]) -> Result<Vec<f32>> {
        if passages.is_empty() {
            return Ok(Vec::new());
        }
        self.pool.install(|| self.score_in_pool(query, passages))
    }

    /// `(index, score)` sorted by descending score.
    pub fn rank(&self, query: &str, passages: &[&str]) -> Result<Vec<(usize, f32)>> {
        let mut ranked: Vec<(usize, f32)> =
            self.score(query, passages)?.into_iter().enumerate().collect();
        ranked.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        Ok(ranked)
    }

    fn score_in_pool(&self, query: &str, passages: &[&str]) -> Result<Vec<f32>> {
        let query = self.fit_query(query.trim())?;
        let inputs: Vec<EncodeInput<'_>> =
            passages.iter().map(|p| EncodeInput::Dual(query.into(), p.trim().into())).collect();
        let encodings: Vec<Encoding> = self
            .tokenizer
            .encode_batch_fast(inputs, true)
            .map_err(|e| Error::Tokenizer(e.to_string()))?;
        let lens: Vec<usize> = encodings.iter().map(|e| e.get_ids().len()).collect();
        let mut order: Vec<usize> = (0..encodings.len()).collect();
        order.sort_by_key(|&i| std::cmp::Reverse(lens[i]));
        let groups = plan_groups(&order, &lens, self.threads, self.batch_size);
        let parallelism = match self.threads / groups.len() {
            0 | 1 => gemm::Parallelism::None,
            n => gemm::Parallelism::Rayon(n),
        };

        let outputs: Vec<Result<Vec<f32>>> = groups
            .par_iter()
            .map(|idx| {
                let seqs: Vec<Sequence<'_>> = idx
                    .iter()
                    .map(|&i| Sequence {
                        ids: encodings[i].get_ids(),
                        type_ids: Some(encodings[i].get_type_ids()),
                    })
                    .collect();
                self.model.classify(&seqs, parallelism)
            })
            .collect();

        let mut scores = vec![0.0f32; passages.len()];
        for (idx, logits) in groups.iter().zip(outputs) {
            for (&i, logit) in idx.iter().zip(logits?) {
                scores[i] = match self.spec.activation {
                    ScoreActivation::Identity => logit,
                    ScoreActivation::Sigmoid => 1.0 / (1.0 + (-logit).exp()),
                };
            }
        }
        Ok(scores)
    }

    /// `OnlySecond` truncation fails when the query alone exceeds the budget; keep the
    /// query to at most half of it so passages always get room.
    fn fit_query<'q>(&self, query: &'q str) -> Result<&'q str> {
        let limit = (self.max_seq_len.saturating_sub(self.pair_specials) / 2).max(1);
        let mut text = query;
        loop {
            match self.tokenizer.encode_fast(text, false) {
                Ok(encoding) if encoding.get_ids().len() <= limit => return Ok(text),
                Ok(encoding) => {
                    let end = encoding.get_offsets()[limit - 1].1;
                    return Ok(text.get(..end).unwrap_or(text));
                },
                // Longer than the whole budget: the single-sequence encode itself refuses
                // to truncate, so halve the text and retry.
                Err(_) if text.len() > 1 => {
                    let mut end = text.len() / 2;
                    while !text.is_char_boundary(end) {
                        end -= 1;
                    }
                    text = &text[..end];
                },
                Err(e) => return Err(Error::Tokenizer(e.to_string())),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reranker_is_send_sync() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<Reranker>();
    }
}

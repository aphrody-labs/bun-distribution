//! Native BERT-family encoder (BERT, XLM-RoBERTa) specialised for sentence embeddings and
//! cross-encoder scoring on CPU.
//!
//! Differences from a generic tensor implementation (all numerically equivalent to the
//! Hugging Face / sentence-transformers forward pass):
//! - Sequences are *packed* (no padding): linear layers run on the concatenation of all tokens of a
//!   micro-batch and self-attention runs per sequence, so no work is wasted on pad tokens and no
//!   attention mask is needed.
//! - Q, K and V projections are fused into one matrix multiplication.
//! - Matrix multiplications use `gemm` (candle's CPU matmul backend) with explicit control over
//!   intra-op threading; element-wise ops are fused, in-place, SIMD-dispatched kernels.
//! - Scratch buffers are reused per worker thread; the word-embedding table stays memory-mapped
//!   (only rows that are looked up are paged in).

use std::{cell::Cell, fs::File, path::Path};

use gemm::Parallelism;
use memmap2::Mmap;
use safetensors::{Dtype, SafeTensors};
use serde::Deserialize;

use super::{
    error::{Error, Result},
    kernels,
    manifest::Pooling,
};

#[derive(Debug, Deserialize)]
struct BertJsonConfig {
    hidden_size: usize,
    num_hidden_layers: usize,
    num_attention_heads: usize,
    intermediate_size: usize,
    #[serde(default = "default_act")]
    hidden_act: String,
    #[serde(default = "default_eps")]
    layer_norm_eps: f64,
    max_position_embeddings: usize,
    vocab_size: usize,
    #[serde(default = "default_type_vocab")]
    type_vocab_size: usize,
    #[serde(default)]
    pad_token_id: usize,
    #[serde(default)]
    model_type: Option<String>,
    #[serde(default)]
    position_embedding_type: Option<String>,
}

fn default_act() -> String {
    "gelu".to_string()
}

fn default_eps() -> f64 {
    1e-12
}

fn default_type_vocab() -> usize {
    2
}

/// Shape hyper-parameters of a loaded encoder.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Dims {
    pub hidden: usize,
    pub heads: usize,
    pub head_dim: usize,
    pub inter: usize,
    pub layers: usize,
    pub max_positions: usize,
    /// First position id (0 for BERT, `pad_token_id + 1` for RoBERTa-style models).
    pub position_offset: usize,
    /// Longest sequence the position table can encode.
    pub max_tokens: usize,
    pub vocab: usize,
    pub type_vocab: usize,
    pub eps: f32,
}

/// One tokenised input. `type_ids = None` means segment 0 everywhere.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Sequence<'a> {
    pub ids: &'a [u32],
    pub type_ids: Option<&'a [u32]>,
}

impl<'a> Sequence<'a> {
    pub(crate) fn single(ids: &'a [u32]) -> Self {
        Self {
            ids,
            type_ids: None,
        }
    }
}

/// Sequence-classification head: `out(tanh(dense(h_cls)))`.
///
/// Covers both `BertForSequenceClassification` (`pooler.dense` + `classifier`) and
/// `XLMRobertaForSequenceClassification` (`classifier.dense` + `classifier.out_proj`).
struct ClassifierHead {
    dense_w: Vec<f32>,
    dense_b: Vec<f32>,
    out_w: Vec<f32>,
    out_b: Vec<f32>,
}

struct Layer {
    qkv_w: Vec<f32>,
    qkv_b: Vec<f32>,
    out_w: Vec<f32>,
    out_b: Vec<f32>,
    ln1_g: Vec<f32>,
    ln1_b: Vec<f32>,
    up_w: Vec<f32>,
    up_b: Vec<f32>,
    down_w: Vec<f32>,
    down_b: Vec<f32>,
    ln2_g: Vec<f32>,
    ln2_b: Vec<f32>,
}

/// Row-addressable f32 matrix living inside the memory-mapped safetensors file.
struct MappedRows {
    map: Mmap,
    offset: usize,
    rows: usize,
    cols: usize,
}

impl MappedRows {
    #[inline]
    fn add_row_into(&self, row: usize, dst: &mut [f32]) {
        let start = self.offset + row * self.cols * 4;
        let bytes = &self.map[start..start + self.cols * 4];
        for (d, v) in dst.iter_mut().zip(le_f32(bytes)) {
            *d += v;
        }
    }
}

pub(crate) struct NativeBert {
    pub dims: Dims,
    word: MappedRows,
    positions: Vec<f32>,
    token_types: Vec<f32>,
    emb_ln_g: Vec<f32>,
    emb_ln_b: Vec<f32>,
    layers: Vec<Layer>,
    head: Option<ClassifierHead>,
}

impl NativeBert {
    /// Load the encoder only (sentence embeddings).
    pub(crate) fn load(config_path: &Path, weights_path: &Path) -> Result<Self> {
        Self::load_impl(config_path, weights_path, false)
    }

    /// Load the encoder plus its single-logit sequence-classification head (cross-encoders).
    pub(crate) fn load_classifier(config_path: &Path, weights_path: &Path) -> Result<Self> {
        Self::load_impl(config_path, weights_path, true)
    }

    fn load_impl(config_path: &Path, weights_path: &Path, classifier: bool) -> Result<Self> {
        let text = std::fs::read_to_string(config_path).map_err(|e| Error::io(config_path, e))?;
        let cfg: BertJsonConfig = serde_json::from_str(&text)?;
        if cfg.hidden_act != "gelu" {
            return Err(Error::InvalidInput(format!(
                "unsupported hidden_act `{}` (native encoder implements `gelu`)",
                cfg.hidden_act
            )));
        }
        if let Some(kind) = cfg.position_embedding_type.as_deref()
            && kind != "absolute"
        {
            return Err(Error::InvalidInput(format!(
                "unsupported position_embedding_type `{kind}`"
            )));
        }
        if !cfg.hidden_size.is_multiple_of(cfg.num_attention_heads) {
            return Err(Error::InvalidInput(
                "hidden_size not divisible by heads".into(),
            ));
        }
        // RoBERTa-style models number positions from `padding_idx + 1`.
        let position_offset = match cfg.model_type.as_deref() {
            Some("roberta" | "xlm-roberta" | "camembert") => cfg.pad_token_id + 1,
            _ => 0,
        };
        if position_offset >= cfg.max_position_embeddings {
            return Err(Error::InvalidInput("position offset exceeds table".into()));
        }
        let dims = Dims {
            hidden: cfg.hidden_size,
            heads: cfg.num_attention_heads,
            head_dim: cfg.hidden_size / cfg.num_attention_heads,
            inter: cfg.intermediate_size,
            layers: cfg.num_hidden_layers,
            max_positions: cfg.max_position_embeddings,
            position_offset,
            max_tokens: cfg.max_position_embeddings - position_offset,
            vocab: cfg.vocab_size,
            type_vocab: cfg.type_vocab_size.max(1),
            eps: cfg.layer_norm_eps as f32,
        };

        let file = File::open(weights_path).map_err(|e| Error::io(weights_path, e))?;
        // SAFETY: the file is opened read-only and installed atomically by `ensure_model`;
        // it must not be truncated while the embedder is alive.
        let map = unsafe { Mmap::map(&file) }.map_err(|e| Error::io(weights_path, e))?;
        let st = SafeTensors::deserialize(&map)
            .map_err(|e| Error::InvalidInput(format!("safetensors: {e}")))?;
        let prefix = ["", "bert.", "roberta."]
            .into_iter()
            .find(|p| {
                st.tensor(&format!("{p}embeddings.word_embeddings.weight"))
                    .is_ok()
            })
            .ok_or_else(|| {
                Error::InvalidInput("no `embeddings.word_embeddings.weight` tensor".into())
            })?;
        let get_abs = |full: &str, shape: &[usize]| -> Result<Vec<f32>> {
            let view = st
                .tensor(full)
                .map_err(|e| Error::InvalidInput(format!("tensor `{full}`: {e}")))?;
            check_view(full, view.dtype(), view.shape(), shape)?;
            Ok(le_f32(view.data()).collect())
        };
        let get = |name: &str, shape: &[usize]| get_abs(&format!("{prefix}{name}"), shape);

        let h = dims.hidden;
        let word_name = format!("{prefix}embeddings.word_embeddings.weight");
        let word_view = st
            .tensor(&word_name)
            .map_err(|e| Error::InvalidInput(format!("tensor `{word_name}`: {e}")))?;
        check_view(
            &word_name,
            word_view.dtype(),
            word_view.shape(),
            &[dims.vocab, h],
        )?;
        let word_offset = word_view.data().as_ptr() as usize - map.as_ptr() as usize;

        let positions = get(
            "embeddings.position_embeddings.weight",
            &[dims.max_positions, h],
        )?;
        let token_types = get(
            "embeddings.token_type_embeddings.weight",
            &[dims.type_vocab, h],
        )?;
        let emb_ln_g = get("embeddings.LayerNorm.weight", &[h])?;
        let emb_ln_b = get("embeddings.LayerNorm.bias", &[h])?;

        let mut layers = Vec::with_capacity(dims.layers);
        for i in 0..dims.layers {
            let p = |s: &str| format!("encoder.layer.{i}.{s}");
            let mut qkv_w = get(&p("attention.self.query.weight"), &[h, h])?;
            qkv_w.extend(get(&p("attention.self.key.weight"), &[h, h])?);
            qkv_w.extend(get(&p("attention.self.value.weight"), &[h, h])?);
            let mut qkv_b = get(&p("attention.self.query.bias"), &[h])?;
            qkv_b.extend(get(&p("attention.self.key.bias"), &[h])?);
            qkv_b.extend(get(&p("attention.self.value.bias"), &[h])?);
            layers.push(Layer {
                qkv_w,
                qkv_b,
                out_w: get(&p("attention.output.dense.weight"), &[h, h])?,
                out_b: get(&p("attention.output.dense.bias"), &[h])?,
                ln1_g: get(&p("attention.output.LayerNorm.weight"), &[h])?,
                ln1_b: get(&p("attention.output.LayerNorm.bias"), &[h])?,
                up_w: get(&p("intermediate.dense.weight"), &[dims.inter, h])?,
                up_b: get(&p("intermediate.dense.bias"), &[dims.inter])?,
                down_w: get(&p("output.dense.weight"), &[h, dims.inter])?,
                down_b: get(&p("output.dense.bias"), &[h])?,
                ln2_g: get(&p("output.LayerNorm.weight"), &[h])?,
                ln2_b: get(&p("output.LayerNorm.bias"), &[h])?,
            });
        }
        let head = if classifier {
            let (dense, out) = if st.tensor("classifier.out_proj.weight").is_ok() {
                ("classifier.dense".to_string(), "classifier.out_proj")
            } else {
                (format!("{prefix}pooler.dense"), "classifier")
            };
            let out_b = st
                .tensor(&format!("{out}.bias"))
                .map_err(|e| Error::InvalidInput(format!("classifier head `{out}`: {e}")))?;
            if out_b.shape() != [1] {
                return Err(Error::InvalidInput(format!(
                    "classifier head has {:?} labels; only single-logit rerankers are supported",
                    out_b.shape()
                )));
            }
            Some(ClassifierHead {
                dense_w: get_abs(&format!("{dense}.weight"), &[h, h])?,
                dense_b: get_abs(&format!("{dense}.bias"), &[h])?,
                out_w: get_abs(&format!("{out}.weight"), &[1, h])?,
                out_b: get_abs(&format!("{out}.bias"), &[1])?,
            })
        } else {
            None
        };
        drop(st);

        Ok(Self {
            dims,
            word: MappedRows {
                map,
                offset: word_offset,
                rows: dims.vocab,
                cols: h,
            },
            positions,
            token_types,
            emb_ln_g,
            emb_ln_b,
            layers,
            head,
        })
    }

    /// Encode a group of token sequences and pool each into one (unnormalised) vector.
    pub(crate) fn embed(
        &self,
        seqs: &[Sequence<'_>],
        pooling: Pooling,
        parallelism: Parallelism,
    ) -> Result<Vec<Vec<f32>>> {
        self.validate(seqs)?;
        let h = self.dims.hidden;
        Ok(self.with_hidden(seqs, parallelism, |x| {
            let mut out = Vec::with_capacity(seqs.len());
            let mut start = 0;
            for seq in seqs {
                let len = seq.ids.len();
                let tokens = &x[start * h..(start + len) * h];
                out.push(match pooling {
                    Pooling::Cls => tokens[..h].to_vec(),
                    Pooling::Mean => {
                        let mut acc = vec![0.0f32; h];
                        for tok in tokens.chunks_exact(h) {
                            acc.iter_mut().zip(tok).for_each(|(a, t)| *a += t);
                        }
                        let inv = 1.0 / len as f32;
                        acc.iter_mut().for_each(|a| *a *= inv);
                        acc
                    }
                });
                start += len;
            }
            out
        }))
    }

    /// Run the encoder and the classification head; one raw logit per sequence.
    pub(crate) fn classify(
        &self,
        seqs: &[Sequence<'_>],
        parallelism: Parallelism,
    ) -> Result<Vec<f32>> {
        let head = self
            .head
            .as_ref()
            .ok_or_else(|| Error::InvalidInput("model loaded without a classifier head".into()))?;
        self.validate(seqs)?;
        let h = self.dims.hidden;
        Ok(self.with_hidden(seqs, parallelism, |x| {
            let mut cls = Vec::with_capacity(seqs.len() * h);
            let mut start = 0;
            for seq in seqs {
                cls.extend_from_slice(&x[start * h..(start + 1) * h]);
                start += seq.ids.len();
            }
            let mut pooled = vec![0.0f32; cls.len()];
            kernels::linear(
                &mut pooled,
                &cls,
                &head.dense_w,
                &head.dense_b,
                Parallelism::None,
            );
            pooled.iter_mut().for_each(|v| *v = v.tanh());
            let mut logits = vec![0.0f32; seqs.len()];
            kernels::linear(
                &mut logits,
                &pooled,
                &head.out_w,
                &head.out_b,
                Parallelism::None,
            );
            logits
        }))
    }

    fn validate(&self, seqs: &[Sequence<'_>]) -> Result<()> {
        let d = self.dims;
        for seq in seqs {
            if seq.ids.is_empty() || seq.ids.len() > d.max_tokens {
                return Err(Error::InvalidInput(format!(
                    "sequence length {} outside 1..={}",
                    seq.ids.len(),
                    d.max_tokens
                )));
            }
            if let Some(bad) = seq.ids.iter().find(|&&id| id as usize >= self.word.rows) {
                return Err(Error::InvalidInput(format!("token id {bad} >= vocab")));
            }
            if let Some(types) = seq.type_ids {
                if types.len() != seq.ids.len() {
                    return Err(Error::InvalidInput("type_ids length mismatch".into()));
                }
                // Models without segment embeddings (XLM-R: type_vocab_size = 1) get 0.
                if d.type_vocab > 1
                    && let Some(bad) = types.iter().find(|&&t| t as usize >= d.type_vocab)
                {
                    return Err(Error::InvalidInput(format!("type id {bad} >= type vocab")));
                }
            }
        }
        Ok(())
    }

    /// Run the encoder on packed `seqs` and hand the `tokens x hidden` states to `read`.
    fn with_hidden<R>(
        &self,
        seqs: &[Sequence<'_>],
        parallelism: Parallelism,
        read: impl FnOnce(&[f32]) -> R,
    ) -> R {
        // Take this thread's scratch buffers for the duration of the pass. If rayon
        // work-stealing re-enters on the same thread (while a nested parallel gemm call
        // waits), the inner pass gets fresh buffers instead of aliasing ours.
        let mut ws = WORKSPACE.take();
        let total = self.forward(&mut ws, seqs, parallelism);
        let result = read(&ws.x[..total * self.dims.hidden]);
        WORKSPACE.set(ws);
        result
    }

    /// Encoder forward pass; returns the number of packed tokens written to `ws.x`.
    fn forward(
        &self,
        ws: &mut Workspace,
        seqs: &[Sequence<'_>],
        parallelism: Parallelism,
    ) -> usize {
        let d = self.dims;
        let total: usize = seqs.iter().map(|s| s.ids.len()).sum();
        let max_len = seqs.iter().map(|s| s.ids.len()).max().unwrap_or(0);
        let h = d.hidden;
        let x = grow(&mut ws.x, total * h);
        let qkv = grow(&mut ws.qkv, total * 3 * h);
        let ctx = grow(&mut ws.ctx, total * h);
        let tmp = grow(&mut ws.tmp, total * h);
        let up = grow(&mut ws.up, total * d.inter);
        let scores = grow(&mut ws.scores, max_len * max_len);

        // Embeddings: word + position + token type, then LayerNorm.
        let mut row = 0;
        for seq in seqs {
            for (pos, &id) in seq.ids.iter().enumerate() {
                let p = d.position_offset + pos;
                let t = match seq.type_ids {
                    Some(types) if d.type_vocab > 1 => types[pos] as usize,
                    _ => 0,
                };
                let dst = &mut x[row * h..(row + 1) * h];
                for ((o, pe), te) in dst
                    .iter_mut()
                    .zip(&self.positions[p * h..(p + 1) * h])
                    .zip(&self.token_types[t * h..(t + 1) * h])
                {
                    *o = pe + te;
                }
                self.word.add_row_into(id as usize, dst);
                row += 1;
            }
        }
        kernels::layer_norm(x, &self.emb_ln_g, &self.emb_ln_b, d.eps);

        let scale = 1.0 / (d.head_dim as f32).sqrt();
        for layer in &self.layers {
            kernels::linear(qkv, x, &layer.qkv_w, &layer.qkv_b, parallelism);
            self.attention(seqs, qkv, ctx, scores, scale);
            kernels::linear(tmp, ctx, &layer.out_w, &layer.out_b, parallelism);
            kernels::add_layer_norm(x, tmp, &layer.ln1_g, &layer.ln1_b, d.eps);
            kernels::linear(up, x, &layer.up_w, &layer.up_b, parallelism);
            kernels::gelu(up);
            kernels::linear(tmp, up, &layer.down_w, &layer.down_b, parallelism);
            kernels::add_layer_norm(x, tmp, &layer.ln2_g, &layer.ln2_b, d.eps);
        }
        total
    }

    /// Multi-head self-attention per packed sequence: `ctx = softmax(QK^T / sqrt(d)) V`.
    fn attention(
        &self,
        seqs: &[Sequence<'_>],
        qkv: &[f32],
        ctx: &mut [f32],
        scores: &mut [f32],
        scale: f32,
    ) {
        let d = self.dims;
        let (h, hd) = (d.hidden, d.head_dim);
        let stride = 3 * h;
        let mut start = 0;
        for seq in seqs {
            let len = seq.ids.len();
            let scores = &mut scores[..len * len];
            for head in 0..d.heads {
                let head_off = head * hd;
                // SAFETY: every strided access stays inside `qkv[start*3h .. (start+len)*3h]`,
                // `scores[..len*len]` and `ctx[start*h .. (start+len)*h]`:
                // max Q index = start*3h + head_off + (len-1)*3h + hd-1, likewise for K/V
                // (offset by h / 2h) and ctx (row stride h, column < hd).
                unsafe {
                    let base = qkv.as_ptr().add(start * stride);
                    gemm::gemm(
                        len,
                        len,
                        hd,
                        scores.as_mut_ptr(),
                        1,
                        len as isize,
                        false,
                        base.add(head_off),
                        1,
                        stride as isize,
                        base.add(h + head_off),
                        stride as isize,
                        1,
                        0.0,
                        scale,
                        false,
                        false,
                        false,
                        Parallelism::None,
                    );
                    kernels::softmax_rows(scores, len);
                    gemm::gemm(
                        len,
                        hd,
                        len,
                        ctx.as_mut_ptr().add(start * h + head_off),
                        1,
                        h as isize,
                        false,
                        scores.as_ptr(),
                        1,
                        len as isize,
                        base.add(2 * h + head_off),
                        1,
                        stride as isize,
                        0.0,
                        1.0,
                        false,
                        false,
                        false,
                        Parallelism::None,
                    );
                }
            }
            start += len;
        }
    }
}

fn check_view(name: &str, dtype: Dtype, shape: &[usize], want: &[usize]) -> Result<()> {
    if dtype != Dtype::F32 {
        return Err(Error::InvalidInput(format!(
            "tensor `{name}` has dtype {dtype:?}; only F32 checkpoints are supported"
        )));
    }
    if shape != want {
        return Err(Error::InvalidInput(format!(
            "tensor `{name}` has shape {shape:?}, expected {want:?}"
        )));
    }
    Ok(())
}

/// Decode little-endian f32 values (safetensors byte order) without alignment assumptions.
#[inline]
fn le_f32(bytes: &[u8]) -> impl Iterator<Item = f32> + '_ {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
}

#[derive(Default)]
struct Workspace {
    x: Vec<f32>,
    qkv: Vec<f32>,
    ctx: Vec<f32>,
    tmp: Vec<f32>,
    up: Vec<f32>,
    scores: Vec<f32>,
}

thread_local! {
    static WORKSPACE: Cell<Workspace> = Cell::new(Workspace::default());
}

fn grow(buf: &mut Vec<f32>, len: usize) -> &mut [f32] {
    if buf.len() < len {
        buf.resize(len, 0.0);
    }
    &mut buf[..len]
}

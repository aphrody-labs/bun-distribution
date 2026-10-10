//! Reference backend: `candle-transformers` BERT with padded batches.
//!
//! Slower than the native encoder (generic tensor ops, padding, per-op allocation) but
//! independent from it, which makes it a useful cross-check. Enabled by the `candle`
//! cargo feature (on by default).

use std::path::Path;

use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use tokenizers::Encoding;

use super::{
    error::{Error, Result},
    manifest::Pooling,
};

pub(crate) struct CandleBert {
    model: BertModel,
    device: Device,
    pub max_positions: usize,
    pub hidden: usize,
}

impl CandleBert {
    pub(crate) fn load(config_path: &Path, weights_path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(config_path).map_err(|e| Error::io(config_path, e))?;
        let config: Config = serde_json::from_str(&text)?;
        let device = Device::Cpu;
        // SAFETY: the weights file is only read; it is installed atomically by
        // `ensure_model` and must not be modified while mapped.
        let vb =
            unsafe { VarBuilder::from_mmaped_safetensors(&[weights_path], DType::F32, &device)? };
        Ok(Self {
            model: BertModel::load(vb, &config)?,
            device,
            max_positions: config.max_position_embeddings,
            hidden: config.hidden_size,
        })
    }

    /// Pad `idx` sequences to their longest member, run BERT, pool (unnormalised).
    pub(crate) fn embed(
        &self,
        encodings: &[Encoding],
        idx: &[usize],
        pooling: Pooling,
    ) -> Result<Vec<Vec<f32>>> {
        let batch = idx.len();
        let seq_len = idx.iter().map(|&i| encodings[i].get_ids().len()).max().unwrap_or(0).max(1);

        let mut ids = vec![0u32; batch * seq_len];
        let mut mask = vec![0u32; batch * seq_len];
        for (row, &i) in idx.iter().enumerate() {
            let enc = &encodings[i];
            let n = enc.get_ids().len();
            ids[row * seq_len..row * seq_len + n].copy_from_slice(enc.get_ids());
            mask[row * seq_len..row * seq_len + n].copy_from_slice(enc.get_attention_mask());
        }
        let ids = Tensor::from_vec(ids, (batch, seq_len), &self.device)?;
        let mask = Tensor::from_vec(mask, (batch, seq_len), &self.device)?;
        let type_ids = ids.zeros_like()?;

        let hidden = self.model.forward(&ids, &type_ids, Some(&mask))?;
        let pooled = match pooling {
            Pooling::Cls => hidden.narrow(1, 0, 1)?.squeeze(1)?,
            Pooling::Mean => {
                let m = mask.to_dtype(DType::F32)?.unsqueeze(2)?;
                let summed = hidden.broadcast_mul(&m)?.sum(1)?;
                let counts = m.sum(1)?.clamp(1e-9f32, f32::MAX)?;
                summed.broadcast_div(&counts)?
            },
        };
        Ok(pooled.to_vec2::<f32>()?)
    }
}

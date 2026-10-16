// SPDX-License-Identifier: Apache-2.0
//! CMS (Character Model Spec) binary format parser.

use crate::game::error::{ReError, Result};
use serde::{Deserialize, Serialize};

pub const CMS_MAGIC: &[u8; 4] = b"#CMS";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CmsEntry {
    pub id: u32,
    pub short_name: String, // e.g. "GOK", "VGT", "BDK"
    pub model_path_id: u32,
    pub voice_id: u32,
    pub skeleton_id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CmsFile {
    pub entries: Vec<CmsEntry>,
}

impl CmsFile {
    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 16 {
            return Err(ReError::BufferTooSmall { required: 16, available: buffer.len() });
        }

        if &buffer[0..4] != CMS_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: CMS_MAGIC.to_vec(),
                found: buffer[0..4].to_vec(),
            });
        }

        let count = u32::from_le_bytes(buffer[8..12].try_into().unwrap()) as usize;
        let offset = u32::from_le_bytes(buffer[12..16].try_into().unwrap()) as usize;

        let entry_size = 32;
        let mut entries = Vec::with_capacity(count);

        for i in 0..count {
            let start = offset + (i * entry_size);
            if start + entry_size > buffer.len() {
                break;
            }
            let slice = &buffer[start..start + entry_size];

            let id = u32::from_le_bytes(slice[0..4].try_into().unwrap());
            let raw_name = &slice[4..8];
            let short_name = String::from_utf8_lossy(raw_name).trim_matches('\0').to_string();
            let model_path_id = u32::from_le_bytes(slice[8..12].try_into().unwrap());
            let voice_id = u32::from_le_bytes(slice[12..16].try_into().unwrap());
            let skeleton_id = u32::from_le_bytes(slice[16..20].try_into().unwrap());

            entries.push(CmsEntry { id, short_name, model_path_id, voice_id, skeleton_id });
        }

        Ok(Self { entries })
    }
}

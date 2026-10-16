// SPDX-License-Identifier: Apache-2.0
//! BAC (Battle Action Code) parser.
//!
//! Stores moveset frame-data: startup frames, active frames, recovery,
//! hitboxes, collision boxes, and invincibility windows.

use crate::game::error::{ReError, Result};
use serde::{Deserialize, Serialize};

pub const BAC_MAGIC: &[u8; 4] = b"#BAC";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacHitbox {
    pub start_frame: u16,
    pub end_frame: u16,
    pub damage: u32,
    pub bdm_entry_id: u16,
    pub knockback_type: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacMove {
    pub move_id: u32,
    pub total_frames: u16,
    pub startup_frames: u16,
    pub recovery_frames: u16,
    pub hitboxes: Vec<BacHitbox>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacFile {
    pub moves: Vec<BacMove>,
}

impl BacFile {
    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 16 {
            return Err(ReError::BufferTooSmall { required: 16, available: buffer.len() });
        }

        if &buffer[0..4] != BAC_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: BAC_MAGIC.to_vec(),
                found: buffer[0..4].to_vec(),
            });
        }

        let count = u32::from_le_bytes(buffer[8..12].try_into().unwrap()) as usize;
        let mut moves = Vec::with_capacity(count);

        let entry_size = 32;
        let offset = 16;
        for i in 0..count {
            let start = offset + (i * entry_size);
            if start + entry_size > buffer.len() {
                break;
            }
            let slice = &buffer[start..start + entry_size];

            let move_id = u32::from_le_bytes(slice[0..4].try_into().unwrap());
            let total_frames = u16::from_le_bytes(slice[4..6].try_into().unwrap());
            let startup_frames = u16::from_le_bytes(slice[6..8].try_into().unwrap());
            let recovery_frames = u16::from_le_bytes(slice[8..10].try_into().unwrap());

            moves.push(BacMove {
                move_id,
                total_frames,
                startup_frames,
                recovery_frames,
                hitboxes: Vec::new(),
            });
        }

        Ok(Self { moves })
    }

    /// Helper to construct a synthetic BAC binary buffer for testing.
    pub fn create_mock(move_count: usize) -> Vec<u8> {
        let mut buffer = Vec::new();
        buffer.extend_from_slice(BAC_MAGIC);
        buffer.extend_from_slice(&1u32.to_le_bytes()); // version
        buffer.extend_from_slice(&(move_count as u32).to_le_bytes()); // count
        buffer.extend_from_slice(&16u32.to_le_bytes()); // offset = 16

        for i in 0..move_count {
            let mut entry = [0u8; 32];
            let move_id = (200 + i) as u32;
            let total_frames = 45u16;
            let startup_frames = 10u16;
            let recovery_frames = 15u16;

            entry[0..4].copy_from_slice(&move_id.to_le_bytes());
            entry[4..6].copy_from_slice(&total_frames.to_le_bytes());
            entry[6..8].copy_from_slice(&startup_frames.to_le_bytes());
            entry[8..10].copy_from_slice(&recovery_frames.to_le_bytes());

            buffer.extend_from_slice(&entry);
        }

        buffer
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_bac_mock() {
        let mock = BacFile::create_mock(10);
        let parsed = BacFile::parse(&mock).expect("Should parse BAC mock cleanly");

        assert_eq!(parsed.moves.len(), 10);
        assert_eq!(parsed.moves[0].move_id, 200);
        assert_eq!(parsed.moves[0].total_frames, 45);
        assert_eq!(parsed.moves[0].startup_frames, 10);
        assert_eq!(parsed.moves[9].move_id, 209);
    }

    #[test]
    fn test_invalid_magic() {
        let mut mock = BacFile::create_mock(2);
        mock[0] = b'!';
        assert!(BacFile::parse(&mock).is_err());
    }
}

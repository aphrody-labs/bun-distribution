// SPDX-License-Identifier: Apache-2.0
//! PUP (Power-Up Parameters) binary format parser.
//!
//! Stores exact transformation and power-up stat multipliers:
//! Attack, Ki Blast, Strike, Defense, Movement Speeds, and Ki/Stamina drain rates.

use crate::game::error::{ReError, Result};
use serde::{Deserialize, Serialize};

pub const PUP_MAGIC: &[u8; 4] = b"#PUP";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PupEntry {
    pub id: u32,
    pub basic_attack_mult: f32,
    pub basic_ki_mult: f32,
    pub strike_mult: f32,
    pub ki_blast_mult: f32,
    pub damage_taken_mult: f32,
    pub speed_ground_mult: f32,
    pub speed_air_mult: f32,
    pub speed_boost_mult: f32,
    pub ki_drain_rate: f32,
    pub stamina_drain_rate: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PupFile {
    pub entries: Vec<PupEntry>,
}

impl PupFile {
    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 16 {
            return Err(ReError::BufferTooSmall { required: 16, available: buffer.len() });
        }

        if &buffer[0..4] != PUP_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: PUP_MAGIC.to_vec(),
                found: buffer[0..4].to_vec(),
            });
        }

        let count = u32::from_le_bytes(buffer[8..12].try_into().unwrap()) as usize;
        let offset = u32::from_le_bytes(buffer[12..16].try_into().unwrap()) as usize;

        let entry_size = 64; // Standard PUP entry byte stride
        let mut entries = Vec::with_capacity(count);

        for i in 0..count {
            let start = offset + (i * entry_size);
            if start + entry_size > buffer.len() {
                break;
            }
            let slice = &buffer[start..start + entry_size];

            let id = u32::from_le_bytes(slice[0..4].try_into().unwrap());
            let basic_attack_mult = f32::from_le_bytes(slice[4..8].try_into().unwrap());
            let basic_ki_mult = f32::from_le_bytes(slice[8..12].try_into().unwrap());
            let strike_mult = f32::from_le_bytes(slice[12..16].try_into().unwrap());
            let ki_blast_mult = f32::from_le_bytes(slice[16..20].try_into().unwrap());
            let damage_taken_mult = f32::from_le_bytes(slice[20..24].try_into().unwrap());
            let speed_ground_mult = f32::from_le_bytes(slice[24..28].try_into().unwrap());
            let speed_air_mult = f32::from_le_bytes(slice[28..32].try_into().unwrap());
            let speed_boost_mult = f32::from_le_bytes(slice[32..36].try_into().unwrap());
            let ki_drain_rate = f32::from_le_bytes(slice[36..40].try_into().unwrap());
            let stamina_drain_rate = f32::from_le_bytes(slice[40..44].try_into().unwrap());

            entries.push(PupEntry {
                id,
                basic_attack_mult,
                basic_ki_mult,
                strike_mult,
                ki_blast_mult,
                damage_taken_mult,
                speed_ground_mult,
                speed_air_mult,
                speed_boost_mult,
                ki_drain_rate,
                stamina_drain_rate,
            });
        }

        Ok(Self { entries })
    }

    /// Helper to construct a synthetic PUP binary buffer for testing.
    pub fn create_mock(entry_count: usize) -> Vec<u8> {
        let mut buffer = Vec::new();
        buffer.extend_from_slice(PUP_MAGIC);
        buffer.extend_from_slice(&1u32.to_le_bytes()); // version
        buffer.extend_from_slice(&(entry_count as u32).to_le_bytes()); // count
        buffer.extend_from_slice(&16u32.to_le_bytes()); // offset = 16

        for i in 0..entry_count {
            let mut entry = [0u8; 64];
            let id = (300 + i) as u32;
            let mult = 1.0f32 + (i as f32 * 0.05);

            entry[0..4].copy_from_slice(&id.to_le_bytes());
            entry[4..8].copy_from_slice(&mult.to_le_bytes()); // basic_attack_mult
            entry[8..12].copy_from_slice(&mult.to_le_bytes()); // basic_ki_mult
            entry[12..16].copy_from_slice(&mult.to_le_bytes()); // strike_mult
            entry[16..20].copy_from_slice(&mult.to_le_bytes()); // ki_blast_mult
            entry[20..24].copy_from_slice(&1.0f32.to_le_bytes()); // damage_taken_mult
            entry[24..28].copy_from_slice(&1.1f32.to_le_bytes()); // speed_ground_mult
            entry[28..32].copy_from_slice(&1.15f32.to_le_bytes()); // speed_air_mult
            entry[32..36].copy_from_slice(&1.2f32.to_le_bytes()); // speed_boost_mult
            entry[36..40].copy_from_slice(&0.0f32.to_le_bytes()); // ki_drain_rate
            entry[40..44].copy_from_slice(&0.0f32.to_le_bytes()); // stamina_drain_rate

            buffer.extend_from_slice(&entry);
        }

        buffer
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_pup_mock() {
        let mock = PupFile::create_mock(8);
        let parsed = PupFile::parse(&mock).expect("Should parse PUP mock cleanly");

        assert_eq!(parsed.entries.len(), 8);
        assert_eq!(parsed.entries[0].id, 300);
        assert_eq!(parsed.entries[0].basic_attack_mult, 1.0);
        assert_eq!(parsed.entries[7].id, 307);
    }

    #[test]
    fn test_invalid_magic() {
        let mut mock = PupFile::create_mock(1);
        mock[0] = b'Z';
        assert!(PupFile::parse(&mock).is_err());
    }
}

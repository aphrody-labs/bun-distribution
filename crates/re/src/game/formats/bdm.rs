// SPDX-License-Identifier: Apache-2.0
//! BDM (Battle Damage Matrix) binary format parser.
//!
//! Stores damage values, impact types, physical knockback, hitstun,
//! blockstun, and camera effects referenced by BAC attack animations.

use crate::game::error::{ReError, Result};
use serde::{Deserialize, Serialize};

pub const BDM_MAGIC: &[u8; 4] = b"#BDM";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DamageType {
    Strike = 0,
    KiBlast = 1,
    HeavyStrike = 2,
    Grab = 3,
    Unblockable = 4,
    Special = 5,
    Unknown = 255,
}

impl From<u16> for DamageType {
    fn from(val: u16) -> Self {
        match val {
            0 => Self::Strike,
            1 => Self::KiBlast,
            2 => Self::HeavyStrike,
            3 => Self::Grab,
            4 => Self::Unblockable,
            5 => Self::Special,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BdmEntry {
    pub id: u32,
    pub damage_type: DamageType,
    pub base_damage: u32,
    pub stamina_damage: u16,
    pub hitstun_frames: u16,
    pub blockstun_frames: u16,
    pub knockback_type: u16,
    pub knockback_strength: f32,
    pub pushback_distance: f32,
    pub camera_shake: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BdmFile {
    pub entries: Vec<BdmEntry>,
}

impl BdmFile {
    /// Parses a BDM binary file.
    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 16 {
            return Err(ReError::BufferTooSmall {
                required: 16,
                available: buffer.len(),
            });
        }

        if &buffer[0..4] != BDM_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: BDM_MAGIC.to_vec(),
                found: buffer[0..4].to_vec(),
            });
        }

        let count = u32::from_le_bytes(buffer[8..12].try_into().unwrap()) as usize;
        let offset = u32::from_le_bytes(buffer[12..16].try_into().unwrap()) as usize;

        let entry_size = 48; // Standard BDM entry stride
        let mut entries = Vec::with_capacity(count);

        for i in 0..count {
            let start = offset + (i * entry_size);
            if start + entry_size > buffer.len() {
                break;
            }
            let slice = &buffer[start..start + entry_size];

            let id = u32::from_le_bytes(slice[0..4].try_into().unwrap());
            let damage_type_raw = u16::from_le_bytes(slice[4..6].try_into().unwrap());
            let stamina_damage = u16::from_le_bytes(slice[6..8].try_into().unwrap());
            let base_damage = u32::from_le_bytes(slice[8..12].try_into().unwrap());
            let hitstun_frames = u16::from_le_bytes(slice[12..14].try_into().unwrap());
            let blockstun_frames = u16::from_le_bytes(slice[14..16].try_into().unwrap());
            let knockback_type = u16::from_le_bytes(slice[16..18].try_into().unwrap());
            let camera_shake = u16::from_le_bytes(slice[18..20].try_into().unwrap());
            let knockback_strength = f32::from_le_bytes(slice[20..24].try_into().unwrap());
            let pushback_distance = f32::from_le_bytes(slice[24..28].try_into().unwrap());

            entries.push(BdmEntry {
                id,
                damage_type: DamageType::from(damage_type_raw),
                base_damage,
                stamina_damage,
                hitstun_frames,
                blockstun_frames,
                knockback_type,
                knockback_strength,
                pushback_distance,
                camera_shake,
            });
        }

        Ok(Self { entries })
    }

    /// Helper to construct a synthetic BDM binary buffer for testing.
    pub fn create_mock(entry_count: usize) -> Vec<u8> {
        let mut buffer = Vec::new();
        buffer.extend_from_slice(BDM_MAGIC);
        buffer.extend_from_slice(&1u32.to_le_bytes()); // version
        buffer.extend_from_slice(&(entry_count as u32).to_le_bytes()); // count
        buffer.extend_from_slice(&16u32.to_le_bytes()); // offset = 16

        for i in 0..entry_count {
            let mut entry = [0u8; 48];
            let id = (100 + i) as u32;
            let dmg_type = (i % 6) as u16;
            let stamina_dmg = 50u16;
            let base_damage = ((i + 1) * 250) as u32;
            let hitstun = 15u16;
            let blockstun = 10u16;
            let knockback = (i % 4) as u16;
            let camera_shake = 2u16;
            let knockback_strength = 5.0f32;
            let pushback_distance = 2.5f32;

            entry[0..4].copy_from_slice(&id.to_le_bytes());
            entry[4..6].copy_from_slice(&dmg_type.to_le_bytes());
            entry[6..8].copy_from_slice(&stamina_dmg.to_le_bytes());
            entry[8..12].copy_from_slice(&base_damage.to_le_bytes());
            entry[12..14].copy_from_slice(&hitstun.to_le_bytes());
            entry[14..16].copy_from_slice(&blockstun.to_le_bytes());
            entry[16..18].copy_from_slice(&knockback.to_le_bytes());
            entry[18..20].copy_from_slice(&camera_shake.to_le_bytes());
            entry[20..24].copy_from_slice(&knockback_strength.to_le_bytes());
            entry[24..28].copy_from_slice(&pushback_distance.to_le_bytes());

            buffer.extend_from_slice(&entry);
        }

        buffer
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_bdm_mock() {
        let mock = BdmFile::create_mock(25);
        let parsed = BdmFile::parse(&mock).expect("Should parse BDM mock cleanly");

        assert_eq!(parsed.entries.len(), 25);
        assert_eq!(parsed.entries[0].id, 100);
        assert_eq!(parsed.entries[0].damage_type, DamageType::Strike);
        assert_eq!(parsed.entries[0].base_damage, 250);
        assert_eq!(parsed.entries[1].damage_type, DamageType::KiBlast);
        assert_eq!(parsed.entries[1].base_damage, 500);
        assert_eq!(parsed.entries[24].id, 124);
    }

    #[test]
    fn test_invalid_magic() {
        let mut mock = BdmFile::create_mock(5);
        mock[0] = b'X';
        assert!(BdmFile::parse(&mock).is_err());
    }

    #[test]
    fn test_buffer_too_small() {
        let small = [0u8; 10];
        assert!(BdmFile::parse(&small).is_err());
    }
}

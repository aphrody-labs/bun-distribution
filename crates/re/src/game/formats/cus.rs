// SPDX-License-Identifier: Apache-2.0
//! CUS (Character Ultimate Skill) binary format parser.
//!
//! Stores skill definitions, Ki/Stamina consumption, categories (Super, Ultimate, Evasive, Awoken),
//! and asset links for Xenoverse 2 techniques.

use crate::game::error::{ReError, Result};
use serde::{Deserialize, Serialize};

pub const CUS_MAGIC: &[u8; 4] = b"#CUS";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SkillCategory {
    Super = 0,
    Ultimate = 1,
    Evasive = 2,
    Awoken = 3,
    Unknown = 255,
}

impl From<u16> for SkillCategory {
    fn from(val: u16) -> Self {
        match val {
            0 => Self::Super,
            1 => Self::Ultimate,
            2 => Self::Evasive,
            3 => Self::Awoken,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CusSkill {
    pub id: u32,
    pub category: SkillCategory,
    pub ki_cost: u32,
    pub stamina_cost: u32,
    pub name_id: u32,
    pub desc_id: u32,
    pub animation_id: u32,
    pub particle_id: u32,
    pub sound_id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CusFile {
    pub version: u32,
    pub skills: Vec<CusSkill>,
}

impl CusFile {
    /// Parses a CUS binary file.
    pub fn parse(buffer: &[u8]) -> Result<Self> {
        if buffer.len() < 16 {
            return Err(ReError::BufferTooSmall { required: 16, available: buffer.len() });
        }

        if &buffer[0..4] != CUS_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: CUS_MAGIC.to_vec(),
                found: buffer[0..4].to_vec(),
            });
        }

        let version = u32::from_le_bytes(buffer[4..8].try_into().unwrap());
        let count = u32::from_le_bytes(buffer[8..12].try_into().unwrap()) as usize;
        let offset = u32::from_le_bytes(buffer[12..16].try_into().unwrap()) as usize;

        let mut skills = Vec::with_capacity(count);
        let entry_size = 48; // Standard Xenoverse 2 CUS skill entry length

        for i in 0..count {
            let start = offset + (i * entry_size);
            if start + entry_size > buffer.len() {
                break;
            }
            let slice = &buffer[start..start + entry_size];

            let id = u32::from_le_bytes(slice[0..4].try_into().unwrap());
            let cat_raw = u16::from_le_bytes(slice[4..6].try_into().unwrap());
            let ki_cost = u32::from_le_bytes(slice[8..12].try_into().unwrap());
            let stamina_cost = u32::from_le_bytes(slice[12..16].try_into().unwrap());
            let name_id = u32::from_le_bytes(slice[16..20].try_into().unwrap());
            let desc_id = u32::from_le_bytes(slice[20..24].try_into().unwrap());
            let animation_id = u32::from_le_bytes(slice[24..28].try_into().unwrap());
            let particle_id = u32::from_le_bytes(slice[28..32].try_into().unwrap());
            let sound_id = u32::from_le_bytes(slice[32..36].try_into().unwrap());

            skills.push(CusSkill {
                id,
                category: SkillCategory::from(cat_raw),
                ki_cost,
                stamina_cost,
                name_id,
                desc_id,
                animation_id,
                particle_id,
                sound_id,
            });
        }

        Ok(Self { version, skills })
    }

    /// Helper to construct a synthetic CUS binary buffer with `count` skills.
    pub fn create_mock(skill_count: usize) -> Vec<u8> {
        let mut buffer = Vec::new();
        buffer.extend_from_slice(CUS_MAGIC);
        buffer.extend_from_slice(&1u32.to_le_bytes()); // version 1
        buffer.extend_from_slice(&(skill_count as u32).to_le_bytes()); // count
        buffer.extend_from_slice(&16u32.to_le_bytes()); // offset = 16

        for i in 0..skill_count {
            let mut entry = [0u8; 48];
            let id = (1000 + i) as u32;
            let cat = (i % 4) as u16; // Super, Ultimate, Evasive, Awoken
            let ki_cost = (i as u32 % 5) * 100;
            let stamina_cost = if cat == 2 { 300u32 } else { 0u32 };

            entry[0..4].copy_from_slice(&id.to_le_bytes());
            entry[4..6].copy_from_slice(&cat.to_le_bytes());
            entry[8..12].copy_from_slice(&ki_cost.to_le_bytes());
            entry[12..16].copy_from_slice(&stamina_cost.to_le_bytes());
            entry[16..20].copy_from_slice(&(id * 10).to_le_bytes()); // name_id
            entry[20..24].copy_from_slice(&(id * 10 + 1).to_le_bytes()); // desc_id

            buffer.extend_from_slice(&entry);
        }

        buffer
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_708_skills() {
        let mock_cus = CusFile::create_mock(708);
        let parsed = CusFile::parse(&mock_cus).expect("Should parse 708 skills cleanly");

        assert_eq!(parsed.skills.len(), 708);
        assert_eq!(parsed.skills[0].id, 1000);
        assert_eq!(parsed.skills[0].category, SkillCategory::Super);
        assert_eq!(parsed.skills[1].category, SkillCategory::Ultimate);
        assert_eq!(parsed.skills[2].category, SkillCategory::Evasive);
        assert_eq!(parsed.skills[3].category, SkillCategory::Awoken);
        assert_eq!(parsed.skills[707].id, 1707);
    }
}


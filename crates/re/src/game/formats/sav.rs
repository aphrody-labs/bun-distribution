// SPDX-License-Identifier: Apache-2.0
//! DBXV2 Savegame file parser and structures.
//!
//! Provides inspection of Xenoverse 2 save containers, player Create-a-Character (CaC)
//! rosters, level, attribute allocations, Zeni, and TP Medals.

use crate::game::error::{ReError, Result};
use serde::{Deserialize, Serialize};

/// Encrypted container magic: `0x4C018948`.
pub const ENCRYPTED_SAV_SIGNATURE: u32 = 0x4C018948;

/// Decrypted body magic: `#SAV` (0x56415323 in little-endian).
pub const DECRYPTED_SAV_MAGIC: [u8; 4] = *b"#SAV";

pub const XV2_NUM_CAC: usize = 8;
pub const FIRST_CAC_OFFSET: usize = 0x1E830;
pub const CACS_DISTANCE: usize = 0xC6C8;
pub const CAC_SIZE: usize = 0x3D0;

pub const OFF_ZENI: usize = 0x2C;
pub const OFF_TP_MEDALS: usize = 0x30;

pub const RACES: [&str; 8] = [
    "Human (Male)",
    "Human (Female)",
    "Saiyan (Male)",
    "Saiyan (Female)",
    "Namekian",
    "Frieza Race",
    "Majin (Male)",
    "Majin (Female)",
];

/// A single Create-a-Character (CaC) entry from a DBXV2 save file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dxbv2Cac {
    pub slot: usize,
    pub name: String,
    pub race_id: u8,
    pub race_name: String,
    pub voice: u8,
    pub body_shape: u8,
    pub level: u32,
    pub experience: u32,
    pub attribute_points: u32,
    pub health: u32,
    pub ki: u32,
    pub stamina: u32,
    pub basic_atk: u32,
    pub strike_super: u32,
    pub blast_super: u32,
}

/// Parsed DBXV2 Savegame representation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Dxbv2Save {
    pub is_encrypted_envelope: bool,
    pub signature: String,
    pub zeni: u32,
    pub tp_medals: u32,
    pub active_cacs_count: usize,
    pub cacs: Vec<Dxbv2Cac>,
}

impl Dxbv2Save {
    /// Parse a decrypted DBXV2 savegame body (beginning with `#SAV`).
    pub fn parse_decrypted(data: &[u8]) -> Result<Self> {
        if data.len() < 0x20000 {
            return Err(ReError::BufferTooSmall {
                required: 0x20000,
                available: data.len(),
            });
        }

        if data[0..4] != DECRYPTED_SAV_MAGIC {
            return Err(ReError::InvalidMagic {
                expected: DECRYPTED_SAV_MAGIC.to_vec(),
                found: data[0..4.min(data.len())].to_vec(),
            });
        }

        let zeni = read_u32_le(data, OFF_ZENI)?;
        let tp_medals = read_u32_le(data, OFF_TP_MEDALS)?;

        let mut cacs = Vec::with_capacity(XV2_NUM_CAC);
        for slot in 0..XV2_NUM_CAC {
            let offset = FIRST_CAC_OFFSET + (slot * CACS_DISTANCE);
            if offset + CAC_SIZE > data.len() {
                break;
            }

            let cac_slice = &data[offset..offset + CAC_SIZE];
            if let Some(cac) = parse_cac_slot(slot, cac_slice) {
                cacs.push(cac);
            }
        }

        let active_cacs_count = cacs.len();

        Ok(Self {
            is_encrypted_envelope: false,
            signature: "#SAV".into(),
            zeni,
            tp_medals,
            active_cacs_count,
            cacs,
        })
    }

    /// Check if buffer starts with the encrypted container header.
    pub fn is_encrypted_header(data: &[u8]) -> bool {
        if data.len() < 4 {
            return false;
        }
        let sig = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        sig == ENCRYPTED_SAV_SIGNATURE
    }
}

fn parse_cac_slot(slot: usize, buf: &[u8]) -> Option<Dxbv2Cac> {
    if buf.len() < CAC_SIZE {
        return None;
    }

    // Name is 64 bytes UTF-8 null-terminated at offset 0x44
    let name_bytes = &buf[0x44..0x44 + 64];
    let null_pos = name_bytes.iter().position(|&b| b == 0).unwrap_or(64);
    let name = String::from_utf8_lossy(&name_bytes[..null_pos])
        .trim()
        .to_string();

    if name.is_empty() {
        return None;
    }

    let race_id = buf[0x14];
    let voice = buf[0x18];
    let body_shape = buf[0x1C];

    let race_name = if (race_id as usize) < RACES.len() {
        RACES[race_id as usize].to_string()
    } else {
        format!("Unknown ({})", race_id)
    };

    let level = read_u32_le(buf, 0xAC).unwrap_or(1);
    let experience = read_u32_le(buf, 0xB0).unwrap_or(0);
    let attribute_points = read_u32_le(buf, 0xB4).unwrap_or(0);
    let health = read_u32_le(buf, 0xB8).unwrap_or(0);
    let ki = read_u32_le(buf, 0xBC).unwrap_or(0);
    let basic_atk = read_u32_le(buf, 0xC0).unwrap_or(0);
    let strike_super = read_u32_le(buf, 0xC4).unwrap_or(0);
    let blast_super = read_u32_le(buf, 0xC8).unwrap_or(0);
    let stamina = read_u32_le(buf, 0xCC).unwrap_or(0);

    Some(Dxbv2Cac {
        slot,
        name,
        race_id,
        race_name,
        voice,
        body_shape,
        level,
        experience,
        attribute_points,
        health,
        ki,
        stamina,
        basic_atk,
        strike_super,
        blast_super,
    })
}

fn read_u32_le(data: &[u8], offset: usize) -> Result<u32> {
    if offset + 4 > data.len() {
        return Err(ReError::BufferTooSmall {
            required: offset + 4,
            available: data.len(),
        });
    }
    Ok(u32::from_le_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_decrypted_mock_save() {
        let mut buf = vec![0u8; 0x30000];
        buf[0..4].copy_from_slice(b"#SAV");
        buf[OFF_ZENI..OFF_ZENI + 4].copy_from_slice(&12_345_678u32.to_le_bytes());
        buf[OFF_TP_MEDALS..OFF_TP_MEDALS + 4].copy_from_slice(&9_999u32.to_le_bytes());

        // CaC 0
        let cac_off = FIRST_CAC_OFFSET;
        let cac_name = b"Son Gohan\0";
        buf[cac_off + 0x44..cac_off + 0x44 + cac_name.len()].copy_from_slice(cac_name);
        buf[cac_off + 0x14] = 2; // Saiyan (Male)
        buf[cac_off + 0xAC..cac_off + 0xAC + 4].copy_from_slice(&120u32.to_le_bytes()); // Level 120
        buf[cac_off + 0xB8..cac_off + 0xB8 + 4].copy_from_slice(&200u32.to_le_bytes()); // Health
        buf[cac_off + 0xC0..cac_off + 0xC0 + 4].copy_from_slice(&125u32.to_le_bytes()); // Basic ATK

        let save = Dxbv2Save::parse_decrypted(&buf).expect("should parse mock save");
        assert_eq!(save.zeni, 12_345_678);
        assert_eq!(save.tp_medals, 9_999);
        assert_eq!(save.active_cacs_count, 1);
        assert_eq!(save.cacs[0].name, "Son Gohan");
        assert_eq!(save.cacs[0].race_name, "Saiyan (Male)");
        assert_eq!(save.cacs[0].level, 120);
        assert_eq!(save.cacs[0].health, 200);
        assert_eq!(save.cacs[0].basic_atk, 125);
    }
}

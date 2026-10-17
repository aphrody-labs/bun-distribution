// SPDX-License-Identifier: Apache-2.0
//! Encrypted DBXV2 save container (`DBXV2.sav`): decryption, re-encryption and field editing.
//!
//! Port of the dbxv2 Python `sav` module (itself derived from eternity_common `Xv2SavFile`).
//! The PC container is a two-layer AES-256-CTR envelope: a 0x80-byte header encrypted with a
//! static key/IV that carries the body key/IV and eight checksums, an MD5 over the encrypted
//! header and body, then the body itself, which starts with `#SAV`. Every field offset below is
//! relative to the decrypted body.

use std::{
    collections::BTreeMap,
    time::{SystemTime, UNIX_EPOCH},
};

use aes::{
    Aes256, Block,
    cipher::{BlockCipherEncrypt, KeyInit},
};
use md5::{Digest as _, Md5};
use serde::Serialize;
use sha2::Sha256;

use super::sav::{CACS_DISTANCE, ENCRYPTED_SAV_SIGNATURE, FIRST_CAC_OFFSET, RACES, XV2_NUM_CAC};
use crate::game::error::{ReError, Result};

const STATIC_KEY: &[u8; 32] = b"PR]-<Q9*WxHsV8rcW!JuH7k_ug:T5ApX";
const STATIC_IV: &[u8; 16] = b"_Y7]mD1ziyH#Ar=0";
const STEAM_ID_KEY: u64 = 0x7468_6562_6563_6F6E;

/// Known save versions as `(version, encrypted size, decrypted size)`.
const SIZES: [(i32, usize, usize); 4] = [
    (1, 0x7B440, 0x7B390),
    (8, 0xB08C0, 0xB0818),
    (17, 0xDF2A0, 0xDF1F8),
    (20, 0x12A2A0, 0x12A1F8),
];

/// Named global fields of the body.
pub const GLOBALS: [(&str, usize); 2] = [("zeni", 0x2C), ("tp_medals", 0x30)];

/// Per-CaC `u32` fields, relative to the CaC slot.
pub const CAC_FIELDS: [(&str, usize); 12] = [
    ("race", 0x14),
    ("voice", 0x18),
    ("body_shape", 0x1C),
    ("level", 0xAC),
    ("experience", 0xB0),
    ("attribute_points", 0xB4),
    ("hea", 0xB8),
    ("ki", 0xBC),
    ("atk", 0xC0),
    ("str", 0xC4),
    ("bla", 0xC8),
    ("stm", 0xCC),
];
const CAC_STATS: [&str; 9] =
    ["level", "experience", "attribute_points", "hea", "ki", "atk", "str", "bla", "stm"];
const CAC_NAME_OFFSET: usize = 0x44;

const ITEM_SIZE: usize = 8;
const INVENTORY_MAX: usize = 512;
/// Inventory categories; an entry is `(id: u32, flag: u8, quantity: u16, flag: u8)`.
pub const INVENTORY: [(&str, usize); 10] = [
    ("top", 5136),
    ("bottom", 9232),
    ("gloves", 13328),
    ("shoes", 17424),
    ("accessories", 21520),
    ("supersoul", 25616),
    ("mix", 29712),
    ("important", 33808),
    ("capsules", 37904),
    ("qqbangs", 42000),
];

const SKILL_SIZE: usize = 8;
const SKILL_COUNT: usize = 1024;
/// Owned-skill categories; an entry is `(unlocked: u8, pad: u8, id1: u16, type: u16, id2: u16)`.
pub const SKILLS: [(&str, usize); 6] = [
    ("super", 46128),
    ("ultimate", 54320),
    ("evasive", 62512),
    ("unk3", 70704),
    ("blast", 78896),
    ("awoken", 87088),
];

/// Decrypted, editable and re-encryptable DBXV2 save.
#[derive(Debug, Clone)]
pub struct SaveFile {
    pub body: Vec<u8>,
    /// Save layout version, `-1` for a decrypted body of unknown size.
    pub version: i32,
}

/// JSON summary written by `sav info` / `sav dump`, same shape as the Python `sav.json`.
#[derive(Debug, Clone, Serialize)]
pub struct SaveReport {
    pub version: i32,
    pub decrypted_size: usize,
    pub steam_id: u64,
    pub zeni: u32,
    pub tp_medals: u32,
    pub inventory_counts: BTreeMap<&'static str, usize>,
    pub skill_counts: BTreeMap<&'static str, usize>,
    pub cacs: Vec<CacReport>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CacReport {
    pub name: String,
    pub race: String,
    #[serde(flatten)]
    pub stats: BTreeMap<&'static str, u32>,
}

fn corrupt(details: impl Into<String>) -> ReError {
    ReError::ParseError { context: "dbxv2_sav", details: details.into() }
}

/// AES-256-CTR with a 128-bit big-endian counter (symmetric: encrypts and decrypts).
fn aes_ctr(data: &mut [u8], key: &[u8], iv: &[u8]) {
    let cipher = Aes256::new_from_slice(key).expect("AES-256 key is 32 bytes");
    let mut counter = [0u8; 16];
    counter.copy_from_slice(iv);
    for chunk in data.chunks_mut(16) {
        let mut block = Block::from(counter);
        cipher.encrypt_block(&mut block);
        for (value, mask) in chunk.iter_mut().zip(block.iter()) {
            *value ^= mask;
        }
        for index in (0..16).rev() {
            counter[index] = counter[index].wrapping_add(1);
            if counter[index] != 0 {
                break;
            }
        }
    }
}

fn u32_at(data: &[u8], offset: usize) -> Result<u32> {
    data.get(offset..offset + 4)
        .map(|bytes| u32::from_le_bytes(bytes.try_into().expect("four bytes")))
        .ok_or(ReError::BufferTooSmall { required: offset + 4, available: data.len() })
}

/// 128 unpredictable-enough header bytes (the body key/IV live in the header itself, so they
/// only need to differ between saves, not to stay secret).
fn header_noise(body: &[u8]) -> [u8; 0x80] {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |time| time.as_nanos());
    let mut seed = Sha256::new();
    sha2::Digest::update(&mut seed, nanos.to_le_bytes());
    sha2::Digest::update(&mut seed, std::process::id().to_le_bytes());
    sha2::Digest::update(&mut seed, Sha256::digest(body));
    let mut state: [u8; 32] = sha2::Digest::finalize(seed).into();
    let mut out = [0u8; 0x80];
    for chunk in out.chunks_mut(32) {
        state = Sha256::digest(state).into();
        chunk.copy_from_slice(&state[..chunk.len()]);
    }
    out
}

impl SaveFile {
    /// Decrypt a `.sav` container, or accept an already decrypted body (starting with `#SAV`).
    pub fn decrypt(raw: &[u8]) -> Result<Self> {
        if raw.starts_with(b"#SAV") {
            let version = SIZES
                .iter()
                .find(|(_, _, decrypted)| *decrypted == raw.len())
                .map_or(-1, |(version, _, _)| *version);
            return Ok(Self { body: raw.to_vec(), version });
        }
        let version = SIZES
            .iter()
            .find(|(_, encrypted, _)| *encrypted == raw.len())
            .map(|(version, _, _)| *version)
            .ok_or_else(|| corrupt(format!("unknown encrypted size 0x{:X}", raw.len())))?;
        let data_size = u32_at(raw, 8)? as usize;
        let signed = raw.get(0x20..0x20 + data_size).ok_or_else(|| corrupt("data size"))?;
        if Md5::digest(signed).as_slice() != &raw[0x10..0x20] {
            return Err(corrupt("MD5 mismatch (corrupted file?)"));
        }
        let mut header = raw[0x20..0xA0].to_vec();
        aes_ctr(&mut header, STATIC_KEY, STATIC_IV);
        if !header.starts_with(b"#SAV") {
            return Err(corrupt("header signature missing after decryption"));
        }
        // Header offsets are absolute container offsets minus 0x20.
        let (key, iv) = if header[0x05] & 4 != 0 {
            (&header[0x4C..0x6C], &header[0x6C..0x7C])
        } else {
            (&header[0x1C..0x3C], &header[0x3C..0x4C])
        };
        let mut body = raw
            .get(0xA0..0xA0 + data_size.saturating_sub(0x80))
            .ok_or_else(|| corrupt("body range"))?
            .to_vec();
        aes_ctr(&mut body, key, iv);
        if !body.starts_with(b"#SAV") {
            return Err(corrupt("body signature missing after decryption"));
        }
        Ok(Self { body, version })
    }

    /// Re-encrypt the body into a valid container (fresh key/IV, MD5 and checksums).
    pub fn encrypt(&self) -> Result<Vec<u8>> {
        let (_, encrypted_size, decrypted_size) = SIZES
            .iter()
            .copied()
            .find(|(version, _, _)| *version == self.version)
            .ok_or_else(|| corrupt(format!("cannot encrypt unknown version {}", self.version)))?;
        if self.body.len() != decrypted_size {
            return Err(corrupt(format!(
                "body size 0x{:X} != expected 0x{decrypted_size:X} (v{})",
                self.body.len(),
                self.version
            )));
        }
        let size = decrypted_size + 0x80 + if self.version == 1 { 0x30 } else { 0x28 };
        let mut buf = vec![0u8; size];
        buf[0xA0..0xA0 + decrypted_size].copy_from_slice(&self.body);
        buf[0x20..0xA0].copy_from_slice(&header_noise(&self.body));
        buf[0x25] = 0x34; // bit 2: body key at 0x6C, IV at 0x8C

        let stride_sum = |buf: &[u8], start: usize, count: usize, step: usize| -> u8 {
            (0..count).fold(0u8, |acc, index| acc.wrapping_add(buf[start + index * step]))
        };
        let body_sum = |buf: &[u8]| -> u8 {
            (0..decrypted_size)
                .step_by(0x20)
                .fold(0u8, |acc, index| acc.wrapping_add(buf[0xA0 + index]))
        };
        buf[0x3A] = body_sum(&buf);
        let key = buf[0x6C..0x8C].to_vec();
        let iv = buf[0x8C..0x9C].to_vec();
        aes_ctr(&mut buf[0xA0..0xA0 + decrypted_size], &key, &iv);

        buf[0x35] = stride_sum(&buf, 0x26, 14, 1);
        buf[0x36] = stride_sum(&buf, 0x3C, 8, 4);
        buf[0x37] = stride_sum(&buf, 0x6C, 8, 4);
        buf[0x38] = stride_sum(&buf, 0x5C, 4, 4);
        buf[0x39] = stride_sum(&buf, 0x8C, 4, 4);
        buf[0x3B] = body_sum(&buf);
        buf[0x34] = buf[0x25].wrapping_add(stride_sum(&buf, 0x35, 7, 1));

        buf[0x20..0x24].copy_from_slice(b"#SAV");
        buf[0x24] = 0;
        buf[0x9C..0xA0].copy_from_slice(&(decrypted_size as u32).to_le_bytes());
        aes_ctr(&mut buf[0x20..0xA0], STATIC_KEY, STATIC_IV);

        buf[0..4].copy_from_slice(&ENCRYPTED_SAV_SIGNATURE.to_le_bytes());
        buf[4..8].copy_from_slice(&(encrypted_size as u32).to_le_bytes());
        buf[8..12].copy_from_slice(&((decrypted_size + 0x80) as u32).to_le_bytes());
        let digest = Md5::digest(&buf[0x20..0x20 + decrypted_size + 0x80]);
        buf[0x10..0x20].copy_from_slice(&digest);
        Ok(buf)
    }

    pub fn u32(&self, offset: usize) -> Result<u32> {
        u32_at(&self.body, offset)
    }

    pub fn set_u32(&mut self, offset: usize, value: u32) -> Result<()> {
        let available = self.body.len();
        let slot = self
            .body
            .get_mut(offset..offset + 4)
            .ok_or(ReError::BufferTooSmall { required: offset + 4, available })?;
        slot.copy_from_slice(&value.to_le_bytes());
        Ok(())
    }

    pub fn steam_id(&self) -> Result<u64> {
        let bytes = self.body.get(8..16).ok_or_else(|| corrupt("steam id range"))?;
        Ok(u64::from_le_bytes(bytes.try_into().expect("eight bytes")) ^ STEAM_ID_KEY)
    }

    pub fn global_offset(name: &str) -> Option<usize> {
        GLOBALS.iter().find(|(field, _)| *field == name).map(|(_, offset)| *offset)
    }

    fn cac_base(slot: usize) -> Result<usize> {
        if slot >= XV2_NUM_CAC {
            return Err(corrupt(format!("CaC slot {slot} out of range 0-{}", XV2_NUM_CAC - 1)));
        }
        Ok(FIRST_CAC_OFFSET + slot * CACS_DISTANCE)
    }

    fn cac_field_offset(field: &str) -> Result<usize> {
        CAC_FIELDS
            .iter()
            .find(|(name, _)| *name == field)
            .map(|(_, offset)| *offset)
            .ok_or_else(|| corrupt(format!("unknown CaC field `{field}`")))
    }

    pub fn cac_get(&self, slot: usize, field: &str) -> Result<u32> {
        self.u32(Self::cac_base(slot)? + Self::cac_field_offset(field)?)
    }

    pub fn cac_set(&mut self, slot: usize, field: &str, value: u32) -> Result<()> {
        self.set_u32(Self::cac_base(slot)? + Self::cac_field_offset(field)?, value)
    }

    pub fn cac_name(&self, slot: usize) -> Result<String> {
        let start = Self::cac_base(slot)? + CAC_NAME_OFFSET;
        let raw = self.body.get(start..start + 64).ok_or_else(|| corrupt("CaC name range"))?;
        let end = raw.iter().position(|&byte| byte == 0).unwrap_or(raw.len());
        Ok(String::from_utf8_lossy(&raw[..end]).into_owned())
    }

    pub fn cac_valid(&self, slot: usize) -> Result<bool> {
        let base = Self::cac_base(slot)?;
        Ok(self.body.get(base + CAC_NAME_OFFSET).is_some_and(|&byte| byte != 0)
            && (self.cac_get(slot, "race")? as usize) < RACES.len())
    }

    /// Zero a whole CaC slot so the game treats it as never used.
    pub fn clear_cac(&mut self, slot: usize) -> Result<()> {
        let base = Self::cac_base(slot)?;
        let available = self.body.len();
        self.body
            .get_mut(base..base + CACS_DISTANCE)
            .ok_or(ReError::BufferTooSmall { required: base + CACS_DISTANCE, available })?
            .fill(0);
        Ok(())
    }

    fn inventory_ids(&self, base: usize) -> impl Iterator<Item = (usize, u32)> + '_ {
        (0..INVENTORY_MAX).filter_map(move |index| {
            let offset = base + index * ITEM_SIZE;
            u32_at(&self.body, offset).ok().filter(|id| *id != 0).map(|id| (offset, id))
        })
    }

    fn skill_slots(&self, base: usize) -> impl Iterator<Item = usize> + '_ {
        (0..SKILL_COUNT).map(move |index| base + index * SKILL_SIZE).filter(|&offset| {
            let head = u32_at(&self.body, offset).map_or(u32::MAX, |value| value);
            head != u32::MAX && self.body.get(offset + 4).is_some_and(|&byte| byte != 255)
        })
    }

    /// Set the quantity of every owned item to `quantity`.
    pub fn max_items(&mut self, quantity: u16) {
        let offsets: Vec<usize> = INVENTORY
            .iter()
            .flat_map(|(_, base)| self.inventory_ids(*base).map(|(offset, _)| offset))
            .collect();
        for offset in offsets {
            if let Some(slot) = self.body.get_mut(offset + 5..offset + 7) {
                slot.copy_from_slice(&quantity.to_le_bytes());
            }
        }
    }

    /// Mark every registered skill as unlocked.
    pub fn unlock_skills(&mut self) {
        let offsets: Vec<usize> =
            SKILLS.iter().flat_map(|(_, base)| self.skill_slots(*base)).collect();
        for offset in offsets {
            self.body[offset] = 1;
        }
    }

    pub fn report(&self) -> Result<SaveReport> {
        let inventory_counts =
            INVENTORY.iter().map(|(name, base)| (*name, self.inventory_ids(*base).count())).collect();
        let skill_counts =
            SKILLS.iter().map(|(name, base)| (*name, self.skill_slots(*base).count())).collect();
        let mut cacs = Vec::new();
        for slot in 0..XV2_NUM_CAC {
            if !self.cac_valid(slot)? {
                continue;
            }
            let race = self.cac_get(slot, "race")? as usize;
            let mut stats = BTreeMap::new();
            for field in CAC_STATS {
                stats.insert(field, self.cac_get(slot, field)?);
            }
            cacs.push(CacReport { name: self.cac_name(slot)?, race: RACES[race].to_owned(), stats });
        }
        Ok(SaveReport {
            version: self.version,
            decrypted_size: self.body.len(),
            steam_id: self.steam_id()?,
            zeni: self.u32(0x2C)?,
            tp_medals: self.u32(0x30)?,
            inventory_counts,
            skill_counts,
            cacs,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_then_decrypt_round_trips_and_edits_fields() {
        let mut body = vec![0u8; 0x7B390];
        body[..4].copy_from_slice(b"#SAV");
        let mut save = SaveFile { body, version: 1 };
        save.set_u32(0x2C, 123_456).unwrap();
        let base = FIRST_CAC_OFFSET;
        save.body[base + CAC_NAME_OFFSET..base + CAC_NAME_OFFSET + 4].copy_from_slice(b"Kale");
        save.cac_set(0, "race", 3).unwrap();
        save.cac_set(0, "level", 80).unwrap();

        let encrypted = save.encrypt().unwrap();
        assert_eq!(encrypted.len(), 0x7B440);
        let decoded = SaveFile::decrypt(&encrypted).unwrap();
        assert_eq!(decoded.body, save.body);
        let report = decoded.report().unwrap();
        assert_eq!(report.zeni, 123_456);
        assert_eq!(report.cacs.len(), 1);
        assert_eq!(report.cacs[0].name, "Kale");
        assert_eq!(report.cacs[0].stats["level"], 80);
    }
}

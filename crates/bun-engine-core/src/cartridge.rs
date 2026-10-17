//! Canonical Nintendo DS cartridge metadata and tool-boundary contracts.
//!
//! Inspection is read-only and bounded to the format-defined 512-byte header.
//! ROM execution, emulation and proprietary payloads are deliberately outside
//! this parser.

use core::{fmt, str};

pub use aphrody_dust_core as dust;

pub const HEADER_LEN: usize = 0x200;
const LOGO_OFFSET: usize = 0xc0;
const LOGO_PREFIX: &[u8] = b"\x24\xff\xae\x51\x69\x9a\xa2\x21\x3d\x84\x82\x0a";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArmImage {
    pub rom_offset: u32,
    pub entry_address: u32,
    pub ram_address: u32,
    pub byte_len: u32,
}

impl ArmImage {
    pub fn rom_range(self) -> Option<core::ops::Range<u64>> {
        let start = u64::from(self.rom_offset);
        start
            .checked_add(u64::from(self.byte_len))
            .map(|end| start..end)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CartridgeHeader {
    pub title: [u8; 12],
    pub game_code: [u8; 4],
    pub maker_code: [u8; 2],
    pub unit_code: u8,
    pub device_capacity: u8,
    pub arm9: ArmImage,
    pub arm7: ArmImage,
}

impl CartridgeHeader {
    pub fn title(&self) -> &str {
        ascii_field(&self.title)
    }

    pub fn game_code(&self) -> &str {
        ascii_field(&self.game_code)
    }

    pub fn maker_code(&self) -> &str {
        ascii_field(&self.maker_code)
    }

    pub fn validate_rom_size(&self, rom_len: u64) -> Result<(), HeaderError> {
        validate_image("ARM9", self.arm9, rom_len)?;
        validate_image("ARM7", self.arm7, rom_len)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeaderError {
    Truncated {
        actual: usize,
    },
    InvalidLogo,
    InvalidGameCode,
    InvalidImageOffset {
        processor: &'static str,
        offset: u32,
    },
    ImageOutsideRom {
        processor: &'static str,
    },
}

impl fmt::Display for HeaderError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Truncated { actual } => {
                write!(
                    formatter,
                    "NDS header needs {HEADER_LEN} bytes, got {actual}"
                )
            }
            Self::InvalidLogo => formatter.write_str("Nintendo DS logo signature is missing"),
            Self::InvalidGameCode => formatter.write_str("Nintendo DS game code is invalid"),
            Self::InvalidImageOffset { processor, offset } => {
                write!(formatter, "{processor} ROM offset 0x{offset:x} is invalid")
            }
            Self::ImageOutsideRom { processor } => {
                write!(formatter, "{processor} image exceeds the ROM size")
            }
        }
    }
}

impl core::error::Error for HeaderError {}

/// Parses a Nintendo DS cartridge header without reading beyond the first 512 bytes.
pub fn inspect_header(bytes: &[u8]) -> Result<CartridgeHeader, HeaderError> {
    let header = bytes.get(..HEADER_LEN).ok_or(HeaderError::Truncated {
        actual: bytes.len(),
    })?;
    if header.get(LOGO_OFFSET..LOGO_OFFSET + LOGO_PREFIX.len()) != Some(LOGO_PREFIX) {
        return Err(HeaderError::InvalidLogo);
    }

    let game_code = array(header, 0x0c);
    if !game_code.iter().all(u8::is_ascii_alphanumeric) {
        return Err(HeaderError::InvalidGameCode);
    }

    let cartridge = CartridgeHeader {
        title: array(header, 0),
        game_code,
        maker_code: array(header, 0x10),
        unit_code: header[0x12],
        device_capacity: header[0x14],
        arm9: arm_image(header, 0x20),
        arm7: arm_image(header, 0x30),
    };
    validate_offset("ARM9", cartridge.arm9.rom_offset)?;
    validate_offset("ARM7", cartridge.arm7.rom_offset)?;
    Ok(cartridge)
}

fn validate_offset(processor: &'static str, offset: u32) -> Result<(), HeaderError> {
    if offset < HEADER_LEN as u32 {
        return Err(HeaderError::InvalidImageOffset { processor, offset });
    }
    Ok(())
}

fn validate_image(
    processor: &'static str,
    image: ArmImage,
    rom_len: u64,
) -> Result<(), HeaderError> {
    let range = image
        .rom_range()
        .ok_or(HeaderError::ImageOutsideRom { processor })?;
    if range.end > rom_len {
        return Err(HeaderError::ImageOutsideRom { processor });
    }
    Ok(())
}

fn arm_image(header: &[u8], offset: usize) -> ArmImage {
    ArmImage {
        rom_offset: u32_at(header, offset),
        entry_address: u32_at(header, offset + 4),
        ram_address: u32_at(header, offset + 8),
        byte_len: u32_at(header, offset + 12),
    }
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(array(bytes, offset))
}

fn array<const N: usize>(bytes: &[u8], offset: usize) -> [u8; N] {
    bytes[offset..offset + N]
        .try_into()
        .expect("offsets are bounded by the validated NDS header")
}

fn ascii_field(bytes: &[u8]) -> &str {
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    str::from_utf8(&bytes[..end]).unwrap_or("").trim_end()
}

/// Stable native boundary implemented by `dotnet/BunEngine.Nds.Tinke.csproj`.
pub mod tinke_aot {
    pub const ABI_VERSION: u32 = 1;
    pub const LIBRARY_BASENAME: &str = "bun_engine_nds_tinke";
    pub const ABI_EXPORT: &str = "bun_engine_nds_tinke_abi";
    pub const DECRYPT_EXPORT: &str = "bun_engine_nds_tinke_decrypt";
    pub const ENCRYPT_EXPORT: &str = "bun_engine_nds_tinke_encrypt";
    pub const PAC_COUNT_EXPORT: &str = "bun_engine_nds_tinke_pac_count";
    pub const UPSTREAM: &str = "https://github.com/pleonex/tinke";
    pub const APHRODY_FORK: &str = "https://github.com/aphrody-labs/tinke";
    pub const LICENSE: &str = "GPL-3.0-or-later";
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> [u8; HEADER_LEN] {
        let mut header = [0; HEADER_LEN];
        header[..9].copy_from_slice(b"INAZUMA11");
        header[0x0c..0x10].copy_from_slice(b"BEBF");
        header[0x10..0x12].copy_from_slice(b"01");
        header[LOGO_OFFSET..LOGO_OFFSET + LOGO_PREFIX.len()].copy_from_slice(LOGO_PREFIX);
        header[0x20..0x24].copy_from_slice(&0x4000_u32.to_le_bytes());
        header[0x24..0x28].copy_from_slice(&0x0200_0800_u32.to_le_bytes());
        header[0x28..0x2c].copy_from_slice(&0x0200_0000_u32.to_le_bytes());
        header[0x2c..0x30].copy_from_slice(&0x1000_u32.to_le_bytes());
        header[0x30..0x34].copy_from_slice(&0x8000_u32.to_le_bytes());
        header[0x34..0x38].copy_from_slice(&0x0238_0000_u32.to_le_bytes());
        header[0x38..0x3c].copy_from_slice(&0x0238_0000_u32.to_le_bytes());
        header[0x3c..0x40].copy_from_slice(&0x800_u32.to_le_bytes());
        header
    }

    #[test]
    fn parses_and_bounds_arm_images() {
        let header = inspect_header(&fixture()).unwrap();
        assert_eq!(header.title(), "INAZUMA11");
        assert_eq!(header.game_code(), "BEBF");
        assert_eq!(header.maker_code(), "01");
        assert_eq!(header.arm9.rom_offset, 0x4000);
        assert_eq!(header.arm7.byte_len, 0x800);
        assert_eq!(header.validate_rom_size(0x9000), Ok(()));
        assert_eq!(
            header.validate_rom_size(0x87ff),
            Err(HeaderError::ImageOutsideRom { processor: "ARM7" })
        );
    }

    #[test]
    fn rejects_truncated_and_unsigned_headers() {
        assert_eq!(
            inspect_header(&[0; 16]),
            Err(HeaderError::Truncated { actual: 16 })
        );
        assert_eq!(
            inspect_header(&[0; HEADER_LEN]),
            Err(HeaderError::InvalidLogo)
        );
    }

    #[test]
    fn tinke_contract_matches_native_exports() {
        assert_eq!(tinke_aot::ABI_VERSION, 1);
        assert!(tinke_aot::DECRYPT_EXPORT.starts_with(tinke_aot::LIBRARY_BASENAME));
        assert_eq!(tinke_aot::LICENSE, "GPL-3.0-or-later");
    }
}

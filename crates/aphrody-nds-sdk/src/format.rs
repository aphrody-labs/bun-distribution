//! Image format detection by content. File names and extensions are never trusted.

/// Console family of an image.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Platform {
    Ds,
    Ctr,
}

/// Container formats the SDK boots.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Format {
    /// Nintendo DS cartridge image (`.nds`).
    Nds,
    /// 3DS cartridge image, NCSD container (`.cci`, `.3ds`).
    Cci,
    /// 3DS installable title archive (`.cia`).
    Cia,
    /// 3DS executable content, NCCH container (`.cxi`).
    Cxi,
    /// 3DS homebrew executable (`.3dsx`).
    ThreeDsx,
}

impl Format {
    /// The console family that runs the format.
    pub fn platform(self) -> Platform {
        match self {
            Format::Nds => Platform::Ds,
            _ => Platform::Ctr,
        }
    }

    /// Identify `image` from its header bytes.
    pub fn detect(image: &[u8]) -> Option<Format> {
        let u16_at = |at: usize| {
            image
                .get(at..at + 2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
        };
        let u32_at = |at: usize| {
            image
                .get(at..at + 4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        };
        if image.get(..4) == Some(b"3DSX") {
            return Some(Format::ThreeDsx);
        }
        match image.get(0x100..0x104) {
            Some(b"NCSD") => return Some(Format::Cci),
            Some(b"NCCH") => return Some(Format::Cxi),
            _ => {}
        }
        // CIA: header size 0x2020, type 0, version 0 or 1.
        if u32_at(0) == Some(0x2020) && u16_at(4) == Some(0) && matches!(u16_at(6), Some(0 | 1)) {
            return Some(Format::Cia);
        }
        // NDS: Nintendo logo CRC16 (0xCF56) at 0x15C and an ARM9 image after the header.
        if image.len() >= 0x200
            && u16_at(0x15C) == Some(0xCF56)
            && u32_at(0x20).is_some_and(|o| o >= 0x200)
        {
            return Some(Format::Nds);
        }
        None
    }
}

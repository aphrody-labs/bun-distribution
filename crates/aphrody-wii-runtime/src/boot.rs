//! Checked Wii homebrew loading shared by native and browser hosts.

use aphrody_wii::dol::{Dol, DolError};

use crate::Wii;

fn mapped_range(address: u32, size: u32) -> bool {
    let Some(end) = address.checked_add(size) else {
        return false;
    };
    [(0x8000_0000, 0x8180_0000), (0x9000_0000, 0x9400_0000)]
        .into_iter()
        .any(|(base, limit)| address >= base && address < limit && end <= limit)
}

impl Wii {
    /// Validate all sections before allocating the console or touching devices.
    pub fn with_dol(bytes: &[u8]) -> Result<Self, DolError> {
        let dol = Dol::parse(bytes)?;
        for section in dol.sections().iter().filter(|section| section.size != 0) {
            if !mapped_range(section.address, section.size) {
                return Err(DolError::OutsideMemory);
            }
        }
        if dol.bss_size != 0 && !mapped_range(dol.bss_address, dol.bss_size) {
            return Err(DolError::OutsideMemory);
        }
        if !dol.sections()[..7].iter().any(|section| {
            section.size != 0
                && dol.entry_point >= section.address
                && dol.entry_point < section.address + section.size
        }) {
            return Err(DolError::OutsideMemory);
        }
        Ok(Self::with_image(&image::Dol::parse(bytes.to_vec())))
    }
}

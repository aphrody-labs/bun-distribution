//! Checked borrowed DOL loading, adapted from Gecko image/src/dol.rs.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DolError {
    TruncatedHeader,
    TruncatedSection,
    AddressOverflow,
    UnalignedEntry,
    OutsideMemory,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Section {
    pub file_offset: u32,
    pub address: u32,
    pub size: u32,
}

#[derive(Debug)]
pub struct Dol<'a> {
    bytes: &'a [u8],
    sections: [Section; 18],
    pub bss_address: u32,
    pub bss_size: u32,
    pub entry_point: u32,
}

fn word(bytes: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .expect("checked header"),
    )
}

impl<'a> Dol<'a> {
    pub fn parse(bytes: &'a [u8]) -> Result<Self, DolError> {
        if bytes.len() < 0x100 {
            return Err(DolError::TruncatedHeader);
        }
        let mut sections = [Section::default(); 18];
        for (index, section) in sections.iter_mut().enumerate() {
            *section = Section {
                file_offset: word(bytes, index * 4),
                address: word(bytes, 0x48 + index * 4),
                size: word(bytes, 0x90 + index * 4),
            };
            if section.size == 0 {
                continue;
            }
            let end = section
                .file_offset
                .checked_add(section.size)
                .ok_or(DolError::TruncatedSection)?;
            if end as u64 > bytes.len() as u64 {
                return Err(DolError::TruncatedSection);
            }
            section
                .address
                .checked_add(section.size)
                .ok_or(DolError::AddressOverflow)?;
        }
        let image = Self {
            bytes,
            sections,
            bss_address: word(bytes, 0xd8),
            bss_size: word(bytes, 0xdc),
            entry_point: word(bytes, 0xe0),
        };
        image
            .bss_address
            .checked_add(image.bss_size)
            .ok_or(DolError::AddressOverflow)?;
        if image.entry_point & 3 != 0 {
            return Err(DolError::UnalignedEntry);
        }
        Ok(image)
    }

    /// Seven text sections followed by eleven data sections, in file header order.
    pub fn sections(&self) -> &[Section; 18] {
        &self.sections
    }

    /// Copy into a single guest virtual-memory region and clear BSS.
    ///
    /// Every destination is checked before mutation. A full Wii MMU caller can
    /// instead consume `sections()` and `section_bytes()` across MEM1/MEM2.
    pub fn load_into(&self, memory: &mut [u8], base: u32) -> Result<(), DolError> {
        for section in &self.sections {
            if section.size != 0 {
                destination(section.address, section.size, base, memory.len())?;
            }
        }
        if self.bss_size != 0 {
            destination(self.bss_address, self.bss_size, base, memory.len())?;
        }
        for section in &self.sections {
            if section.size == 0 {
                continue;
            }
            let range = destination(section.address, section.size, base, memory.len())?;
            memory[range].copy_from_slice(self.section_bytes(section));
        }
        if self.bss_size != 0 {
            let range = destination(self.bss_address, self.bss_size, base, memory.len())?;
            memory[range].fill(0);
        }
        Ok(())
    }

    /// Returns bytes for a section from this image's validated table.
    pub fn section_bytes(&self, section: &Section) -> &[u8] {
        self.bytes
            .get(
                section.file_offset as usize
                    ..(section.file_offset as usize).saturating_add(section.size as usize),
            )
            .unwrap_or(&[])
    }
}

fn destination(
    address: u32,
    size: u32,
    base: u32,
    length: usize,
) -> Result<core::ops::Range<usize>, DolError> {
    let start = address.checked_sub(base).ok_or(DolError::OutsideMemory)? as usize;
    let end = start
        .checked_add(size as usize)
        .ok_or(DolError::OutsideMemory)?;
    if end > length {
        return Err(DolError::OutsideMemory);
    }
    Ok(start..end)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + 4].copy_from_slice(&value.to_be_bytes());
    }

    fn fixture() -> [u8; 0x108] {
        let mut bytes = [0; 0x108];
        put(&mut bytes, 0, 0x100);
        put(&mut bytes, 0x48, 0x8000_0000);
        put(&mut bytes, 0x90, 8);
        put(&mut bytes, 0xd8, 0x8000_0008);
        put(&mut bytes, 0xdc, 8);
        put(&mut bytes, 0xe0, 0x8000_0000);
        put(&mut bytes, 0x100, 0x4800_0004); // b +4
        put(&mut bytes, 0x104, 0x4bff_fffc); // b -4
        bytes
    }

    #[test]
    fn guest_fixture_loads_and_executes_branches() {
        let bytes = fixture();
        let image = Dol::parse(&bytes).unwrap();
        let mut memory = [0xff; 16];
        image.load_into(&mut memory, 0x8000_0000).unwrap();
        assert_eq!(&memory[8..], &[0; 8]);
        let mut cpu = crate::branch::BranchState {
            pc: image.entry_point,
            ..Default::default()
        };
        for expected in [0x8000_0004, 0x8000_0000, 0x8000_0004, 0x8000_0000] {
            let offset = (cpu.pc - 0x8000_0000) as usize;
            cpu.execute(word(&memory, offset)).unwrap();
            assert_eq!(cpu.pc, expected);
        }
    }

    #[test]
    fn short_header_and_payload_rejected() {
        assert!(matches!(
            Dol::parse(&[0; 0xe4]),
            Err(DolError::TruncatedHeader)
        ));
        let bytes = fixture();
        assert!(matches!(
            Dol::parse(&bytes[..0x104]),
            Err(DolError::TruncatedSection)
        ));
    }

    #[test]
    fn failed_mapping_leaves_memory_untouched() {
        let bytes = fixture();
        let image = Dol::parse(&bytes).unwrap();
        let mut memory = [0xff; 12];
        assert_eq!(
            image.load_into(&mut memory, 0x8000_0000),
            Err(DolError::OutsideMemory)
        );
        assert_eq!(memory, [0xff; 12]);
    }

    #[test]
    fn guest_address_overflow_rejected() {
        let mut bytes = fixture();
        put(&mut bytes, 0x48, u32::MAX - 3);
        assert!(matches!(Dol::parse(&bytes), Err(DolError::AddressOverflow)));
    }

    #[test]
    fn data_section_uses_the_same_checked_path() {
        let mut bytes = fixture();
        put(&mut bytes, 0x90, 0);
        put(&mut bytes, 7 * 4, 0x100);
        put(&mut bytes, 0x48 + 7 * 4, 0x8000_0000);
        put(&mut bytes, 0x90 + 7 * 4, 8);
        let image = Dol::parse(&bytes).unwrap();
        let mut memory = [0xff; 16];
        image.load_into(&mut memory, 0x8000_0000).unwrap();
        assert_eq!(&memory[..8], &bytes[0x100..]);
    }
}

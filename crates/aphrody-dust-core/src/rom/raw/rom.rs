use std::{borrow::Cow, collections::BTreeSet, io::Read, mem::size_of, path::Path};

use snafu::Snafu;

use super::{
    Arm9Footer, Arm9FooterError, Banner, FileAlloc, Fnt, Header, Overlay, OverlayTable,
    RawBannerError, RawBuildInfoError, RawFatError, RawFntError, RawHeaderError, RawOverlayError,
};
use crate::{
    io::{FileError, open_file, write_file},
    rom::{
        Arm7, Arm7Offsets, Arm9, Arm9Offsets, RomConfigAlignment, RomConfigPaddingValues,
        raw::{MultibootSignature, RawMultibootSignatureError},
    },
};

/// A raw DS ROM, see the plain struct [here](super::super::Rom).
pub struct Rom<'a> {
    data: Cow<'a, [u8]>,
}

/// Errors related to [`Rom::arm9`].
#[derive(Debug, Snafu)]
pub enum RawArm9Error {
    /// See [`RawHeaderError`].
    #[snafu(transparent)]
    RawHeader {
        /// Source error.
        source: RawHeaderError,
    },
    /// See [`Arm9FooterError`].
    #[snafu(transparent)]
    Arm9Footer {
        /// Source error.
        source: Arm9FooterError,
    },
    /// See [`RawBuildInfoError`].
    #[snafu(transparent)]
    RawBuildInfo {
        /// Source error.
        source: RawBuildInfoError,
    },
}

/// Errors related to [`Rom::alignments`].
#[derive(Debug, Snafu)]
pub enum RomAlignmentsError {
    /// See [`RawHeaderError`].
    #[snafu(transparent)]
    RawHeader {
        /// Source error.
        source: RawHeaderError,
    },
    /// See [`RawFatError`].
    #[snafu(transparent)]
    RawFat {
        /// Source error.
        source: RawFatError,
    },
    /// See [`RawOverlayError`].
    #[snafu(transparent)]
    RawOverlay {
        /// Source error.
        source: RawOverlayError,
    },
    /// See [`RawFntError`].
    #[snafu(transparent)]
    RawBanner {
        /// Source error.
        source: RawBannerError,
    },
}

impl<'a> Rom<'a> {
    /// Creates a new ROM from raw data.
    pub fn new<T: Into<Cow<'a, [u8]>>>(data: T) -> Self {
        Self { data: data.into() }
    }

    /// Loads from a ROM file.
    ///
    /// # Errors
    ///
    /// This function will return an error if an I/O operation fails.
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self, FileError> {
        let mut file = open_file(path)?;
        let size = file.metadata()?.len();
        let capacity = usize::try_from(size)
            .map_err(|_| std::io::Error::other("ROM is too large for this platform"))?;
        let mut buf = vec![0; capacity];
        file.read_exact(&mut buf)?;
        let data: Cow<[u8]> = buf.into();
        Ok(Self::new(data))
    }

    /// Returns the header of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Header::borrow_from_slice`].
    pub fn header(&self) -> Result<&Header, RawHeaderError> {
        Header::borrow_from_slice(self.data.as_ref())
    }

    /// Builds a bounded summary of the ROM header and its declared regions.
    ///
    /// Invalid region ranges are reported in the returned value instead of being sliced, so this
    /// method is safe to call before parsing overlays, files, banners or executable segments.
    ///
    /// # Errors
    ///
    /// Returns an error if the input is too small or misaligned for a [`Header`].
    pub fn inspect(&self) -> Result<RomInspection, RawHeaderError> {
        let header = self.header()?;
        let file_size = self.data.len() as u64;
        let banner_size = if header.banner_size != 0 {
            header.banner_size
        } else {
            let banner_offset = usize::try_from(header.banner_offset).ok();
            banner_offset
                .and_then(|offset| self.data.get(offset..offset.saturating_add(2)))
                .and_then(|bytes| bytes.get(..2))
                .map_or(1, |bytes| match u16::from_le_bytes([bytes[0], bytes[1]]) {
                    1 => 0x840,
                    2 => 0x940,
                    3 => 0x1240,
                    0x103 => 0x23c0,
                    _ => 1,
                })
        };
        let mut regions = Vec::with_capacity(15);

        let mut add_region = |kind, offset: u32, size: u32, required: bool| {
            let start = u64::from(offset);
            let length = u64::from(size);
            let end = start.checked_add(length);
            let present = size != 0;
            let in_bounds = end.is_some_and(|end| end <= file_size);
            regions.push(RomRegion {
                kind,
                offset: start,
                size: length,
                present,
                in_bounds: present && in_bounds,
                required,
            });
        };

        add_region(RomRegionKind::Arm9, header.arm9.offset, header.arm9.size, true);
        add_region(RomRegionKind::Arm7, header.arm7.offset, header.arm7.size, true);
        add_region(
            RomRegionKind::FileNameTable,
            header.file_names.offset,
            header.file_names.size,
            false,
        );
        add_region(
            RomRegionKind::FileAllocationTable,
            header.file_allocs.offset,
            header.file_allocs.size,
            false,
        );
        add_region(
            RomRegionKind::Arm9OverlayTable,
            header.arm9_overlays.offset,
            header.arm9_overlays.size,
            false,
        );
        add_region(
            RomRegionKind::Arm7OverlayTable,
            header.arm7_overlays.offset,
            header.arm7_overlays.size,
            false,
        );
        add_region(
            RomRegionKind::Banner,
            header.banner_offset,
            banner_size,
            header.banner_offset != 0,
        );
        add_region(RomRegionKind::Arm9i, header.arm9i.offset, header.arm9i.size, false);
        add_region(RomRegionKind::Arm7i, header.arm7i.offset, header.arm7i.size, false);
        add_region(
            RomRegionKind::DsDigestArea,
            header.digest_ds_area.offset,
            header.digest_ds_area.size,
            false,
        );
        add_region(
            RomRegionKind::DsiDigestArea,
            header.digest_dsi_area.offset,
            header.digest_dsi_area.size,
            false,
        );
        add_region(
            RomRegionKind::DigestSectorHashTable,
            header.digest_sector_hashtable.offset,
            header.digest_sector_hashtable.size,
            false,
        );
        add_region(
            RomRegionKind::DigestBlockHashTable,
            header.digest_block_hashtable.offset,
            header.digest_block_hashtable.size,
            false,
        );
        add_region(RomRegionKind::Debug, header.debug_rom_offset, header.debug_size, false);

        let header_crc_end = std::mem::offset_of!(Header, header_crc);
        let header_crc_valid =
            crate::crc::CRC_16_MODBUS.checksum(&self.data[..header_crc_end]) == header.header_crc;
        let logo_crc_valid = crate::crc::CRC_16_MODBUS.checksum(&header.logo) == header.logo_crc;
        let is_dsi = header.dsi_flags.is_dsi_title() || header.unitcode == 0x02;

        Ok(RomInspection {
            title: header.title.to_string(),
            game_code: header.gamecode.to_string(),
            maker_code: header.makercode.to_string(),
            is_dsi,
            unit_code: header.unitcode,
            file_size,
            ds_region_size: u64::from(header.rom_size_ds),
            dsi_region_size: u64::from(header.rom_size_dsi),
            regions,
            header_crc_valid,
            logo_crc_valid,
        })
    }

    /// Returns the ARM9 program of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::header`].
    pub fn arm9(&self) -> Result<Arm9<'_>, RawArm9Error> {
        let header = self.header()?;
        let start = header.arm9.offset as usize;
        let end = start + header.arm9.size as usize;
        let data = &self.data[start..end];

        let footer = if header.dsi_flags.is_dsi_title() { None } else { Some(self.arm9_footer()?) };

        let (build_info_offset, overlay_signatures_offset) = if let Some(footer) = footer {
            let build_info_offset = if header.arm9_build_info_offset == 0 {
                footer.build_info_offset
            } else if header.arm9_build_info_offset > header.arm9.offset {
                header.arm9_build_info_offset - header.arm9.offset
            } else {
                // `arm9_build_info_offset` is not an absolute ROM offset in DSi titles
                header.arm9_build_info_offset
            };
            (build_info_offset, footer.overlay_signatures_offset)
        } else {
            let build_info_offset = if header.arm9_build_info_offset == 0 {
                0
            } else if header.arm9_build_info_offset > header.arm9.offset {
                header.arm9_build_info_offset - header.arm9.offset
            } else {
                header.arm9_build_info_offset
            };
            (build_info_offset, 0)
        };

        Ok(Arm9::new(
            Cow::Borrowed(data),
            Arm9Offsets {
                base_address: header.arm9.base_addr,
                entry_function: header.arm9.entry,
                build_info: build_info_offset,
                autoload_callback: header.arm9_autoload_callback,
                overlay_signatures: overlay_signatures_offset,
            },
        )?)
    }

    /// Returns a reference to the ARM9 footer of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::header`] and [`Arm9Footer::borrow_from_slice`].
    pub fn arm9_footer(&self) -> Result<&Arm9Footer, Arm9FooterError> {
        let header = self.header()?;
        let start = (header.arm9.offset + header.arm9.size) as usize;
        let end = start + size_of::<Arm9Footer>();
        let data = &self.data[start..end];
        Arm9Footer::borrow_from_slice(data)
    }

    /// Returns a mutable reference to the ARM9 footer of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::header`] and [`Arm9Footer::borrow_from_slice_mut`].
    pub fn arm9_footer_mut(&mut self) -> Result<&mut Arm9Footer, Arm9FooterError> {
        let header = self.header()?;
        let start = (header.arm9.offset + header.arm9.size) as usize;
        let end = start + size_of::<Arm9Footer>();
        let data = &mut self.data.to_mut()[start..end];
        Arm9Footer::borrow_from_slice_mut(data)
    }

    /// Returns the ARM9 overlays of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::header`] and [`Overlay::borrow_from_slice`].
    pub fn arm9_overlays(&self) -> Result<&[Overlay], RawOverlayError> {
        let header = self.header()?;
        let start = header.arm9_overlays.offset as usize;
        let end = start + header.arm9_overlays.size as usize;
        if start == 0 && end == 0 {
            Ok(&[])
        } else {
            let data = &self.data[start..end];
            Ok(Overlay::borrow_from_slice(data)?)
        }
    }

    /// Returns the ARM9 overlay table of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::arm9`] and [`Self::arm9_overlay_table_with`].
    pub fn arm9_overlay_table(&self) -> Result<OverlayTable<'_>, RawOverlayError> {
        let arm9 = self.arm9()?;
        self.arm9_overlay_table_with(&arm9)
    }

    /// Returns the ARM9 overlay table of this [`Rom`], using the table signature from the provided ARM9 program.
    ///
    /// # Errors
    ///
    /// See [`Self::arm9_overlays`] and [`Arm9::overlay_table_signature`].
    pub fn arm9_overlay_table_with(
        &self,
        arm9: &Arm9,
    ) -> Result<OverlayTable<'_>, RawOverlayError> {
        let overlays = self.arm9_overlays()?;
        let signature = arm9.overlay_table_signature()?.copied();
        Ok(OverlayTable::new(overlays, signature))
    }

    /// Returns the number of ARM9 overlays in this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::header`].
    pub fn num_arm9_overlays(&self) -> Result<usize, RawHeaderError> {
        let header = self.header()?;
        let start = header.arm9_overlays.offset as usize;
        let end = start + header.arm9_overlays.size as usize;
        Ok((end - start) / size_of::<Overlay>())
    }

    /// Returns the ARM7 program of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::header`].
    pub fn arm7(&self) -> Result<Arm7<'_>, RawHeaderError> {
        let header = self.header()?;
        let start = header.arm7.offset as usize;
        let end = start + header.arm7.size as usize;
        let data = &self.data[start..end];

        let build_info_offset = if header.arm7_build_info_offset == 0 {
            0
        } else if header.arm7_build_info_offset > header.arm7.offset {
            header.arm7_build_info_offset - header.arm7.offset
        } else {
            header.arm7_build_info_offset
        };

        Ok(Arm7::new(
            Cow::Borrowed(data),
            Arm7Offsets {
                base_address: header.arm7.base_addr,
                entry_function: header.arm7.entry,
                build_info: build_info_offset,
                autoload_callback: header.arm7_autoload_callback,
            },
        ))
    }

    /// Returns the ARM7 overlay table of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::header`] and [`Overlay::borrow_from_slice`].
    pub fn arm7_overlays(&self) -> Result<&[Overlay], RawOverlayError> {
        let header = self.header()?;
        let start = header.arm7_overlays.offset as usize;
        let end = start + header.arm7_overlays.size as usize;
        if start == 0 && end == 0 {
            Ok(&[])
        } else {
            let data = &self.data[start..end];
            Ok(Overlay::borrow_from_slice(data)?)
        }
    }

    /// Returns the ARM7 overlay table of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::arm7_overlays`].
    pub fn arm7_overlay_table(&self) -> Result<OverlayTable<'_>, RawOverlayError> {
        let overlays = self.arm7_overlays()?;
        Ok(OverlayTable::new(overlays, None))
    }

    /// Returns the number of ARM7 overlays in this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::header`].
    pub fn num_arm7_overlays(&self) -> Result<usize, RawHeaderError> {
        let header = self.header()?;
        let start = header.arm7_overlays.offset as usize;
        let end = start + header.arm7_overlays.size as usize;
        Ok((end - start) / size_of::<Overlay>())
    }

    /// Returns the FNT of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::header`] and [`Fnt::borrow_from_slice`].
    pub fn fnt(&self) -> Result<Fnt<'_>, RawFntError> {
        let header = self.header()?;
        let start = header.file_names.offset as usize;
        let end = start + header.file_names.size as usize;
        let data = &self.data[start..end];
        Fnt::borrow_from_slice(data)
    }

    /// Returns the FAT of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::header`] and [`FileAlloc::borrow_from_slice`].
    pub fn fat(&self) -> Result<&[FileAlloc], RawFatError> {
        let header = self.header()?;
        let start = header.file_allocs.offset as usize;
        let end = start + header.file_allocs.size as usize;
        let data = &self.data[start..end];
        let allocs = FileAlloc::borrow_from_slice(data)?;
        Ok(allocs)
    }

    /// Returns the banner of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::header`] and [`Banner::borrow_from_slice`].
    pub fn banner(&self) -> Result<Banner<'_>, RawBannerError> {
        let header = self.header()?;
        let start = header.banner_offset as usize;
        let data = &self.data[start..];
        Banner::borrow_from_slice(data)
    }

    /// Returns the multiboot signature of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::header`] and [`MultibootSignature::borrow_from_slice`].
    pub fn multiboot_signature(
        &self,
    ) -> Result<Option<MultibootSignature>, RawMultibootSignatureError> {
        let header = self.header()?;
        let start = header.rom_size_ds as usize;
        let data = &self.data[start..];
        match MultibootSignature::from_slice(data) {
            Ok(s) => Ok(Some(s)),
            Err(RawMultibootSignatureError::InvalidMagic { .. }) => Ok(None), // signature not found
            Err(RawMultibootSignatureError::DataTooSmall { .. }) => Ok(None), // signature truncated or absent at EOF
            Err(e) => Err(e),
        }
    }

    /// Returns the padding values between ROM sections.
    ///
    /// # Errors
    ///
    /// See [`Self::header`], [`Self::fat`], [`Self::arm9_overlays`], [`Self::arm7_overlays`] and
    /// [`Self::file_image_padding_value`].
    pub fn padding_values(&self) -> Result<RomConfigPaddingValues, RomAlignmentsError> {
        let header = self.header()?;
        let fat = self.fat()?;
        let arm9_overlays = self.arm9_overlays()?;
        let arm7_overlays = self.arm7_overlays()?;

        Ok(RomConfigPaddingValues {
            arm9: self.data[header.arm9.offset as usize - 1],
            arm9_overlay_table: if header.arm9_overlays.offset > 0 {
                self.data[header.arm9_overlays.offset as usize - 1]
            } else {
                DEFAULT_PADDING_VALUE
            },
            arm9_overlays: self
                .get_overlays_padding(arm9_overlays, fat)
                .unwrap_or(DEFAULT_PADDING_VALUE),
            arm7: self.data[header.arm7.offset as usize - 1],
            arm7_overlay_table: if header.arm7_overlays.offset > 0 {
                self.data[header.arm7_overlays.offset as usize - 1]
            } else {
                DEFAULT_PADDING_VALUE
            },
            arm7_overlays: self
                .get_overlays_padding(arm7_overlays, fat)
                .unwrap_or(DEFAULT_PADDING_VALUE),
            fnt: self.data[header.file_names.offset as usize - 1],
            fat: self.data[header.file_allocs.offset as usize - 1],
            banner: self.data[header.banner_offset as usize - 1],
            file_image: self.file_image_padding_value()?,
            rom: *self.data.last().unwrap_or(&DEFAULT_PADDING_VALUE),
        })
    }

    fn get_overlays_padding(&self, overlays: &[Overlay], fat: &[FileAlloc]) -> Option<u8> {
        let mut overlay_files = overlays.iter().map(|o| &fat[o.id as usize]).collect::<Vec<_>>();
        overlay_files.sort_unstable_by_key(|o| o.start);
        let mut overlay_files = overlay_files.into_iter();
        if let Some(mut prev_overlay) = overlay_files.next() {
            for overlay in overlay_files {
                if prev_overlay.end != overlay.start {
                    return Some(self.data[overlay.start as usize - 1]);
                }
                prev_overlay = overlay;
            }
        }
        None
    }

    /// Returns the padding value in the file image block of this [`Rom`].
    ///
    /// # Errors
    ///
    /// See [`Self::fat`], [`Self::arm9_overlays`] and [`Self::arm7_overlays`].
    fn file_image_padding_value(&self) -> Result<u8, RomAlignmentsError> {
        let fat = self.fat()?;
        let arm9_overlays = self.arm9_overlays()?;
        let arm7_overlays = self.arm7_overlays()?;
        let arm9_overlay_files =
            arm9_overlays.iter().map(|overlay| overlay.file_id).collect::<BTreeSet<u32>>();
        let arm7_overlay_files =
            arm7_overlays.iter().map(|overlay| overlay.file_id).collect::<BTreeSet<u32>>();

        // Get sorted list of adjacent files that are in the file image block (i.e. not overlays)
        let mut files: Vec<&FileAlloc> = fat
            .iter()
            .enumerate()
            .filter(|(i, _)| {
                !arm9_overlay_files.contains(&(*i as u32))
                    && !arm7_overlay_files.contains(&(*i as u32))
            })
            .map(|(_, file)| file)
            .collect();
        files.sort_by_key(|file| file.start);

        // Find a gap between two adjacent files, and return the padding byte between them
        let Some(gap) = files.windows(2).find(|pair| pair[0].end != pair[1].start) else {
            return Ok(DEFAULT_PADDING_VALUE);
        };
        Ok(self.data[gap[0].end as usize])
    }

    /// Returns a reference to the data of this [`Rom`].
    pub fn data(&self) -> &[u8] {
        &self.data
    }

    /// Saves this ROM to a new file.
    ///
    /// # Errors
    ///
    /// This function will return an error if an I/O operation fails.
    pub fn save<P: AsRef<Path>>(&self, path: P) -> Result<(), FileError> {
        write_file(path, self.data())
    }

    /// Returns the alignment of ROM sections.
    ///
    /// # Errors
    ///
    /// See [`Self::header`], [`Self::fat`], and [`Self::arm9_overlay_table`].
    pub fn alignments(&self) -> Result<RomConfigAlignment, RomAlignmentsError> {
        // Collect all overlay files into a set.
        fn get_overlay_files(overlay_table: &[Overlay]) -> BTreeSet<u32> {
            overlay_table.iter().map(|overlay| overlay.file_id).collect()
        }

        const DEFAULT_ALIGNMENT: u32 = 0x4;

        // Get the alignment of the current section, by looking at the address of the next section.
        fn get_alignment(next_section: u32) -> u32 {
            if next_section.trailing_zeros() >= 9 { 0x200 } else { DEFAULT_ALIGNMENT }
        }

        let fat = self.fat()?;
        let arm9_overlays = self.arm9_overlays()?;
        let arm7_overlays = self.arm7_overlays()?;
        let arm9_overlay_files = get_overlay_files(arm9_overlays);
        let arm7_overlay_files = get_overlay_files(arm7_overlays);
        let header = self.header()?;

        let arm9 = get_alignment(header.arm9.offset);
        let arm9_overlay_table = get_alignment(header.arm9_overlays.offset);
        let arm9_overlay = arm9_overlays
            .iter()
            .map(|overlay| get_alignment(fat[overlay.file_id as usize].start))
            .min()
            .unwrap_or(DEFAULT_ALIGNMENT);
        let arm7 = get_alignment(header.arm7.offset);
        let arm7_overlay_table = get_alignment(header.arm7_overlays.offset);
        let arm7_overlay = arm7_overlays
            .iter()
            .map(|overlay| get_alignment(fat[overlay.file_id as usize].start))
            .min()
            .unwrap_or(DEFAULT_ALIGNMENT);
        let file_name_table = get_alignment(header.file_names.offset);
        let file_allocation_table = get_alignment(header.file_allocs.offset);
        let banner = get_alignment(header.banner_offset);

        let file_iter = fat
            .iter()
            .enumerate()
            .filter(|(i, _)| {
                !arm9_overlay_files.contains(&(*i as u32))
                    && !arm7_overlay_files.contains(&(*i as u32))
            })
            .map(|(_, file)| file);

        let file_image_block = file_iter
            .clone()
            .map(|file| file.start)
            .min()
            .map_or(DEFAULT_ALIGNMENT, get_alignment);
        let file = file_iter
            .clone()
            .map(|file| get_alignment(file.start))
            .min()
            .unwrap_or(DEFAULT_ALIGNMENT);

        Ok(RomConfigAlignment {
            arm9,
            arm9_overlay_table,
            arm9_overlay,
            arm7,
            arm7_overlay_table,
            arm7_overlay,
            file_name_table,
            file_allocation_table,
            banner,
            file_image_block,
            file,
        })
    }
}

/// A declared region in a Nintendo DS or `DSi` ROM.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RomRegion {
    /// Region identifier.
    pub kind: RomRegionKind,
    /// Start offset in the ROM image.
    pub offset: u64,
    /// Declared length in bytes.
    pub size: u64,
    /// Whether the header declares a nonempty region.
    pub present: bool,
    /// Whether the nonempty range fits inside the ROM image.
    pub in_bounds: bool,
    /// Whether a missing region is structurally invalid for a usable cartridge.
    pub required: bool,
}

/// Kind of ROM region declared by a cartridge header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RomRegionKind {
    /// ARM9 executable image.
    Arm9,
    /// ARM7 executable image.
    Arm7,
    /// File Name Table.
    FileNameTable,
    /// File Allocation Table.
    FileAllocationTable,
    /// ARM9 overlay table.
    Arm9OverlayTable,
    /// ARM7 overlay table.
    Arm7OverlayTable,
    /// Icon and title banner.
    Banner,
    /// `DSi` ARM9 executable image.
    Arm9i,
    /// `DSi` ARM7 executable image.
    Arm7i,
    /// DS area digest.
    DsDigestArea,
    /// `DSi` area digest.
    DsiDigestArea,
    /// Digest sector hash table.
    DigestSectorHashTable,
    /// Digest block hash table.
    DigestBlockHashTable,
    /// Optional debug ROM image.
    Debug,
}

/// Validated, structured information extracted from a ROM header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RomInspection {
    /// Human-readable title from the header.
    pub title: String,
    /// Four-character game code.
    pub game_code: String,
    /// Two-character maker code.
    pub maker_code: String,
    /// Whether the header identifies a `DSi` title.
    pub is_dsi: bool,
    /// Raw unit code from the header.
    pub unit_code: u8,
    /// Actual image length in bytes.
    pub file_size: u64,
    /// Declared Nintendo DS region length in bytes.
    pub ds_region_size: u64,
    /// Declared `DSi` region length in bytes.
    pub dsi_region_size: u64,
    /// Declared executable, filesystem and auxiliary regions.
    pub regions: Vec<RomRegion>,
    /// Whether the header CRC matches its bytes.
    pub header_crc_valid: bool,
    /// Whether the Nintendo logo CRC matches its bytes.
    pub logo_crc_valid: bool,
}

impl RomInspection {
    /// Returns regions that are missing when required or extend beyond the image.
    pub fn invalid_regions(&self) -> impl Iterator<Item = &RomRegion> {
        self.regions.iter().filter(|region| {
            (region.required && !region.present) || (region.present && !region.in_bounds)
        })
    }

    /// Rejects missing required regions and ranges extending past the end of the image.
    ///
    /// # Errors
    ///
    /// Returns every invalid region so callers can report all malformed header ranges at once.
    pub fn validate_regions(&self) -> Result<(), Vec<RomRegion>> {
        let invalid = self.invalid_regions().copied().collect::<Vec<_>>();
        if invalid.is_empty() { Ok(()) } else { Err(invalid) }
    }

    /// Returns whether the ROM passed all structural range and header checksum checks.
    pub fn is_valid(&self) -> bool {
        self.validate_regions().is_ok() && self.header_crc_valid && self.logo_crc_valid
    }
}

const DEFAULT_PADDING_VALUE: u8 = 0xff;

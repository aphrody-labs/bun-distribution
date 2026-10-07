// SPDX-License-Identifier: Apache-2.0
//! Windows minidump (`MiniDumpWriteDump`) reader for live-process reverse engineering.
//!
//! Built for **live** (ASLR) memory dumps: module and memory-region parsing
//! (`Memory64List` plus protections from `MemoryInfoList`), random reads by virtual
//! address, AOB pattern scans with wildcards, **MSVC RTTI** class-name resolution and a
//! census of live objects by vtable.
//!
//! Minidump subset handled:
//! - `MINIDUMP_HEADER` (signature `MDMP`) and the `MINIDUMP_DIRECTORY[]` table,
//! - `ModuleListStream` (4): base, size and name of the loaded modules,
//! - `Memory64ListStream` (9): memory ranges concatenated from one `BaseRva`,
//! - `MemoryInfoListStream` (16): state, protection and type of each region.
//!
//! No `unsafe` and no `mmap`: ranges are read on demand with `seek`/`read_exact`, and
//! every offset and count taken from the file is bounds-checked before use.
//!
//! Moved from `nie/crates/forge/nie-dump` on 2026-09-26; `nie-dump` re-exports this module
//! and only adds the game-specific image base.
#![forbid(unsafe_code)]
#![warn(missing_docs)]
#![allow(clippy::pedantic)]

use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::Path;

use thiserror::Error;

const STREAM_MODULE_LIST: u32 = 4;
const STREAM_MEMORY64_LIST: u32 = 9;
const STREAM_MEMORY_INFO_LIST: u32 = 16;
const MODULE_RECORD_SIZE: usize = 108;
const MEMORY_INFO_RECORD_SIZE: usize = 48;
const HEADER_SIZE: usize = 32;
const DIRECTORY_RECORD_SIZE: usize = 12;
const MAX_MODULE_NAME_BYTES: usize = 1024 * 1024;
const MAX_STREAM_COUNT: u64 = 4096;
const MAX_MODULE_COUNT: u64 = 65_536;
const MAX_MEMORY_RANGE_COUNT: u64 = 1_000_000;
const MAX_MEMORY_INFO_COUNT: u64 = 1_000_000;
const MAX_MEMORY_INFO_RECORD_SIZE: usize = 4096;
// Win32 memory constants.
const MEM_COMMIT: u32 = 0x1000;
const MEM_PRIVATE: u32 = 0x20000;
const PAGE_READWRITE: u32 = 0x04;
const PAGE_EXECUTE_READWRITE: u32 = 0x40;

/// Minidump parse and read errors.
#[derive(Debug, Error)]
pub enum DumpError {
    /// Underlying I/O error.
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
    /// Missing `MDMP` signature, truncated header or out-of-bounds field.
    #[error("invalid minidump: {0}")]
    Invalid(&'static str),
    /// A required stream (module list / memory64 list) is missing.
    #[error("missing minidump stream: {0}")]
    MissingStream(&'static str),
}

type Result<T> = std::result::Result<T, DumpError>;

/// A module loaded in the captured address space.
#[derive(Debug, Clone)]
pub struct Module {
    /// Virtual base address (ASLR applied).
    pub base: u64,
    /// Image size in memory.
    pub size: u32,
    /// Module file name (e.g. `app.exe`).
    pub name: String,
}

/// A captured memory range: virtual span plus offset in the dump file.
#[derive(Debug, Clone, Copy)]
struct Range {
    va: u64,
    size: u64,
    file_off: u64,
}

/// Metadata of one virtual region (from `MemoryInfoList`).
#[derive(Debug, Clone, Copy)]
pub struct Region {
    /// Region base address.
    pub base: u64,
    /// Region size.
    pub size: u64,
    /// `State` Win32 (`MEM_COMMIT`/`MEM_RESERVE`/`MEM_FREE`).
    pub state: u32,
    /// `Protect` Win32 (`PAGE_*`).
    pub protect: u32,
    /// `Type` Win32 (`MEM_PRIVATE`/`MEM_MAPPED`/`MEM_IMAGE`).
    pub mtype: u32,
}

/// Bounded metadata summary for a parsed minidump.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DumpSummary {
    /// Number of loaded modules described by the dump.
    pub module_count: usize,
    /// Number of captured virtual-memory ranges.
    pub range_count: usize,
    /// Number of virtual-memory metadata records.
    pub region_count: usize,
    /// Total number of captured memory bytes.
    pub mapped_bytes: u64,
}

impl Region {
    /// `true` when the region is committed, private and writable (the heap).
    #[must_use]
    pub fn is_heap(&self) -> bool {
        self.state == MEM_COMMIT
            && self.mtype == MEM_PRIVATE
            && (self.protect == PAGE_READWRITE || self.protect == PAGE_EXECUTE_READWRITE)
    }
}

/// A byte pattern to scan for: `bytes[i]` is compared only when `mask[i]` is true.
#[derive(Debug, Clone)]
pub struct Pattern {
    /// Pattern bytes (wildcard positions are ignored).
    pub bytes: Vec<u8>,
    /// Mask: `true` = fixed byte, `false` = wildcard.
    pub mask: Vec<bool>,
}

impl Pattern {
    /// Parses a Cheat-Engine style pattern: `"44 8B ?? 10 ?? C0"`.
    ///
    /// `??`, `?` and `*` are wildcards; every other token is a hex byte.
    ///
    /// # Errors
    /// Returns [`DumpError::Invalid`] when a non-wildcard token is not a valid hex byte.
    pub fn parse(s: &str) -> Result<Self> {
        let mut bytes = Vec::new();
        let mut mask = Vec::new();
        for tok in s.split_whitespace() {
            if tok == "??" || tok == "?" || tok == "*" {
                bytes.push(0);
                mask.push(false);
            } else {
                let b = u8::from_str_radix(tok, 16)
                    .map_err(|_| DumpError::Invalid("invalid hex byte in pattern"))?;
                bytes.push(b);
                mask.push(true);
            }
        }
        if bytes.is_empty() {
            return Err(DumpError::Invalid("empty pattern"));
        }
        Ok(Self { bytes, mask })
    }

    fn first_fixed(&self) -> usize {
        self.mask.iter().position(|&m| m).unwrap_or(0)
    }

    fn matches_at(&self, buf: &[u8], i: usize) -> bool {
        self.bytes
            .iter()
            .zip(&self.mask)
            .enumerate()
            .all(|(k, (b, &keep))| !keep || buf[i + k] == *b)
    }
}

/// A scan hit: its virtual address and, when it falls inside a module, `module + RVA`.
#[derive(Debug, Clone)]
pub struct Hit {
    /// Live virtual address of the hit.
    pub va: u64,
    /// Name of the module containing the address, if any.
    pub module: Option<String>,
    /// Offset from the module base (RVA), if any.
    pub rva: Option<u64>,
}

impl Hit {
    /// Static (unrelocated) address when the hit lies in `module` (ASCII case-insensitive):
    /// `image_base + rva`, with `image_base` the PE `ImageBase` of that module.
    #[must_use]
    pub fn static_address(&self, module: &str, image_base: u64) -> Option<u64> {
        match (self.module.as_deref(), self.rva) {
            (Some(name), Some(rva)) if name.eq_ignore_ascii_case(module) => {
                image_base.checked_add(rva)
            },
            _ => None,
        }
    }
}

#[derive(Debug)]
enum DumpSource {
    File { file: File, len: u64 },
    Bytes(Cursor<Vec<u8>>),
}

impl DumpSource {
    fn len(&self) -> u64 {
        match self {
            Self::File { len, .. } => *len,
            Self::Bytes(cursor) => cursor.get_ref().len() as u64,
        }
    }

    fn read_exact_at(&mut self, off: u64, buf: &mut [u8]) -> Result<()> {
        let source_len = self.len();
        checked_span(off, buf.len(), source_len)?;
        match self {
            Self::File { file, .. } => {
                file.seek(SeekFrom::Start(off))?;
                file.read_exact(buf)?;
            },
            Self::Bytes(cursor) => {
                cursor.set_position(off);
                cursor.read_exact(buf)?;
            },
        }
        Ok(())
    }
}

/// A parsed minidump backed by either a file or owned in-memory bytes.
#[derive(Debug)]
pub struct Minidump {
    source: DumpSource,
    /// Modules loaded at capture time.
    pub modules: Vec<Module>,
    ranges: Vec<Range>, // sorted by va
    starts: Vec<u64>,   // ranges[i].va, for bisection
    regions: Vec<Region>,
    region_starts: Vec<u64>,
}

fn u32le(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]])
}
fn u64le(b: &[u8], o: usize) -> u64 {
    u64::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4], b[o + 5], b[o + 6], b[o + 7]])
}

fn checked_span(off: u64, len: usize, source_len: u64) -> Result<()> {
    let len = u64::try_from(len).map_err(|_| DumpError::Invalid("byte range too large"))?;
    let end = off.checked_add(len).ok_or(DumpError::Invalid("byte range overflow"))?;
    if end > source_len {
        return Err(DumpError::Invalid("byte range outside minidump"));
    }
    Ok(())
}

fn checked_table_len(count: u64, record_size: usize) -> Result<usize> {
    let count = usize::try_from(count).map_err(|_| DumpError::Invalid("record count too large"))?;
    count.checked_mul(record_size).ok_or(DumpError::Invalid("record table too large"))
}

fn read_at(source: &mut DumpSource, off: u64, len: usize) -> Result<Vec<u8>> {
    checked_span(off, len, source.len())?;
    let mut buf = vec![0u8; len];
    source.read_exact_at(off, &mut buf)?;
    Ok(buf)
}

/// Demangles an MSVC RTTI type name (`.?AVFoo@bar@@` -> `bar::Foo`).
fn demangle(n: &str) -> String {
    let rest = n.strip_prefix(".?AV").or_else(|| n.strip_prefix(".?AU")).unwrap_or(n);
    let rest = rest.strip_suffix("@@").unwrap_or(rest);
    rest.split('@').filter(|p| !p.is_empty()).rev().collect::<Vec<_>>().join("::")
}

impl Minidump {
    /// Opens a `.dmp` and parses its header, modules and memory regions.
    ///
    /// # Errors
    /// Returns [`DumpError`] when the file is not an `MDMP` minidump or a required stream
    /// (module list / memory64 list) is missing.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let file = File::open(path)?;
        let len = file.metadata()?.len();
        Self::parse(DumpSource::File { file, len })
    }

    /// Parses a minidump from borrowed bytes.
    ///
    /// The bytes are copied once so the returned dump owns its source and does not expose a
    /// lifetime parameter. Use [`Minidump::from_owned_bytes`] to transfer an existing buffer
    /// without copying it.
    ///
    /// # Errors
    /// Returns [`DumpError`] when the bytes are truncated, malformed, or omit a required stream.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        Self::from_owned_bytes(bytes.to_vec())
    }

    /// Parses a minidump from an owned byte buffer without copying its contents.
    ///
    /// # Errors
    /// Returns [`DumpError`] when the bytes are truncated, malformed, or omit a required stream.
    pub fn from_owned_bytes(bytes: Vec<u8>) -> Result<Self> {
        Self::parse(DumpSource::Bytes(Cursor::new(bytes)))
    }

    fn parse(mut source: DumpSource) -> Result<Self> {
        let source_len = source.len();

        let header = read_at(&mut source, 0, HEADER_SIZE)?;
        if &header[0..4] != b"MDMP" {
            return Err(DumpError::Invalid("missing MDMP signature"));
        }
        let n_streams = u64::from(u32le(&header, 8));
        if n_streams > MAX_STREAM_COUNT {
            return Err(DumpError::Invalid("stream count exceeds safety limit"));
        }
        let dir_rva = u32le(&header, 12) as u64;

        let directory_len = checked_table_len(n_streams, DIRECTORY_RECORD_SIZE)?;
        checked_span(dir_rva, directory_len, source_len)?;
        let dir = read_at(&mut source, dir_rva, directory_len)?;
        let mut module_loc = None;
        let mut mem64_loc = None;
        let mut info_loc = None;
        for i in 0..usize::try_from(n_streams)
            .map_err(|_| DumpError::Invalid("stream count too large"))?
        {
            let o = i * DIRECTORY_RECORD_SIZE;
            let stype = u32le(&dir, o);
            let size = u32le(&dir, o + 4) as usize;
            let rva = u32le(&dir, o + 8) as u64;
            checked_span(rva, size, source_len)?;
            match stype {
                STREAM_MODULE_LIST => module_loc = Some((rva, size)),
                STREAM_MEMORY64_LIST => mem64_loc = Some((rva, size)),
                STREAM_MEMORY_INFO_LIST => info_loc = Some((rva, size)),
                _ => {},
            }
        }

        let (mrva, msize) = module_loc.ok_or(DumpError::MissingStream("ModuleList"))?;
        let modules = Self::parse_modules(&mut source, source_len, mrva, msize)?;

        let (rrva, rsize) = mem64_loc.ok_or(DumpError::MissingStream("Memory64List"))?;
        let mut ranges = Self::parse_ranges(&mut source, source_len, rrva, rsize)?;
        ranges.sort_by_key(|r| r.va);
        let starts = ranges.iter().map(|r| r.va).collect();

        let mut regions = match info_loc {
            Some((irva, isize)) => Self::parse_regions(&mut source, source_len, irva, isize)?,
            None => Vec::new(),
        };
        regions.sort_by_key(|r| r.base);
        let region_starts = regions.iter().map(|r| r.base).collect();

        Ok(Self { source, modules, ranges, starts, regions, region_starts })
    }

    fn parse_modules(
        source: &mut DumpSource,
        source_len: u64,
        rva: u64,
        size: usize,
    ) -> Result<Vec<Module>> {
        if size < 4 {
            return Err(DumpError::Invalid("module list stream too short"));
        }
        let count_buf = read_at(source, rva, 4)?;
        let count = u64::from(u32le(&count_buf, 0));
        if count > MAX_MODULE_COUNT {
            return Err(DumpError::Invalid("module count exceeds safety limit"));
        }
        let records_len = checked_table_len(count, MODULE_RECORD_SIZE)?;
        let required_len =
            4usize.checked_add(records_len).ok_or(DumpError::Invalid("module list too large"))?;
        if required_len > size {
            return Err(DumpError::Invalid("truncated module list"));
        }
        let buf = read_at(source, rva, required_len)?;
        let count =
            usize::try_from(count).map_err(|_| DumpError::Invalid("module count too large"))?;
        let mut mods = Vec::with_capacity(count);
        for i in 0..count {
            let o = 4 + i * MODULE_RECORD_SIZE;
            let base = u64le(&buf, o);
            let isize = u32le(&buf, o + 8);
            base.checked_add(u64::from(isize))
                .ok_or(DumpError::Invalid("module address range overflow"))?;
            let name_rva = u32le(&buf, o + 20) as u64;
            let len_buf = read_at(source, name_rva, 4)?;
            let nlen = u32le(&len_buf, 0) as usize;
            if nlen > MAX_MODULE_NAME_BYTES || !nlen.is_multiple_of(2) {
                return Err(DumpError::Invalid("invalid module name length"));
            }
            let name_data_rva =
                name_rva.checked_add(4).ok_or(DumpError::Invalid("module name offset overflow"))?;
            checked_span(name_data_rva, nlen, source_len)?;
            let name_bytes = read_at(source, name_data_rva, nlen)?;
            let units: Vec<u16> = name_bytes
                .as_chunks::<2>()
                .0
                .iter()
                .map(|chunk| u16::from_le_bytes(*chunk))
                .collect();
            let full = String::from_utf16_lossy(&units);
            let name = full.rsplit(['\\', '/']).next().unwrap_or(&full).to_string();
            mods.push(Module { base, size: isize, name });
        }
        Ok(mods)
    }

    fn parse_ranges(
        source: &mut DumpSource,
        source_len: u64,
        rva: u64,
        stream_size: usize,
    ) -> Result<Vec<Range>> {
        if stream_size < 16 {
            return Err(DumpError::Invalid("memory range stream too short"));
        }
        let head = read_at(source, rva, 16)?;
        let count = u64le(&head, 0);
        if count > MAX_MEMORY_RANGE_COUNT {
            return Err(DumpError::Invalid("memory range count exceeds safety limit"));
        }
        let base_rva = u64le(&head, 8);
        let desc_len = checked_table_len(count, 16)?;
        let required_len = 16usize
            .checked_add(desc_len)
            .ok_or(DumpError::Invalid("memory range table too large"))?;
        if required_len > stream_size {
            return Err(DumpError::Invalid("truncated memory range table"));
        }
        let desc_rva =
            rva.checked_add(16).ok_or(DumpError::Invalid("memory range table offset overflow"))?;
        let descs = read_at(source, desc_rva, desc_len)?;
        let count = usize::try_from(count)
            .map_err(|_| DumpError::Invalid("memory range count too large"))?;
        let mut ranges = Vec::with_capacity(count);
        let mut off = base_rva;
        for i in 0..count {
            let o = i * 16;
            let va = u64le(&descs, o);
            let dsz = u64le(&descs, o + 8);
            va.checked_add(dsz).ok_or(DumpError::Invalid("virtual memory range overflow"))?;
            let dsz_usize = usize::try_from(dsz)
                .map_err(|_| DumpError::Invalid("captured memory range too large"))?;
            checked_span(off, dsz_usize, source_len)?;
            ranges.push(Range { va, size: dsz, file_off: off });
            off = off
                .checked_add(dsz)
                .ok_or(DumpError::Invalid("captured memory offset overflow"))?;
        }
        Ok(ranges)
    }

    fn parse_regions(
        source: &mut DumpSource,
        source_len: u64,
        rva: u64,
        stream_size: usize,
    ) -> Result<Vec<Region>> {
        if stream_size < 16 {
            return Err(DumpError::Invalid("memory info stream too short"));
        }
        // MINIDUMP_MEMORY_INFO_LIST : u32 SizeOfHeader, u32 SizeOfEntry, u64 NumberOfEntries.
        let head = read_at(source, rva, 16)?;
        let soh = u32le(&head, 0) as u64;
        let soe = u32le(&head, 4) as usize;
        let count = u64le(&head, 8);
        if count > MAX_MEMORY_INFO_COUNT {
            return Err(DumpError::Invalid("memory info count exceeds safety limit"));
        }
        if soh < 16 || !(MEMORY_INFO_RECORD_SIZE..=MAX_MEMORY_INFO_RECORD_SIZE).contains(&soe) {
            return Err(DumpError::Invalid("invalid memory info record size"));
        }
        let table_len = checked_table_len(count, soe)?;
        let required_len = soh
            .checked_add(
                u64::try_from(table_len)
                    .map_err(|_| DumpError::Invalid("memory info table too large"))?,
            )
            .ok_or(DumpError::Invalid("memory info table too large"))?;
        if required_len
            > u64::try_from(stream_size)
                .map_err(|_| DumpError::Invalid("memory info stream too large"))?
        {
            return Err(DumpError::Invalid("truncated memory info table"));
        }
        let table_rva =
            rva.checked_add(soh).ok_or(DumpError::Invalid("memory info table offset overflow"))?;
        checked_span(table_rva, table_len, source_len)?;
        let buf = read_at(source, table_rva, table_len)?;
        let count = usize::try_from(count)
            .map_err(|_| DumpError::Invalid("memory info count too large"))?;
        let mut out = Vec::with_capacity(count);
        for i in 0..count {
            let o = i * soe;
            // u64 Base, u64 Alloc, u32 AllocProt, u32 a1, u64 RegionSize, u32 State, u32 Protect, u32 Type, u32 a2
            let base = u64le(&buf, o);
            let size = u64le(&buf, o + 24);
            base.checked_add(size).ok_or(DumpError::Invalid("virtual memory region overflow"))?;
            out.push(Region {
                base,
                size,
                state: u32le(&buf, o + 32),
                protect: u32le(&buf, o + 36),
                mtype: u32le(&buf, o + 40),
            });
        }
        Ok(out)
    }

    /// Module (name, base, size) by file name, ASCII case-insensitive.
    #[must_use]
    pub fn module(&self, name: &str) -> Option<&Module> {
        self.modules.iter().find(|m| m.name.eq_ignore_ascii_case(name))
    }

    /// Total captured memory bytes across all ranges.
    #[must_use]
    pub fn mapped_bytes(&self) -> u64 {
        self.ranges.iter().map(|r| r.size).sum()
    }

    /// Returns a fixed-size summary without exposing or copying captured memory contents.
    #[must_use]
    pub fn summary(&self) -> DumpSummary {
        DumpSummary {
            module_count: self.modules.len(),
            range_count: self.ranges.len(),
            region_count: self.regions.len(),
            mapped_bytes: self.mapped_bytes(),
        }
    }

    /// Number of captured memory ranges.
    #[must_use]
    pub fn range_count(&self) -> usize {
        self.ranges.len()
    }

    /// Memory regions (with protections), sorted by address.
    #[must_use]
    pub fn regions(&self) -> &[Region] {
        &self.regions
    }

    fn classify(&self, va: u64) -> (Option<String>, Option<u64>) {
        for m in &self.modules {
            let end = m.base + u64::from(m.size);
            if va >= m.base && va < end {
                return (Some(m.name.clone()), Some(va - m.base));
            }
        }
        (None, None)
    }

    /// Region containing `va`, if any.
    #[must_use]
    pub fn region_of(&self, va: u64) -> Option<&Region> {
        if self.region_starts.is_empty() {
            return None;
        }
        let i = self.region_starts.partition_point(|&s| s <= va);
        if i == 0 {
            return None;
        }
        let r = &self.regions[i - 1];
        let end = r.base + r.size;
        (va >= r.base && va < end).then_some(r)
    }

    fn seg(&self, va: u64) -> Option<Range> {
        if self.starts.is_empty() {
            return None;
        }
        let i = self.starts.partition_point(|&s| s <= va);
        if i == 0 {
            return None;
        }
        let r = self.ranges[i - 1];
        let end = r.va + r.size;
        (va >= r.va && va < end).then_some(r)
    }

    fn read_into(&mut self, off: u64, buf: &mut [u8]) -> Option<()> {
        self.source.read_exact_at(off, buf).ok()?;
        Some(())
    }

    /// Reads `n` bytes at virtual address `va`, stitching contiguous ranges if needed.
    /// Returns `None` when part of `[va, va+n)` is not captured.
    pub fn read(&mut self, va: u64, n: usize) -> Option<Vec<u8>> {
        let mut out = vec![0u8; n];
        let mut filled = 0usize;
        let mut cur = va;
        while filled < n {
            let r = self.seg(cur)?;
            let within = cur - r.va;
            let take = ((n - filled) as u64).min(r.size - within) as usize;
            let source_off = r.file_off.checked_add(within)?;
            self.read_into(source_off, &mut out[filled..filled + take])?;
            filled += take;
            cur = cur.checked_add(take as u64)?;
        }
        Some(out)
    }

    /// Little-endian `u32` read at virtual address `va`.
    pub fn u32_at(&mut self, va: u64) -> Option<u32> {
        self.read(va, 4).map(|b| u32le(&b, 0))
    }
    /// Little-endian `i32` read.
    pub fn i32_at(&mut self, va: u64) -> Option<i32> {
        self.u32_at(va).map(|v| v as i32)
    }
    /// Little-endian `u16` read.
    pub fn u16_at(&mut self, va: u64) -> Option<u16> {
        self.read(va, 2).map(|b| u16::from_le_bytes([b[0], b[1]]))
    }
    /// Little-endian `u64` / pointer read.
    pub fn u64_at(&mut self, va: u64) -> Option<u64> {
        self.read(va, 8).map(|b| u64le(&b, 0))
    }
    /// Little-endian `f32` read.
    pub fn f32_at(&mut self, va: u64) -> Option<f32> {
        self.u32_at(va).map(f32::from_bits)
    }

    /// Virtual span `(va, size)` of a PE section of a loaded module (e.g. `b".rdata"`).
    pub fn module_section(&mut self, base: u64, name: &[u8]) -> Option<(u64, u32)> {
        let e = u64::from(self.u32_at(base + 0x3c)?);
        let pe = base + e;
        let nsec = self.u16_at(pe + 6)?;
        let opt = u64::from(self.u16_at(pe + 20)?);
        let sect = pe + 24 + opt;
        for i in 0..u64::from(nsec) {
            let o = sect + i * 40;
            let raw = self.read(o, 8)?;
            let nm: Vec<u8> = raw.into_iter().take_while(|&c| c != 0).collect();
            if nm == name {
                let vsize = self.u32_at(o + 8)?;
                let va = base + u64::from(self.u32_at(o + 12)?);
                return Some((va, vsize));
            }
        }
        None
    }

    /// Resolves the MSVC (x64) RTTI class name of a vtable (`.?AVFoo@@` -> `Foo`).
    /// Returns `None` when the vtable has no valid `CompleteObjectLocator`.
    pub fn rtti_name(&mut self, vtable_va: u64) -> Option<String> {
        let col = self.u64_at(vtable_va.checked_sub(8)?)?;
        let pself = u64::from(self.u32_at(col + 20)?);
        let ptd = u64::from(self.u32_at(col + 12)?);
        let image_base = col.checked_sub(pself)?;
        let td = image_base + ptd;
        let raw = self.read(td + 16, 256)?;
        let end = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
        let name = std::str::from_utf8(&raw[..end]).ok()?;
        name.starts_with(".?A").then(|| demangle(name))
    }

    /// Live-object census: counts heap (committed/private/RW) qwords pointing into
    /// `[vtable_lo, vtable_hi)` (typically the main module `.rdata`).
    /// Returns `(vtable_va, count)` sorted by descending count.
    pub fn vtable_census(&mut self, vtable_lo: u64, vtable_hi: u64) -> Vec<(u64, u32)> {
        let ranges = self.ranges.clone();
        let mut counts: HashMap<u64, u32> = HashMap::new();
        let mut buf = Vec::new();
        for r in ranges {
            if !self.region_of(r.va).is_some_and(Region::is_heap) {
                continue;
            }
            let n = (r.size as usize) & !7;
            if n == 0 {
                continue;
            }
            buf.clear();
            buf.resize(n, 0);
            if self.read_into(r.file_off, &mut buf).is_none() {
                continue;
            }
            for chunk in buf.as_chunks::<8>().0 {
                let q = u64::from_le_bytes(*chunk);
                if q >= vtable_lo && q < vtable_hi {
                    *counts.entry(q).or_insert(0) += 1;
                }
            }
        }
        let mut v: Vec<(u64, u32)> = counts.into_iter().collect();
        v.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        v
    }

    /// Scans one pattern over all captured memory.
    ///
    /// # Errors
    /// Propagates dump read errors.
    pub fn scan(&mut self, pattern: &Pattern) -> Result<Vec<Hit>> {
        Ok(self.scan_many(std::slice::from_ref(pattern))?.pop().unwrap_or_default())
    }

    /// Scans several patterns in **one pass** over the dump (each range is read once).
    ///
    /// Returns a vector parallel to `patterns`: `out[i]` holds the hits of `patterns[i]`.
    ///
    /// # Errors
    /// Propagates dump read errors.
    pub fn scan_many(&mut self, patterns: &[Pattern]) -> Result<Vec<Vec<Hit>>> {
        let mut out: Vec<Vec<Hit>> = vec![Vec::new(); patterns.len()];
        let ranges = self.ranges.clone();
        let mut buf = Vec::new();
        for r in &ranges {
            let len = r.size as usize;
            buf.clear();
            buf.resize(len, 0);
            self.source.read_exact_at(r.file_off, &mut buf)?;
            for (pi, pat) in patterns.iter().enumerate() {
                let n = pat.bytes.len();
                if len < n {
                    continue;
                }
                let anchor = pat.first_fixed();
                let anchor_byte = pat.bytes[anchor];
                let last = len - n;
                let mut i = 0;
                while i <= last {
                    if buf[i + anchor] == anchor_byte && pat.matches_at(&buf, i) {
                        let va = r.va + i as u64;
                        let (module, rva) = self.classify(va);
                        out[pi].push(Hit { va, module, rva });
                    }
                    i += 1;
                }
            }
        }
        Ok(out)
    }

    /// Like [`Minidump::scan`] but stops after `limit` hits: ranges can be hundreds of MB, so
    /// bounding the output also bounds the remaining work.
    ///
    /// # Errors
    /// Propagates dump read errors.
    pub fn scan_limited(&mut self, pattern: &Pattern, limit: usize) -> Result<Vec<Hit>> {
        let mut out: Vec<Hit> = Vec::new();
        let ranges = self.ranges.clone();
        let mut buf = Vec::new();
        let n = pattern.bytes.len();
        let anchor = pattern.first_fixed();
        let anchor_byte = pattern.bytes[anchor];
        for r in &ranges {
            if out.len() >= limit {
                break;
            }
            let len = r.size as usize;
            if len < n {
                continue;
            }
            buf.clear();
            buf.resize(len, 0);
            self.source.read_exact_at(r.file_off, &mut buf)?;
            let last = len - n;
            let mut i = 0;
            while i <= last {
                if buf[i + anchor] == anchor_byte && pattern.matches_at(&buf, i) {
                    let va = r.va + i as u64;
                    let (module, rva) = self.classify(va);
                    out.push(Hit { va, module, rva });
                    if out.len() >= limit {
                        break;
                    }
                }
                i += 1;
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_MODULE_BASE: u64 = 0x1_4000_0000;

    fn put_u32(bytes: &mut [u8], offset: usize, value: u32) {
        bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    fn put_u64(bytes: &mut [u8], offset: usize, value: u64) {
        bytes[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
    }

    fn test_minidump() -> Vec<u8> {
        const STREAM_COUNT: usize = 3;
        let mut bytes = vec![0; HEADER_SIZE + STREAM_COUNT * DIRECTORY_RECORD_SIZE];

        let module_rva = bytes.len();
        bytes.resize(module_rva + 4 + MODULE_RECORD_SIZE, 0);

        let module_name: Vec<u8> =
            r"C:\game\app.exe".encode_utf16().flat_map(u16::to_le_bytes).collect();
        let module_name_rva = bytes.len();
        bytes.extend_from_slice(&(module_name.len() as u32).to_le_bytes());
        bytes.extend_from_slice(&module_name);

        let memory_list_rva = bytes.len();
        bytes.resize(memory_list_rva + 32, 0);

        let memory_info_rva = bytes.len();
        bytes.resize(memory_info_rva + 16 + MEMORY_INFO_RECORD_SIZE, 0);

        let captured = [0x00, 0xDE, 0xAD, 0xBE, 0xEF, 0x00];
        let captured_rva = bytes.len();
        bytes.extend_from_slice(&captured);

        bytes[0..4].copy_from_slice(b"MDMP");
        put_u32(&mut bytes, 8, STREAM_COUNT as u32);
        put_u32(&mut bytes, 12, HEADER_SIZE as u32);

        let module_directory = HEADER_SIZE;
        put_u32(&mut bytes, module_directory, STREAM_MODULE_LIST);
        put_u32(&mut bytes, module_directory + 4, (4 + MODULE_RECORD_SIZE) as u32);
        put_u32(&mut bytes, module_directory + 8, module_rva as u32);

        let memory_directory = module_directory + DIRECTORY_RECORD_SIZE;
        put_u32(&mut bytes, memory_directory, STREAM_MEMORY64_LIST);
        put_u32(&mut bytes, memory_directory + 4, 32);
        put_u32(&mut bytes, memory_directory + 8, memory_list_rva as u32);

        let info_directory = memory_directory + DIRECTORY_RECORD_SIZE;
        put_u32(&mut bytes, info_directory, STREAM_MEMORY_INFO_LIST);
        put_u32(&mut bytes, info_directory + 4, (16 + MEMORY_INFO_RECORD_SIZE) as u32);
        put_u32(&mut bytes, info_directory + 8, memory_info_rva as u32);

        put_u32(&mut bytes, module_rva, 1);
        let module = module_rva + 4;
        put_u64(&mut bytes, module, TEST_MODULE_BASE);
        put_u32(&mut bytes, module + 8, 0x1000);
        put_u32(&mut bytes, module + 20, module_name_rva as u32);

        put_u64(&mut bytes, memory_list_rva, 1);
        put_u64(&mut bytes, memory_list_rva + 8, captured_rva as u64);
        put_u64(&mut bytes, memory_list_rva + 16, TEST_MODULE_BASE);
        put_u64(&mut bytes, memory_list_rva + 24, captured.len() as u64);

        put_u32(&mut bytes, memory_info_rva, 16);
        put_u32(&mut bytes, memory_info_rva + 4, MEMORY_INFO_RECORD_SIZE as u32);
        put_u64(&mut bytes, memory_info_rva + 8, 1);
        let region = memory_info_rva + 16;
        put_u64(&mut bytes, region, TEST_MODULE_BASE);
        put_u64(&mut bytes, region + 24, captured.len() as u64);
        put_u32(&mut bytes, region + 32, MEM_COMMIT);
        put_u32(&mut bytes, region + 36, PAGE_READWRITE);
        put_u32(&mut bytes, region + 40, MEM_PRIVATE);

        bytes
    }

    #[test]
    fn parse_aob_with_wildcards() {
        let p = Pattern::parse("44 8B ?? 10 ?? C0").unwrap();
        assert_eq!(p.bytes, vec![0x44, 0x8B, 0x00, 0x10, 0x00, 0xC0]);
        assert_eq!(p.mask, vec![true, true, false, true, false, true]);
        assert_eq!(p.first_fixed(), 0);
    }

    #[test]
    fn parse_aob_rejects_garbage() {
        assert!(Pattern::parse("44 ZZ").is_err());
        assert!(Pattern::parse("   ").is_err());
    }

    #[test]
    fn matches_respects_mask() {
        let p = Pattern::parse("AA ?? CC").unwrap();
        assert!(p.matches_at(&[0xAA, 0x12, 0xCC], 0));
        assert!(p.matches_at(&[0xAA, 0xFF, 0xCC], 0));
        assert!(!p.matches_at(&[0xAB, 0x12, 0xCC], 0));
    }

    #[test]
    fn static_address_translates_rva_in_the_named_module() {
        let h = Hit { va: 0, module: Some("app.exe".to_string()), rva: Some(0xD7_2145) };
        assert_eq!(h.static_address("APP.EXE", 0x1_4000_0000), Some(0x1_40D7_2145));
        assert_eq!(h.static_address("other.dll", 0x1_4000_0000), None);
    }

    #[test]
    fn demangle_msvc_rtti() {
        assert_eq!(demangle(".?AVCUniformBlock@lives@@"), "lives::CUniformBlock");
        assert_eq!(demangle(".?AUFoo@@"), "Foo");
        assert_eq!(demangle(".?AVCObjLua@game@@"), "game::CObjLua");
    }

    #[test]
    fn heap_region_predicate() {
        let r = Region {
            base: 0x1000,
            size: 0x1000,
            state: MEM_COMMIT,
            protect: PAGE_READWRITE,
            mtype: MEM_PRIVATE,
        };
        assert!(r.is_heap());
        let img = Region { mtype: 0x1000000, ..r };
        assert!(!img.is_heap());
    }

    #[test]
    fn parses_borrowed_bytes_and_reports_bounded_summary() {
        let bytes = test_minidump();
        let mut dump = Minidump::from_bytes(&bytes).unwrap();

        assert_eq!(
            dump.summary(),
            DumpSummary { module_count: 1, range_count: 1, region_count: 1, mapped_bytes: 6 }
        );
        assert_eq!(dump.module("APP.EXE").unwrap().base, TEST_MODULE_BASE);
        assert_eq!(dump.read(TEST_MODULE_BASE + 1, 4).unwrap(), [0xDE, 0xAD, 0xBE, 0xEF]);
        assert!(dump.region_of(TEST_MODULE_BASE).unwrap().is_heap());
    }

    #[test]
    fn parses_owned_bytes_and_scans_captured_memory() {
        let mut dump = Minidump::from_owned_bytes(test_minidump()).unwrap();
        let hits = dump.scan(&Pattern::parse("DE AD ?? EF").unwrap()).unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].va, TEST_MODULE_BASE + 1);
        assert_eq!(hits[0].module.as_deref(), Some("app.exe"));
        assert_eq!(hits[0].rva, Some(1));
        assert_eq!(hits[0].static_address("app.exe", TEST_MODULE_BASE), Some(TEST_MODULE_BASE + 1));
    }

    #[test]
    fn preserves_file_backed_open_api() {
        let path =
            std::env::temp_dir().join(format!("aphrody-re-minidump-{}.dmp", std::process::id()));
        std::fs::write(&path, test_minidump()).unwrap();

        let result = Minidump::open(&path).map(|dump| dump.summary());
        std::fs::remove_file(path).unwrap();

        assert_eq!(result.unwrap().module_count, 1);
    }

    #[test]
    fn rejects_untrusted_byte_ranges_without_panicking() {
        let mut truncated_directory = test_minidump();
        put_u32(&mut truncated_directory, 8, u32::MAX);
        assert!(matches!(
            Minidump::from_owned_bytes(truncated_directory),
            Err(DumpError::Invalid("stream count exceeds safety limit"))
        ));

        let mut overflowing_range = test_minidump();
        let memory_directory = HEADER_SIZE + DIRECTORY_RECORD_SIZE;
        let memory_list_rva = u32le(&overflowing_range, memory_directory + 8) as usize;
        put_u64(&mut overflowing_range, memory_list_rva + 24, u64::MAX);
        assert!(matches!(
            Minidump::from_owned_bytes(overflowing_range),
            Err(DumpError::Invalid("virtual memory range overflow"))
        ));
    }
}

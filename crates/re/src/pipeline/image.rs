// SPDX-License-Identifier: Apache-2.0
//! Memory image of a PE or ELF binary: mapped segments, imports, exports and symbols.

use std::collections::BTreeMap;

/// Mapped section/segment.
#[derive(Debug, Clone)]
pub struct Segment {
    /// Name.
    pub name: String,
    /// Virtual address.
    pub vaddr: u64,
    /// Virtual size.
    pub vsize: u64,
    /// File-backed bytes.
    pub data: Vec<u8>,
    /// Executable.
    pub exec: bool,
    /// Writable.
    pub write: bool,
}

/// Import symbol.
#[derive(Debug, Clone)]
pub struct ImportSym {
    /// Symbol name.
    pub name: String,
    /// Library.
    pub lib: Option<String>,
}

/// Loaded image.
#[derive(Debug, Clone)]
pub struct Image {
    /// `pe` or `elf`.
    pub format: &'static str,
    /// 32 or 64.
    pub bits: u8,
    /// Preferred base.
    pub base: u64,
    /// Entry address.
    pub entry: u64,
    /// Segments sorted by address.
    pub segments: Vec<Segment>,
    /// Imports keyed by IAT slot (PE) or PLT stub (ELF) address.
    pub imports: BTreeMap<u64, ImportSym>,
    /// True when `imports` keys are stubs reached by `call`, false when they are slots read by `call [slot]`.
    pub imports_are_stubs: bool,
    /// Named code entry points (exports and function symbols).
    pub symbols: BTreeMap<u64, String>,
}

impl Image {
    /// Parse a PE32/PE32+ or x86/x86-64 ELF.
    ///
    /// # Errors
    /// Returns a message when the bytes are not a supported x86 PE/ELF.
    pub fn load(bytes: &[u8]) -> Result<Self, String> {
        if bytes.starts_with(b"\x7fELF") {
            let elf = goblin::elf::Elf::parse(bytes).map_err(|e| e.to_string())?;
            load_elf(&elf, bytes)
        } else if bytes.starts_with(b"MZ") {
            let pe = goblin::pe::PE::parse(bytes).map_err(|e| e.to_string())?;
            load_pe(&pe, bytes)
        } else {
            Err("not a PE or ELF image".into())
        }
    }

    /// Segment containing `addr` with file-backed data.
    #[must_use]
    pub fn segment_at(&self, addr: u64) -> Option<&Segment> {
        self.segments
            .iter()
            .find(|s| addr >= s.vaddr && addr < s.vaddr + s.data.len() as u64)
    }

    /// Whether `addr` lies in an executable segment.
    #[must_use]
    pub fn is_code(&self, addr: u64) -> bool {
        self.segment_at(addr).is_some_and(|s| s.exec)
    }

    /// Read `n` bytes at `addr` when fully file-backed.
    #[must_use]
    pub fn read(&self, addr: u64, n: usize) -> Option<&[u8]> {
        let s = self.segment_at(addr)?;
        let off = (addr - s.vaddr) as usize;
        s.data.get(off..off + n)
    }

    /// Highest mapped address (exclusive).
    #[must_use]
    pub fn end(&self) -> u64 {
        self.segments.iter().map(|s| s.vaddr + s.vsize.max(s.data.len() as u64)).max().unwrap_or(0)
    }
}

fn load_pe(pe: &goblin::pe::PE, bytes: &[u8]) -> Result<Image, String> {
    let base = pe.image_base;
    let mut segments = Vec::new();
    for s in &pe.sections {
        let name = s.name().unwrap_or("?").to_string();
        let off = s.pointer_to_raw_data as usize;
        let raw = s.size_of_raw_data as usize;
        let vsize = u64::from(s.virtual_size.max(s.size_of_raw_data));
        let take = raw.min(vsize as usize);
        let data = bytes.get(off..off.saturating_add(take)).unwrap_or(&[]).to_vec();
        let ch = s.characteristics;
        segments.push(Segment {
            name,
            vaddr: base + u64::from(s.virtual_address),
            vsize,
            data,
            exec: ch & 0x2000_0000 != 0 || ch & 0x20 != 0,
            write: ch & 0x8000_0000 != 0,
        });
    }
    segments.sort_by_key(|s| s.vaddr);
    let mut imports = BTreeMap::new();
    for i in &pe.imports {
        imports.insert(
            base + i.offset as u64,
            ImportSym { name: i.name.to_string(), lib: Some(i.dll.to_string()) },
        );
    }
    let mut symbols = BTreeMap::new();
    for e in &pe.exports {
        if let Some(n) = e.name {
            symbols.insert(base + e.rva as u64, n.to_string());
        }
    }
    Ok(Image {
        format: "pe",
        bits: if pe.is_64 { 64 } else { 32 },
        base,
        entry: base + u64::from(pe.entry),
        segments,
        imports,
        imports_are_stubs: false,
        symbols,
    })
}

fn load_elf(elf: &goblin::elf::Elf, bytes: &[u8]) -> Result<Image, String> {
    use goblin::elf::{header, program_header::PT_LOAD};
    let bits = match elf.header.e_machine {
        header::EM_X86_64 => 64,
        header::EM_386 => 32,
        m => return Err(format!("ELF machine {m} is not x86/x86-64")),
    };
    let mut segments = Vec::new();
    for (i, ph) in elf.program_headers.iter().enumerate() {
        if ph.p_type != PT_LOAD {
            continue;
        }
        let off = ph.p_offset as usize;
        let data = bytes.get(off..off.saturating_add(ph.p_filesz as usize)).unwrap_or(&[]).to_vec();
        segments.push(Segment {
            name: format!("load{i}"),
            vaddr: ph.p_vaddr,
            vsize: ph.p_memsz,
            data,
            exec: ph.p_flags & 1 != 0,
            write: ph.p_flags & 2 != 0,
        });
    }
    segments.sort_by_key(|s| s.vaddr);
    // PLT stubs: entry i of `.plt.sec` (or i+1 of `.plt`) corresponds to pltrelocs[i].
    let mut imports = BTreeMap::new();
    let names: Vec<String> = elf
        .pltrelocs
        .iter()
        .map(|r| elf.dynsyms.get(r.r_sym).and_then(|s| elf.dynstrtab.get_at(s.st_name)).unwrap_or("?").to_string())
        .collect();
    for sh in &elf.section_headers {
        let sname = elf.shdr_strtab.get_at(sh.sh_name).unwrap_or("");
        let skip = match sname {
            ".plt.sec" | ".plt.got" => 0,
            ".plt" => 1,
            _ => continue,
        };
        let ent = if sname == ".plt.got" { 8 } else { 16 };
        let n = sh.sh_size / ent;
        for k in skip..n {
            let idx = (k - skip) as usize;
            if sname == ".plt.got" {
                continue;
            }
            if let Some(name) = names.get(idx) {
                imports.insert(sh.sh_addr + k * ent, ImportSym { name: name.clone(), lib: None });
            }
        }
    }
    let mut symbols = BTreeMap::new();
    for s in elf.syms.iter().chain(elf.dynsyms.iter()) {
        if s.is_function() && s.st_value != 0 && s.st_shndx != 0 {
            let name = elf
                .strtab
                .get_at(s.st_name)
                .or_else(|| elf.dynstrtab.get_at(s.st_name))
                .unwrap_or("");
            if !name.is_empty() {
                symbols.entry(s.st_value).or_insert_with(|| name.to_string());
            }
        }
    }
    Ok(Image {
        format: "elf",
        bits,
        base: segments.first().map_or(0, |s| s.vaddr),
        entry: elf.entry,
        segments,
        imports,
        imports_are_stubs: true,
        symbols,
    })
}

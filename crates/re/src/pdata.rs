// SPDX-License-Identifier: Apache-2.0
// Generic `.pdata` byte parser, extracted from aphrody-nie-re (same Apache-2.0 license, aphrody-labs).
//! Découverte **autoritaire** des fonctions via la table `.pdata` (exception
//! unwind x86-64), et mesure du désalignement de l'index Ghidra.
//!
//! ## Pourquoi
//!
//! L'index `aphrody-nie-index.json` fournit ~60 000 adresses `FUN_<hex>` supposées être
//! des débuts de fonction. La vérification byte-à-byte contre `.pdata` (la table
//! d'unwind générée par le compilateur, vérité terrain incontestable) montre que
//! ces adresses sont **massivement désalignées** : ~96 % ne sont pas des débuts
//! de fonction réels (84 % tombent *strictement à l'intérieur* d'un corps de
//! fonction `.pdata`), et l'ensemble est artificiellement aligné sur 16 octets à
//! 99 %. L'index reste exploitable comme **graphe de métadonnées** (chaînes,
//! namespaces, relations d'appel) mais ses **adresses ne sont pas fiables**.
//!
//! `.pdata` donne la liste réelle : chaque `RUNTIME_FUNCTION` (12 octets :
//! `begin_rva`, `end_rva`, `unwind_rva`) décrit une région de code avec ses
//! bornes. Certaines entrées sont des **fragments chaînés** (`UNW_FLAG_CHAININFO`)
//! — des morceaux d'une fonction plus grande, pas des débuts. On les écarte par
//! lecture du `UNWIND_INFO` ; les entrées **racines** restantes sont les vraies
//! fonctions.
//!
//! ## Limite (honnêteté)
//!
//! `.pdata` ne couvre que les fonctions **avec** information d'unwind (cadre de
//! pile). Les fonctions feuilles triviales sans cadre n'y figurent pas : la liste
//! `.pdata` est un plancher autoritaire, pas un plafond.

use goblin::pe::PE;

/// Errors of the `.pdata` byte parser.
#[derive(Debug, thiserror::Error)]
pub enum PdataError {
    /// goblin could not parse the PE image.
    #[error("goblin: parse PE: {0}")]
    Parse(String),
    /// The image has no `.pdata` section.
    #[error("missing .pdata section")]
    Missing,
    /// The `.pdata` file range overflowed.
    #[error(".pdata file range overflow")]
    Overflow,
    /// The `.pdata` file range lies outside the image.
    #[error(".pdata outside file bounds")]
    OutOfBounds,
}

/// Result alias of this module.
pub type Result<T> = core::result::Result<T, PdataError>;

/// `UNW_FLAG_CHAININFO` : l'entrée est un fragment chaîné à une fonction parente,
/// pas un début de fonction.
const UNW_FLAG_CHAININFO: u8 = 0x4;

/// Hard ceiling for roots returned by [`inspect_roots`].
///
/// A `RootFn` is 16 bytes on the supported targets, so the sampled payload is
/// bounded to at most 64 KiB before caller-side serialization overhead.
pub const MAX_INSPECTED_ROOTS: usize = 4_096;

/// Une fonction racine réelle : bornes `[start, end)` en adresses virtuelles.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RootFn {
    /// Adresse virtuelle de début (vraie entrée de fonction).
    pub start: u64,
    /// Adresse virtuelle de fin (exclusive).
    pub end: u64,
}

/// Bounded-output summary of a PE `.pdata` table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PdataInspection {
    /// Total 12-byte `RUNTIME_FUNCTION` slots in the section.
    pub entries: usize,
    /// Non-zero entries with readable unwind data and a valid, non-chained range.
    pub root_entries: usize,
    /// Entries rejected because `UNW_FLAG_CHAININFO` marks a child fragment.
    pub chained_fragments: usize,
    /// Entries whose unwind RVA could not be resolved to a file byte.
    pub unreadable_unwind_entries: usize,
    /// Entries rejected because their absolute range overflowed, reversed or was empty.
    pub invalid_root_entries: usize,
    /// First root entries retained for the caller, capped by
    /// [`MAX_INSPECTED_ROOTS`].
    pub sampled_roots: Vec<RootFn>,
    /// Whether additional root entries existed after the retained sample.
    pub sample_truncated: bool,
}

/// Inspect a PE `.pdata` table while bounding the returned root sample.
///
/// `max_roots` is clamped to [`MAX_INSPECTED_ROOTS`]. The whole table is still
/// scanned so the counters remain exact, but allocation is limited to the
/// clamped sample. Zero-filled padding entries are ignored. This function only
/// reads `bytes` and is available with `--no-default-features` on WebAssembly.
pub fn inspect_roots(bytes: &[u8], max_roots: usize) -> Result<PdataInspection> {
    scan_roots(bytes, max_roots.min(MAX_INSPECTED_ROOTS))
}

fn scan_roots(bytes: &[u8], sample_limit: usize) -> Result<PdataInspection> {
    let pe = PE::parse(bytes).map_err(|e| PdataError::Parse(e.to_string()))?;
    let image_base = pe.image_base;
    let pdata = pe
        .sections
        .iter()
        .find(|section| section.name().is_ok_and(|name| name.starts_with(".pdata")))
        .ok_or(PdataError::Missing)?;
    let raw_offset = pdata.pointer_to_raw_data as usize;
    let raw_size = pdata.virtual_size.min(pdata.size_of_raw_data) as usize;
    let raw_end = raw_offset.checked_add(raw_size).ok_or(PdataError::Overflow)?;
    let table = bytes.get(raw_offset..raw_end).ok_or(PdataError::OutOfBounds)?;
    let mut sampled_roots = Vec::with_capacity(sample_limit.min(table.len() / 12));
    let mut root_entries = 0usize;
    let mut chained_fragments = 0usize;
    let mut unreadable_unwind_entries = 0usize;
    let mut invalid_root_entries = 0usize;

    for chunk in table.as_chunks::<12>().0.iter() {
        let begin = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        let end = u32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]);
        let unwind = u32::from_le_bytes([chunk[8], chunk[9], chunk[10], chunk[11]]);
        if begin == 0 && end == 0 {
            continue;
        }
        let Some(unwind_offset) = rva_to_off(&pe, u64::from(unwind)) else {
            unreadable_unwind_entries += 1;
            continue;
        };
        let Some(&unwind_header) = bytes.get(unwind_offset) else {
            unreadable_unwind_entries += 1;
            continue;
        };
        let flags = (unwind_header >> 3) & 0x1f;
        if flags & UNW_FLAG_CHAININFO != 0 {
            chained_fragments += 1;
            continue;
        }
        let Some(start) = image_base.checked_add(u64::from(begin)) else {
            invalid_root_entries += 1;
            continue;
        };
        let Some(end) = image_base.checked_add(u64::from(end)) else {
            invalid_root_entries += 1;
            continue;
        };
        if start >= end {
            invalid_root_entries += 1;
            continue;
        }
        root_entries += 1;
        if sampled_roots.len() < sample_limit {
            sampled_roots.push(RootFn { start, end });
        }
    }

    Ok(PdataInspection {
        entries: table.len() / 12,
        root_entries,
        chained_fragments,
        unreadable_unwind_entries,
        invalid_root_entries,
        sample_truncated: root_entries > sampled_roots.len(),
        sampled_roots,
    })
}

/// Convertit un RVA en offset fichier à travers toutes les sections du PE.
fn rva_to_off(pe: &PE, rva: u64) -> Option<usize> {
    for sec in &pe.sections {
        let va = u64::from(sec.virtual_address);
        let vsize = u64::from(sec.virtual_size.max(sec.size_of_raw_data));
        let end = va.checked_add(vsize)?;
        if va <= rva && rva < end {
            let delta = usize::try_from(rva - va).ok()?;
            return (sec.pointer_to_raw_data as usize).checked_add(delta);
        }
    }
    None
}

/// Parse la table `.pdata` du binaire et renvoie les fonctions **racines**
/// (entrées `RUNTIME_FUNCTION` non chaînées), triées par adresse de début.
pub fn parse_roots(bytes: &[u8]) -> Result<Vec<RootFn>> {
    // This compatibility API intentionally remains unbounded.
    let inspection = scan_roots(bytes, usize::MAX)?;
    let mut roots = inspection.sampled_roots;
    roots.sort_unstable_by_key(|r| r.start);
    roots.dedup_by_key(|r| r.start);
    Ok(roots)
}

/// Upper bound of the PE input accepted by [`inspect_json`].
pub const MAX_INPUT_BYTES: usize = 64 * 1024 * 1024;

/// JSON (schema v1) report of [`inspect_roots`], shared by the native and WebAssembly front ends.
pub fn inspect_json(bytes: &[u8], max_roots: u32) -> core::result::Result<String, String> {
    if bytes.len() > MAX_INPUT_BYTES {
        return Err(format!("PE input exceeds {MAX_INPUT_BYTES} bytes"));
    }
    let report = inspect_roots(bytes, max_roots as usize).map_err(|error| error.to_string())?;
    let roots: Vec<_> = report
        .sampled_roots
        .iter()
        .map(|root| serde_json::json!({ "start": format!("{:#x}", root.start), "end": format!("{:#x}", root.end) }))
        .collect();
    Ok(serde_json::json!({
        "schemaVersion": 1,
        "entries": report.entries,
        "rootEntries": report.root_entries,
        "chainedFragments": report.chained_fragments,
        "unreadableUnwindEntries": report.unreadable_unwind_entries,
        "invalidRootEntries": report.invalid_root_entries,
        "sampledRoots": roots,
        "sampleTruncated": report.sample_truncated,
    })
    .to_string())
}

/// Renvoie l'adresse de début de la fonction racine **contenant** `a`
/// (`start <= a < end`), ou `None`. `starts` doit être trié et correspondre
/// élément par élément à `roots`.
pub fn root_containing(starts: &[u64], roots: &[RootFn], a: u64) -> Option<u64> {
    let idx = starts.partition_point(|&s| s <= a);
    if idx == 0 {
        return None;
    }
    let r = roots[idx - 1];
    (a < r.end).then_some(r.start)
}
#[cfg(test)]
mod tests {
    use super::*;

    fn synthetic_pe(root_count: usize) -> Vec<u8> {
        const PE_OFFSET: usize = 0x80;
        const OPTIONAL_HEADER_SIZE: usize = 240;
        const HEADERS_SIZE: usize = 0x200;
        const FILE_ALIGNMENT: usize = 0x200;
        const IMAGE_BASE: u64 = 0x1_4000_0000;
        const PDATA_RVA: u32 = 0x1000;
        const XDATA_RVA: u32 = 0x20_000;

        let pdata_size = root_count
            .checked_mul(12)
            .and_then(|size| size.checked_add(24))
            .expect("synthetic pdata size");
        let pdata_raw_size = pdata_size.div_ceil(FILE_ALIGNMENT) * FILE_ALIGNMENT;
        let xdata_offset = HEADERS_SIZE + pdata_raw_size;
        let mut bytes = vec![0u8; xdata_offset + FILE_ALIGNMENT];

        bytes[0..2].copy_from_slice(b"MZ");
        bytes[0x3c..0x40].copy_from_slice(&(PE_OFFSET as u32).to_le_bytes());
        bytes[PE_OFFSET..PE_OFFSET + 4].copy_from_slice(b"PE\0\0");
        let coff = PE_OFFSET + 4;
        bytes[coff..coff + 2].copy_from_slice(&0x8664u16.to_le_bytes());
        bytes[coff + 2..coff + 4].copy_from_slice(&2u16.to_le_bytes());
        bytes[coff + 16..coff + 18].copy_from_slice(&(OPTIONAL_HEADER_SIZE as u16).to_le_bytes());
        let optional = coff + 20;
        bytes[optional..optional + 2].copy_from_slice(&0x020bu16.to_le_bytes());
        bytes[optional + 24..optional + 32].copy_from_slice(&IMAGE_BASE.to_le_bytes());
        bytes[optional + 32..optional + 36].copy_from_slice(&0x1000u32.to_le_bytes());
        bytes[optional + 36..optional + 40].copy_from_slice(&(FILE_ALIGNMENT as u32).to_le_bytes());
        bytes[optional + 56..optional + 60].copy_from_slice(&0x21_000u32.to_le_bytes());
        bytes[optional + 60..optional + 64].copy_from_slice(&(HEADERS_SIZE as u32).to_le_bytes());
        bytes[optional + 108..optional + 112].copy_from_slice(&16u32.to_le_bytes());

        let pdata_section = optional + OPTIONAL_HEADER_SIZE;
        bytes[pdata_section..pdata_section + 6].copy_from_slice(b".pdata");
        bytes[pdata_section + 8..pdata_section + 12]
            .copy_from_slice(&(pdata_size as u32).to_le_bytes());
        bytes[pdata_section + 12..pdata_section + 16].copy_from_slice(&PDATA_RVA.to_le_bytes());
        bytes[pdata_section + 16..pdata_section + 20]
            .copy_from_slice(&(pdata_raw_size as u32).to_le_bytes());
        bytes[pdata_section + 20..pdata_section + 24]
            .copy_from_slice(&(HEADERS_SIZE as u32).to_le_bytes());

        let xdata_section = pdata_section + 40;
        bytes[xdata_section..xdata_section + 6].copy_from_slice(b".xdata");
        bytes[xdata_section + 8..xdata_section + 12]
            .copy_from_slice(&(FILE_ALIGNMENT as u32).to_le_bytes());
        bytes[xdata_section + 12..xdata_section + 16].copy_from_slice(&XDATA_RVA.to_le_bytes());
        bytes[xdata_section + 16..xdata_section + 20]
            .copy_from_slice(&(FILE_ALIGNMENT as u32).to_le_bytes());
        bytes[xdata_section + 20..xdata_section + 24]
            .copy_from_slice(&(xdata_offset as u32).to_le_bytes());

        for index in 0..root_count {
            let entry = HEADERS_SIZE + index * 12;
            let begin = 0x30_000u32 + (index as u32) * 0x20;
            bytes[entry..entry + 4].copy_from_slice(&begin.to_le_bytes());
            bytes[entry + 4..entry + 8].copy_from_slice(&(begin + 0x10).to_le_bytes());
            bytes[entry + 8..entry + 12].copy_from_slice(&XDATA_RVA.to_le_bytes());
        }
        bytes[xdata_offset] = 1; // version 1, no flags: root entry

        let chained_entry = HEADERS_SIZE + root_count * 12;
        bytes[chained_entry..chained_entry + 4].copy_from_slice(&0x40_000u32.to_le_bytes());
        bytes[chained_entry + 4..chained_entry + 8].copy_from_slice(&0x40_010u32.to_le_bytes());
        bytes[chained_entry + 8..chained_entry + 12]
            .copy_from_slice(&(XDATA_RVA + 4).to_le_bytes());
        bytes[xdata_offset + 4] = (UNW_FLAG_CHAININFO << 3) | 1;

        let unreadable_entry = chained_entry + 12;
        bytes[unreadable_entry..unreadable_entry + 4].copy_from_slice(&0x50_000u32.to_le_bytes());
        bytes[unreadable_entry + 4..unreadable_entry + 8]
            .copy_from_slice(&0x50_010u32.to_le_bytes());
        bytes[unreadable_entry + 8..unreadable_entry + 12]
            .copy_from_slice(&0x90_000u32.to_le_bytes());
        bytes
    }

    #[test]
    fn bounded_inspection_reports_exact_counts_and_clamps_sample() {
        let root_count = MAX_INSPECTED_ROOTS + 1;
        let bytes = synthetic_pe(root_count);
        let report = inspect_roots(&bytes, usize::MAX).expect("inspect synthetic PE");

        assert_eq!(report.entries, root_count + 2);
        assert_eq!(report.root_entries, root_count);
        assert_eq!(report.chained_fragments, 1);
        assert_eq!(report.unreadable_unwind_entries, 1);
        assert_eq!(report.invalid_root_entries, 0);
        assert_eq!(report.sampled_roots.len(), MAX_INSPECTED_ROOTS);
        assert!(report.sample_truncated);
        assert_eq!(report.sampled_roots[0].start, 0x1_4003_0000);
        assert_eq!(parse_roots(&bytes).expect("parse complete synthetic PE").len(), root_count);
    }

    #[test]
    fn compatibility_parser_returns_all_roots() {
        let bytes = synthetic_pe(3);
        let roots = parse_roots(&bytes).expect("parse synthetic PE");

        assert_eq!(roots.len(), 3);
        assert_eq!(roots[0].start, 0x1_4003_0000);
        assert_eq!(roots[2].end, 0x1_4003_0050);
    }

    /// Construit un PE x64 minimal en mémoire avec une `.pdata` contenant deux
    /// entrées (une racine, un fragment chaîné) et vérifie que seul le root sort.
    ///
    /// On ne fabrique pas un PE complet ici (goblin exige beaucoup de champs) :
    /// on teste plutôt la logique de filtrage de flags directement.
    #[test]
    fn flag_chaininfo_ecarte_les_fragments() {
        // byte0 = (Flags << 3) | Version. Version=1.
        let root = 1u8; // flags=0 → racine
        let frag = (UNW_FLAG_CHAININFO << 3) | 1; // flags=CHAININFO → fragment
        assert_eq!((root >> 3) & 0x1f & UNW_FLAG_CHAININFO, 0);
        assert_ne!((frag >> 3) & 0x1f & UNW_FLAG_CHAININFO, 0);
    }

    /// Vérifie le test d'inclusion (adresse → fonction racine contenante).
    #[test]
    fn inclusion_dans_la_fonction_racine() {
        let roots = [RootFn { start: 0x1000, end: 0x1100 }, RootFn { start: 0x2000, end: 0x2400 }];
        let starts: Vec<u64> = roots.iter().map(|r| r.start).collect();
        // Début exact → la fonction elle-même.
        assert_eq!(root_containing(&starts, &roots, 0x1000), Some(0x1000));
        // Milieu de corps → la fonction contenante.
        assert_eq!(root_containing(&starts, &roots, 0x2200), Some(0x2000));
        // Dans le trou entre deux fonctions (0x1100..0x2000) → None.
        assert_eq!(root_containing(&starts, &roots, 0x1500), None);
        // Avant la première → None.
        assert_eq!(root_containing(&starts, &roots, 0x0500), None);
        // À la borne de fin (exclusive) → None.
        assert_eq!(root_containing(&starts, &roots, 0x2400), None);
    }

    /// Vérifie le tri + déduplication des racines.
    #[test]
    fn roots_tries_et_dedupliques() {
        let mut v = [
            RootFn { start: 0x2000, end: 0x2100 },
            RootFn { start: 0x1000, end: 0x1100 },
            RootFn { start: 0x2000, end: 0x2100 },
        ]
        .to_vec();
        v.sort_unstable_by_key(|r| r.start);
        v.dedup_by_key(|r| r.start);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].start, 0x1000);
        assert_eq!(v[1].start, 0x2000);
    }
}

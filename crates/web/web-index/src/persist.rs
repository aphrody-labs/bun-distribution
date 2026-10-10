//! Binary file format (version 1). All integers are little-endian.
//!
//! ```text
//! offset  size  field
//! 0       8     magic "BXCIDX01"
//! 8       4     version (1)
//! 12      4     header length (256)
//! 16      4     dim
//! 20      1     metric (0 cosine, 1 l2)
//! 21      1     quantization (0 none, 1 int8)
//! 22      1     flags (bit0 keep_float, bit1 keep_pruned_connections)
//! 23      1     reserved
//! 24      4     M
//! 28      4     ef_construction
//! 32      4     ef_search
//! 36      4     rescore_multiplier
//! 40      8     level seed
//! 48      8     level PRNG state
//! 56      8     slot count N (including tombstones)
//! 64      8     tombstone count
//! 72      4     entry slot (u32::MAX = empty)
//! 76      4     max level
//! 80      4     section count (10)
//! 84      4     reserved
//! 88      160   section table: 10 x (byte offset u64, byte length u64)
//! 248     8     reserved
//! 256     ...   sections, each starting on an 8-byte boundary, zero padded:
//!               0 keys        u64 x N
//!               1 levels      u8  x N
//!               2 scales      f32 x N          (int8 only)
//!               3 norms       f32 x N          (int8 + l2 only)
//!               4 codes       i8  x N*dim      (int8 only)
//!               5 floats      f32 x N*dim      (keep_float or no quantization)
//!               6 links0      u32 x N*(2M+1)   [count, ids..] per slot
//!               7 upper_off   u64 x (N+1)      offsets into `upper` (u32 units)
//!               8 upper       u32 x upper_off[N]  [count, ids..] per (slot, level>=1)
//!               9 tombstones  u64 x ceil(N/64) bitmap
//! EOF-8   8     XXH64 (seed 0) of every preceding byte
//! ```
//!
//! Loading memory-maps the file and validates magic, version, checksum,
//! section bounds/alignment and graph invariants (ids in range, counts within
//! capacity, level consistency) before any search can touch the data, so a
//! corrupt or hostile file yields an error instead of a panic.

use std::{
    fs::File,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};

use memmap2::Mmap;

use crate::{
    buf::{Buf, Pod, as_bytes},
    error::{IndexError, Result},
    graph::Layout,
    index::{Inner, MAX_SLOTS},
    params::{IndexParams, MAX_LEVEL, Metric, Quantization},
    rng::SplitMix64,
};

pub const MAGIC: &[u8; 8] = b"BXCIDX01";
pub const VERSION: u32 = 1;
pub const HEADER_LEN: usize = 256;
const SECTIONS: usize = 10;
const NO_ENTRY: u32 = u32::MAX;

// ---------------------------------------------------------------------------
// XXH64 (hand-written, streaming)
// ---------------------------------------------------------------------------

const P1: u64 = 0x9E37_79B1_85EB_CA87;
const P2: u64 = 0xC2B2_AE3D_27D4_EB4F;
const P3: u64 = 0x1656_67B1_9E37_79F9;
const P4: u64 = 0x85EB_CA77_C2B2_AE63;
const P5: u64 = 0x27D4_EB2F_1656_67C5;

#[inline(always)]
fn xxh_round(acc: u64, input: u64) -> u64 {
    acc.wrapping_add(input.wrapping_mul(P2)).rotate_left(31).wrapping_mul(P1)
}

#[inline(always)]
fn xxh_merge(acc: u64, val: u64) -> u64 {
    (acc ^ xxh_round(0, val)).wrapping_mul(P1).wrapping_add(P4)
}

#[inline(always)]
fn read_u64(b: &[u8]) -> u64 {
    let mut w = [0u8; 8];
    w.copy_from_slice(&b[..8]);
    u64::from_le_bytes(w)
}

#[inline(always)]
fn read_u32(b: &[u8]) -> u32 {
    let mut w = [0u8; 4];
    w.copy_from_slice(&b[..4]);
    u32::from_le_bytes(w)
}

/// Streaming XXH64.
pub struct Xxh64 {
    v: [u64; 4],
    buf: [u8; 32],
    buf_len: usize,
    total: u64,
    seed: u64,
}

impl Xxh64 {
    pub fn new(seed: u64) -> Self {
        Self {
            v: [
                seed.wrapping_add(P1).wrapping_add(P2),
                seed.wrapping_add(P2),
                seed,
                seed.wrapping_sub(P1),
            ],
            buf: [0; 32],
            buf_len: 0,
            total: 0,
            seed,
        }
    }

    #[inline(always)]
    fn stripe(v: &mut [u64; 4], s: &[u8]) {
        v[0] = xxh_round(v[0], read_u64(&s[0..]));
        v[1] = xxh_round(v[1], read_u64(&s[8..]));
        v[2] = xxh_round(v[2], read_u64(&s[16..]));
        v[3] = xxh_round(v[3], read_u64(&s[24..]));
    }

    pub fn update(&mut self, mut data: &[u8]) {
        self.total = self.total.wrapping_add(data.len() as u64);
        if self.buf_len > 0 {
            let take = (32 - self.buf_len).min(data.len());
            self.buf[self.buf_len..self.buf_len + take].copy_from_slice(&data[..take]);
            self.buf_len += take;
            data = &data[take..];
            if self.buf_len < 32 {
                return;
            }
            let block = self.buf;
            Self::stripe(&mut self.v, &block);
            self.buf_len = 0;
        }
        let (stripes, rem) = data.as_chunks::<32>();
        for s in stripes {
            Self::stripe(&mut self.v, s);
        }
        self.buf[..rem.len()].copy_from_slice(rem);
        self.buf_len = rem.len();
    }

    pub fn finish(&self) -> u64 {
        let mut h = if self.total >= 32 {
            let [v1, v2, v3, v4] = self.v;
            let mut h = v1
                .rotate_left(1)
                .wrapping_add(v2.rotate_left(7))
                .wrapping_add(v3.rotate_left(12))
                .wrapping_add(v4.rotate_left(18));
            h = xxh_merge(h, v1);
            h = xxh_merge(h, v2);
            h = xxh_merge(h, v3);
            xxh_merge(h, v4)
        } else {
            self.seed.wrapping_add(P5)
        };
        h = h.wrapping_add(self.total);
        let mut rest = &self.buf[..self.buf_len];
        while rest.len() >= 8 {
            h ^= xxh_round(0, read_u64(rest));
            h = h.rotate_left(27).wrapping_mul(P1).wrapping_add(P4);
            rest = &rest[8..];
        }
        if rest.len() >= 4 {
            h ^= u64::from(read_u32(rest)).wrapping_mul(P1);
            h = h.rotate_left(23).wrapping_mul(P2).wrapping_add(P3);
            rest = &rest[4..];
        }
        for &b in rest {
            h ^= u64::from(b).wrapping_mul(P5);
            h = h.rotate_left(11).wrapping_mul(P1);
        }
        h ^= h >> 33;
        h = h.wrapping_mul(P2);
        h ^= h >> 29;
        h = h.wrapping_mul(P3);
        h ^ (h >> 32)
    }
}

/// One-shot XXH64.
pub fn xxh64(data: &[u8], seed: u64) -> u64 {
    let mut h = Xxh64::new(seed);
    h.update(data);
    h.finish()
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

struct HashingWriter<W: Write> {
    inner: W,
    hasher: Xxh64,
    pos: u64,
}

impl<W: Write> HashingWriter<W> {
    fn put(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.write_all(bytes)?;
        self.hasher.update(bytes);
        self.pos += bytes.len() as u64;
        Ok(())
    }

    fn pad_to(&mut self, offset: u64) -> std::io::Result<()> {
        const ZEROS: [u8; 8] = [0; 8];
        while self.pos < offset {
            let n = ((offset - self.pos) as usize).min(8);
            self.put(&ZEROS[..n])?;
        }
        Ok(())
    }
}

#[inline]
fn align8(x: u64) -> u64 {
    (x + 7) & !7
}

fn tmp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(format!(".tmp-{}", std::process::id()));
    path.with_file_name(name)
}

#[cfg(target_endian = "big")]
pub(crate) fn save(_inner: &Inner, _path: &Path) -> Result<()> {
    Err(IndexError::Corrupt("big-endian hosts are not supported by the index file format".into()))
}

#[cfg(target_endian = "little")]
pub(crate) fn save(inner: &Inner, path: &Path) -> Result<()> {
    let p = &inner.params;
    let n = inner.slot_count();
    let tomb_words = n.div_ceil(64);
    let sections: [&[u8]; SECTIONS] = [
        as_bytes(inner.keys.as_slice()),
        as_bytes(inner.levels.as_slice()),
        as_bytes(inner.scales.as_slice()),
        as_bytes(inner.norms.as_slice()),
        as_bytes(inner.codes.as_slice()),
        as_bytes(inner.floats.as_slice()),
        as_bytes(inner.links0.as_slice()),
        as_bytes(inner.upper_off.as_slice()),
        as_bytes(inner.upper.as_slice()),
        as_bytes(&inner.tombstones[..tomb_words.min(inner.tombstones.len())]),
    ];

    let mut table = [(0u64, 0u64); SECTIONS];
    let mut cursor = HEADER_LEN as u64;
    for (entry, bytes) in table.iter_mut().zip(sections.iter()) {
        cursor = align8(cursor);
        *entry = (cursor, bytes.len() as u64);
        cursor += bytes.len() as u64;
    }
    let data_end = align8(cursor);

    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&VERSION.to_le_bytes());
    header.extend_from_slice(&(HEADER_LEN as u32).to_le_bytes());
    header.extend_from_slice(&(p.dim as u32).to_le_bytes());
    header.push(p.metric.to_u8());
    header.push(p.quantization.to_u8());
    header.push(u8::from(p.keep_float) | (u8::from(p.keep_pruned_connections) << 1));
    header.push(0);
    for v in [p.m, p.ef_construction, p.ef_search, p.rescore_multiplier] {
        header.extend_from_slice(&(v as u32).to_le_bytes());
    }
    header.extend_from_slice(&p.seed.to_le_bytes());
    header.extend_from_slice(&inner.rng.state().to_le_bytes());
    header.extend_from_slice(&(n as u64).to_le_bytes());
    header.extend_from_slice(&(inner.tombstone_count as u64).to_le_bytes());
    let (entry_slot, max_level) = inner.entry.map_or((NO_ENTRY, 0), |(s, l)| (s, l as u32));
    header.extend_from_slice(&entry_slot.to_le_bytes());
    header.extend_from_slice(&max_level.to_le_bytes());
    header.extend_from_slice(&(SECTIONS as u32).to_le_bytes());
    header.extend_from_slice(&0u32.to_le_bytes());
    for (off, len) in table {
        header.extend_from_slice(&off.to_le_bytes());
        header.extend_from_slice(&len.to_le_bytes());
    }
    header.resize(HEADER_LEN, 0);

    let tmp = tmp_path(path);
    let result = (|| -> Result<()> {
        let file = File::create(&tmp)?;
        let mut w = HashingWriter {
            inner: BufWriter::with_capacity(1 << 20, file),
            hasher: Xxh64::new(0),
            pos: 0,
        };
        w.put(&header)?;
        for ((off, _), bytes) in table.iter().zip(sections.iter()) {
            w.pad_to(*off)?;
            w.put(bytes)?;
        }
        w.pad_to(data_end)?;
        let checksum = w.hasher.finish();
        w.inner.write_all(&checksum.to_le_bytes())?;
        let file = w.inner.into_inner().map_err(|e| e.into_error())?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(err) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(err);
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

fn corrupt(msg: impl Into<String>) -> IndexError {
    IndexError::Corrupt(msg.into())
}

fn to_usize(v: u64, what: &str) -> Result<usize> {
    usize::try_from(v).map_err(|_| corrupt(format!("{what} does not fit in usize")))
}

fn section<T: Pod>(
    map: &Arc<Mmap>,
    table: &[(u64, u64); SECTIONS],
    idx: usize,
    expected_len: usize,
    name: &str,
) -> Result<Buf<T>> {
    let (off, byte_len) = table[idx];
    let size = std::mem::size_of::<T>();
    let off = to_usize(off, name)?;
    let byte_len = to_usize(byte_len, name)?;
    if byte_len % size != 0 {
        return Err(corrupt(format!("section {name} has a partial element")));
    }
    let len = byte_len / size;
    if len != expected_len {
        return Err(corrupt(format!("section {name} has {len} elements, expected {expected_len}")));
    }
    if off < HEADER_LEN || off % 8 != 0 {
        return Err(corrupt(format!("section {name} has an invalid offset")));
    }
    let data_end = map.len() - 8;
    if off.checked_add(byte_len).is_none_or(|end| end > data_end) {
        return Err(corrupt(format!("section {name} is out of bounds")));
    }
    if len == 0 {
        return Ok(Buf::Owned(Vec::new()));
    }
    Buf::mapped(Arc::clone(map), off, len)
        .ok_or_else(|| corrupt(format!("section {name} is misaligned or out of bounds")))
}

#[cfg(target_endian = "big")]
pub(crate) fn load(_path: &Path) -> Result<Inner> {
    Err(IndexError::Corrupt("big-endian hosts are not supported by the index file format".into()))
}

#[cfg(target_endian = "little")]
pub(crate) fn load(path: &Path) -> Result<Inner> {
    let file = File::open(path)?;
    // SAFETY: the mapping is read-only. As with any mmap, the file must not be
    // truncated or rewritten in place by another process while mapped; this
    // crate itself only ever replaces index files atomically via rename.
    let map = unsafe { Mmap::map(&file)? };
    let map = Arc::new(map);
    let bytes: &[u8] = &map;

    if bytes.len() < 8 || &bytes[..8] != MAGIC {
        return Err(IndexError::BadMagic);
    }
    if bytes.len() < HEADER_LEN + 8 {
        return Err(corrupt("file is truncated"));
    }
    let version = read_u32(&bytes[8..]);
    if version != VERSION {
        return Err(IndexError::UnsupportedVersion(version));
    }
    let data_end = bytes.len() - 8;
    let stored = read_u64(&bytes[data_end..]);
    let computed = xxh64(&bytes[..data_end], 0);
    if stored != computed {
        return Err(IndexError::ChecksumMismatch { stored, computed });
    }
    if read_u32(&bytes[12..]) as usize != HEADER_LEN {
        return Err(corrupt("unexpected header length"));
    }

    let dim = read_u32(&bytes[16..]) as usize;
    let metric = Metric::from_u8(bytes[20]).ok_or_else(|| corrupt("unknown metric"))?;
    let quantization =
        Quantization::from_u8(bytes[21]).ok_or_else(|| corrupt("unknown quantization"))?;
    let flags = bytes[22];
    let params = IndexParams {
        dim,
        metric,
        m: read_u32(&bytes[24..]) as usize,
        ef_construction: read_u32(&bytes[28..]) as usize,
        ef_search: read_u32(&bytes[32..]) as usize,
        quantization,
        keep_float: flags & 1 != 0,
        rescore_multiplier: read_u32(&bytes[36..]) as usize,
        keep_pruned_connections: flags & 2 != 0,
        seed: read_u64(&bytes[40..]),
        build_threads: 0,
    }
    .normalized();
    params.validate().map_err(|e| corrupt(format!("invalid stored parameters: {e}")))?;
    let rng_state = read_u64(&bytes[48..]);
    let n = to_usize(read_u64(&bytes[56..]), "slot count")?;
    if n > MAX_SLOTS {
        return Err(corrupt("slot count exceeds maximum"));
    }
    let tombstone_count = to_usize(read_u64(&bytes[64..]), "tombstone count")?;
    let entry_slot = read_u32(&bytes[72..]);
    let max_level = read_u32(&bytes[76..]) as usize;
    if read_u32(&bytes[80..]) as usize != SECTIONS {
        return Err(corrupt("unexpected section count"));
    }
    let mut table = [(0u64, 0u64); SECTIONS];
    for (i, entry) in table.iter_mut().enumerate() {
        let base = 88 + i * 16;
        *entry = (read_u64(&bytes[base..]), read_u64(&bytes[base + 8..]));
    }

    let layout = Layout { m: params.m, m0: params.m0() };
    let codes_on = params.stores_codes();
    let floats_on = params.stores_float();
    let n_dim = n.checked_mul(dim).ok_or_else(|| corrupt("vector storage size overflows"))?;
    let l0_len =
        n.checked_mul(layout.m0 + 1).ok_or_else(|| corrupt("link storage size overflows"))?;

    let keys: Buf<u64> = section(&map, &table, 0, n, "keys")?;
    let levels: Buf<u8> = section(&map, &table, 1, n, "levels")?;
    let scales: Buf<f32> = section(&map, &table, 2, if codes_on { n } else { 0 }, "scales")?;
    let norms_len = if codes_on && metric == Metric::L2 { n } else { 0 };
    let norms: Buf<f32> = section(&map, &table, 3, norms_len, "norms")?;
    let codes: Buf<i8> = section(&map, &table, 4, if codes_on { n_dim } else { 0 }, "codes")?;
    let floats: Buf<f32> = section(&map, &table, 5, if floats_on { n_dim } else { 0 }, "floats")?;
    let links0: Buf<u32> = section(&map, &table, 6, l0_len, "links0")?;
    let upper_off: Buf<u64> = section(&map, &table, 7, n + 1, "upper_off")?;
    let upper_len = to_usize(upper_off.as_slice()[n], "upper length")?;
    let upper: Buf<u32> = section(&map, &table, 8, upper_len, "upper")?;
    let tomb_buf: Buf<u64> = section(&map, &table, 9, n.div_ceil(64), "tombstones")?;
    let tombstones = tomb_buf.as_slice().to_vec();

    // --- invariants -------------------------------------------------------
    let lv = levels.as_slice();
    let off = upper_off.as_slice();
    if off[0] != 0 {
        return Err(corrupt("upper offsets must start at 0"));
    }
    let block = (layout.m + 1) as u64;
    let mut observed_max = 0usize;
    for i in 0..n {
        let level = lv[i] as usize;
        if level > MAX_LEVEL {
            return Err(corrupt("node level exceeds maximum"));
        }
        observed_max = observed_max.max(level);
        let expected = off[i]
            .checked_add(level as u64 * block)
            .ok_or_else(|| corrupt("upper offsets overflow"))?;
        if off[i + 1] != expected {
            return Err(corrupt("upper offsets inconsistent with levels"));
        }
    }
    let entry = if n == 0 {
        if entry_slot != NO_ENTRY {
            return Err(corrupt("empty index with an entry point"));
        }
        None
    } else {
        if entry_slot as usize >= n {
            return Err(corrupt("entry point out of range"));
        }
        if max_level != observed_max || lv[entry_slot as usize] as usize != max_level {
            return Err(corrupt("entry point level inconsistent"));
        }
        Some((entry_slot, max_level))
    };

    let check_block = |blk: &[u32], cap: usize, min_level: usize| -> Result<()> {
        let cnt = blk[0] as usize;
        if cnt > cap {
            return Err(corrupt("neighbour count exceeds capacity"));
        }
        for &id in &blk[1..1 + cnt] {
            let id = id as usize;
            if id >= n || (lv[id] as usize) < min_level {
                return Err(corrupt("neighbour id out of range"));
            }
        }
        Ok(())
    };
    for blk in links0.as_slice().chunks_exact(layout.m0 + 1) {
        check_block(blk, layout.m0, 0)?;
    }
    let up = upper.as_slice();
    for i in 0..n {
        let start = off[i] as usize;
        for l in 1..=lv[i] as usize {
            let b = start + (l - 1) * (layout.m + 1);
            check_block(&up[b..b + layout.m + 1], layout.m, l)?;
        }
    }
    for s in scales.as_slice().iter().chain(norms.as_slice()) {
        if !s.is_finite() {
            return Err(corrupt("non-finite quantisation scale"));
        }
    }
    let mut popcount = 0usize;
    for (w, &word) in tombstones.iter().enumerate() {
        let valid_bits = (n - w * 64).min(64);
        if valid_bits < 64 && word >> valid_bits != 0 {
            return Err(corrupt("tombstone bits set beyond slot count"));
        }
        popcount += word.count_ones() as usize;
    }
    if popcount != tombstone_count {
        return Err(corrupt("tombstone count mismatch"));
    }

    let mut inner = Inner::new(params);
    // SplitMix64's state is its seed, so this resumes the exact sequence.
    inner.rng = SplitMix64::new(rng_state);
    inner.keys = keys;
    inner.levels = levels;
    inner.scales = scales;
    inner.norms = norms;
    inner.codes = codes;
    inner.floats = floats;
    inner.links0 = links0;
    inner.upper_off = upper_off;
    inner.upper = upper;
    inner.tombstones = tombstones;
    inner.tombstone_count = tombstone_count;
    inner.entry = entry;
    inner.key_map = OnceLock::new();
    inner.file_bytes = map.len();
    Ok(inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xxh64_known_vectors() {
        assert_eq!(xxh64(b"", 0), 0xEF46_DB37_51D8_E999);
        assert_eq!(xxh64(b"abc", 0), 0x44BC_2CF5_AD77_0999);
    }

    #[test]
    fn xxh64_streaming_matches_one_shot() {
        let data: Vec<u8> = (0..1000u32).map(|i| (i * 31 % 251) as u8).collect();
        let one = xxh64(&data, 0);
        for split in [0usize, 1, 7, 31, 32, 33, 100, 999] {
            let mut h = Xxh64::new(0);
            h.update(&data[..split]);
            h.update(&data[split..]);
            assert_eq!(h.finish(), one, "split {split}");
        }
    }
}

//! The public [`Index`] type.
//!
//! Concurrency model: one `parking_lot::RwLock` around the whole index.
//! Searches take the read lock and run fully in parallel. Mutations take the
//! write lock. `add_batch` releases the write lock between chunks of
//! [`INSERT_CHUNK`] vectors so that searches interleave with long builds;
//! inside a chunk the graph is linked by `std::thread::scope` workers that
//! coordinate through striped per-node mutexes and atomic link words.

use std::{
    collections::HashMap,
    path::Path,
    sync::{
        OnceLock,
        atomic::{AtomicUsize, Ordering as AtomicOrdering},
    },
};

use parking_lot::{Mutex, RwLock};
use serde::Serialize;

use crate::{
    buf::Buf,
    error::{IndexError, Result},
    graph::{
        AtomicLinks, Candidate, Entry, Inserter, LOCK_STRIPES, Layout, Scratch, SliceLinks,
        as_atomic, greedy_closest, search_layer,
    },
    kernels,
    params::{IndexParams, MAX_LEVEL, Metric, Quantization, SearchOptions},
    rng::SplitMix64,
    space::{F32Space, I8Query, I8Space, Space, prepare_vector, quantize},
    visited::{Visited, VisitedPool},
};

/// Number of vectors inserted per write-lock acquisition in batch inserts.
pub const INSERT_CHUNK: usize = 4_096;

/// Slots below this index are always linked serially (graph warm-up).
const SERIAL_PREFIX: usize = 1_024;

/// Maximum number of slots (dense ids are `u32`; `u32::MAX` is reserved).
pub const MAX_SLOTS: usize = u32::MAX as usize - 1;

/// Index state guarded by the outer lock. Fields are crate-visible for the
/// persistence module.
pub(crate) struct Inner {
    pub params: IndexParams,
    pub layout: Layout,
    pub keys: Buf<u64>,
    pub levels: Buf<u8>,
    pub scales: Buf<f32>,
    pub norms: Buf<f32>,
    pub codes: Buf<i8>,
    pub floats: Buf<f32>,
    pub links0: Buf<u32>,
    /// `slot_count + 1` offsets (in u32 units) into `upper`.
    pub upper_off: Buf<u64>,
    pub upper: Buf<u32>,
    pub tombstones: Vec<u64>,
    pub tombstone_count: usize,
    pub entry: Entry,
    pub rng: SplitMix64,
    pub key_map: OnceLock<HashMap<u64, u32>>,
    pub file_bytes: usize,
}

impl Inner {
    pub fn new(params: IndexParams) -> Self {
        let layout = Layout { m: params.m, m0: params.m0() };
        let rng = SplitMix64::new(params.seed);
        Self {
            params,
            layout,
            keys: Buf::default(),
            levels: Buf::default(),
            scales: Buf::default(),
            norms: Buf::default(),
            codes: Buf::default(),
            floats: Buf::default(),
            links0: Buf::default(),
            upper_off: Buf::Owned(vec![0]),
            upper: Buf::default(),
            tombstones: Vec::new(),
            tombstone_count: 0,
            entry: None,
            rng,
            key_map: OnceLock::new(),
            file_bytes: 0,
        }
    }

    #[inline]
    pub fn slot_count(&self) -> usize {
        self.keys.len()
    }

    #[inline]
    pub fn live_count(&self) -> usize {
        self.slot_count() - self.tombstone_count
    }

    #[inline]
    pub fn is_tombstoned(&self, slot: u32) -> bool {
        let s = slot as usize;
        self.tombstones.get(s / 64).is_some_and(|w| (w >> (s % 64)) & 1 == 1)
    }

    fn set_tombstone(&mut self, slot: u32) {
        let s = slot as usize;
        if let Some(w) = self.tombstones.get_mut(s / 64) {
            let bit = 1u64 << (s % 64);
            if *w & bit == 0 {
                *w |= bit;
                self.tombstone_count += 1;
            }
        }
    }

    pub fn key_map(&self) -> &HashMap<u64, u32> {
        self.key_map.get_or_init(|| {
            let keys = self.keys.as_slice();
            let mut map = HashMap::with_capacity(self.live_count());
            for (slot, &key) in keys.iter().enumerate() {
                if !self.is_tombstoned(slot as u32) {
                    map.insert(key, slot as u32);
                }
            }
            map
        })
    }

    fn key_map_mut(&mut self) -> &mut HashMap<u64, u32> {
        self.key_map();
        self.key_map.get_mut().expect("key map initialised above")
    }

    /// Pre-size the per-slot arrays for `additional` upcoming inserts. Growth
    /// is at least 25 % of the current length so that many small batches stay
    /// amortised, while a single large batch allocates (almost) exactly.
    fn reserve(&mut self, additional: usize) {
        fn grow<T: Copy>(v: &mut Vec<T>, additional: usize) {
            let need = v.len().saturating_add(additional);
            if v.capacity() < need {
                let target = need.max(v.len() + v.len() / 4);
                v.reserve_exact(target - v.len());
            }
        }
        let dim = self.params.dim;
        let slot_count = self.slot_count();
        grow(self.keys.to_mut(), additional);
        grow(self.levels.to_mut(), additional);
        if self.params.stores_codes() {
            grow(self.codes.to_mut(), additional.saturating_mul(dim));
            grow(self.scales.to_mut(), additional);
            if self.params.metric == Metric::L2 {
                grow(self.norms.to_mut(), additional);
            }
        }
        if self.params.stores_float() {
            grow(self.floats.to_mut(), additional.saturating_mul(dim));
        }
        grow(self.links0.to_mut(), additional.saturating_mul(self.layout.m0 + 1));
        grow(self.upper_off.to_mut(), additional);
        // Expected upper-layer blocks per node: sum_{l>=1} M^-l = 1 / (M - 1).
        let upper_words = additional / (self.layout.m - 1).max(1) * (self.layout.m + 1);
        grow(self.upper.to_mut(), upper_words);
        let words = (slot_count + additional).div_ceil(64);
        let missing_words = words.saturating_sub(self.tombstones.len());
        grow(&mut self.tombstones, missing_words);
        let map = self.key_map_mut();
        let map_need = map.len() + additional;
        if map.capacity() < map_need {
            map.reserve(additional);
        }
    }

    fn sample_level(&mut self) -> usize {
        let ml = 1.0 / (self.params.m as f64).ln();
        let u = self.rng.next_open01();
        ((-u.ln() * ml).floor() as usize).min(MAX_LEVEL)
    }

    /// Append a slot for an already prepared (validated, normalised) vector.
    /// Upserts tombstone the previous slot of the key.
    fn allocate(&mut self, key: u64, v: &[f32]) -> Result<u32> {
        let slot_count = self.slot_count();
        if slot_count >= MAX_SLOTS {
            return Err(IndexError::CapacityExceeded { max: MAX_SLOTS });
        }
        let slot = slot_count as u32;
        let level = self.sample_level();
        let dim = self.params.dim;
        if let Some(old) = self.key_map_mut().insert(key, slot) {
            self.set_tombstone(old);
        }
        self.keys.to_mut().push(key);
        self.levels.to_mut().push(level as u8);
        if self.params.stores_codes() {
            let codes = self.codes.to_mut();
            let start = codes.len();
            codes.resize(start + dim, 0);
            let (scale, norm) = quantize(v, &mut codes[start..]);
            self.scales.to_mut().push(scale);
            if self.params.metric == Metric::L2 {
                self.norms.to_mut().push(norm);
            }
        }
        if self.params.stores_float() {
            self.floats.to_mut().extend_from_slice(v);
        }
        let l0 = self.links0.to_mut();
        l0.resize(l0.len() + self.layout.m0 + 1, 0);
        let upper = self.upper.to_mut();
        upper.resize(upper.len() + level * (self.layout.m + 1), 0);
        let upper_len = upper.len() as u64;
        self.upper_off.to_mut().push(upper_len);
        let words = (slot_count + 1).div_ceil(64);
        if self.tombstones.len() < words {
            self.tombstones.resize(words, 0);
        }
        Ok(slot)
    }

    /// Link slots `start..end` into the graph using `threads` workers.
    fn link_range(
        &mut self,
        start: usize,
        end: usize,
        threads: usize,
        locks: &[Mutex<()>],
        pool: &VisitedPool,
    ) {
        if start >= end {
            return;
        }
        let slot_count = self.slot_count();
        let Inner {
            params,
            layout,
            levels,
            scales,
            norms,
            codes,
            floats,
            links0,
            upper_off,
            upper,
            entry,
            ..
        } = self;
        let entry_lock = Mutex::new(*entry);
        let links = AtomicLinks {
            layout: *layout,
            l0: as_atomic(links0.to_mut()),
            upper: as_atomic(upper.to_mut()),
            upper_off: upper_off.as_slice(),
            locks,
        };
        match params.quantization {
            Quantization::Int8 => {
                let space = I8Space {
                    dim: params.dim,
                    metric: params.metric,
                    codes: codes.as_slice(),
                    scales: scales.as_slice(),
                    norms: norms.as_slice(),
                };
                let ins = Inserter {
                    space: &space,
                    links,
                    levels: levels.as_slice(),
                    entry: &entry_lock,
                    ef_construction: params.ef_construction,
                    keep_pruned: params.keep_pruned_connections,
                    slot_count,
                };
                run_inserts(&ins, start, end, threads, pool);
            },
            Quantization::None => {
                let space =
                    F32Space { dim: params.dim, metric: params.metric, floats: floats.as_slice() };
                let ins = Inserter {
                    space: &space,
                    links,
                    levels: levels.as_slice(),
                    entry: &entry_lock,
                    ef_construction: params.ef_construction,
                    keep_pruned: params.keep_pruned_connections,
                    slot_count,
                };
                run_inserts(&ins, start, end, threads, pool);
            },
        }
        *entry = entry_lock.into_inner();
    }

    /// Stored vector of a slot (exact floats if kept, dequantised otherwise).
    fn vector_of(&self, slot: u32) -> Vec<f32> {
        let dim = self.params.dim;
        let s = slot as usize;
        if self.params.stores_float() {
            self.floats.as_slice()[s * dim..(s + 1) * dim].to_vec()
        } else {
            let scale = self.scales.as_slice()[s];
            self.codes.as_slice()[s * dim..(s + 1) * dim]
                .iter()
                .map(|&c| f32::from(c) * scale)
                .collect()
        }
    }

    pub fn heap_bytes(&self) -> usize {
        let map_bytes = self
            .key_map
            .get()
            .map_or(0, |m| m.capacity() * (std::mem::size_of::<(u64, u32)>() + 1));
        self.keys.heap_bytes()
            + self.levels.heap_bytes()
            + self.scales.heap_bytes()
            + self.norms.heap_bytes()
            + self.codes.heap_bytes()
            + self.floats.heap_bytes()
            + self.links0.heap_bytes()
            + self.upper_off.heap_bytes()
            + self.upper.heap_bytes()
            + self.tombstones.capacity() * 8
            + map_bytes
    }

    pub fn mapped_bytes(&self) -> usize {
        self.keys.mapped_bytes()
            + self.levels.mapped_bytes()
            + self.scales.mapped_bytes()
            + self.norms.mapped_bytes()
            + self.codes.mapped_bytes()
            + self.floats.mapped_bytes()
            + self.links0.mapped_bytes()
            + self.upper_off.mapped_bytes()
            + self.upper.mapped_bytes()
    }

    pub fn is_mapped(&self) -> bool {
        self.keys.is_mapped()
            || self.levels.is_mapped()
            || self.codes.is_mapped()
            || self.floats.is_mapped()
            || self.links0.is_mapped()
            || self.upper.is_mapped()
    }
}

fn run_inserts<S: Space>(
    ins: &Inserter<'_, S>,
    start: usize,
    end: usize,
    threads: usize,
    pool: &VisitedPool,
) {
    // The first slots of a graph are linked serially: inserting in parallel
    // into a near-empty graph produces nodes with very few links that can end
    // up unreachable.
    let serial_end =
        if threads <= 1 || end - start < 256 { end } else { end.min(start.max(SERIAL_PREFIX)) };
    if start < serial_end {
        let mut visited = pool.get(ins.slot_count);
        let mut scratch = Scratch::default();
        for slot in start..serial_end {
            ins.insert(slot as u32, &mut visited, &mut scratch);
        }
        pool.put(visited);
    }
    let start = serial_end;
    if start >= end {
        return;
    }
    let n = end - start;
    let next = AtomicUsize::new(start);
    std::thread::scope(|scope| {
        for _ in 0..threads.min(n) {
            scope.spawn(|| {
                let mut visited = pool.get(ins.slot_count);
                let mut scratch = Scratch::default();
                loop {
                    let slot = next.fetch_add(1, AtomicOrdering::Relaxed);
                    if slot >= end {
                        break;
                    }
                    ins.insert(slot as u32, &mut visited, &mut scratch);
                }
                pool.put(visited);
            });
        }
    });
}

/// Snapshot of index statistics.
#[derive(Debug, Clone, Serialize)]
pub struct IndexStats {
    /// Live (searchable) vectors.
    pub count: usize,
    /// Allocated slots including tombstones.
    pub slots: usize,
    pub tombstones: usize,
    pub dim: usize,
    /// Heap bytes owned by the index (excluding the file mapping).
    pub memory_bytes: usize,
    /// Bytes served in place from the memory-mapped file.
    pub mapped_bytes: usize,
    pub mapped: bool,
    pub max_level: usize,
    pub kernels: &'static str,
    pub params: IndexParams,
}

/// HNSW index. `Send + Sync`; share it behind an `Arc`.
pub struct Index {
    inner: RwLock<Inner>,
    visited: VisitedPool,
    locks: Box<[Mutex<()>]>,
    /// Immutable after construction; readable without locking.
    dim: usize,
    /// Live count mirrored outside the lock (updated before every write lock
    /// is released) so `len()` never waits for a batch insert.
    live: AtomicUsize,
}

fn new_locks() -> Box<[Mutex<()>]> {
    (0..LOCK_STRIPES).map(|_| Mutex::new(())).collect()
}

/// Validate without allocating (used to reject a whole batch up front).
fn validate_vector(v: &[f32], dim: usize, metric: Metric) -> Result<()> {
    if v.len() != dim {
        return Err(IndexError::DimensionMismatch { expected: dim, got: v.len() });
    }
    let mut norm_sq = 0f64;
    for &x in v {
        if !x.is_finite() {
            return Err(IndexError::NonFiniteVector);
        }
        norm_sq += f64::from(x) * f64::from(x);
    }
    if metric == Metric::Cosine && norm_sq <= 0.0 {
        return Err(IndexError::ZeroVector);
    }
    Ok(())
}

impl Index {
    /// Create an empty index.
    pub fn new(params: IndexParams) -> Result<Self> {
        let params = params.normalized();
        params.validate()?;
        Ok(Self::from_inner(Inner::new(params)))
    }

    pub(crate) fn from_inner(inner: Inner) -> Self {
        Self {
            dim: inner.params.dim,
            live: AtomicUsize::new(inner.live_count()),
            inner: RwLock::new(inner),
            visited: VisitedPool::default(),
            locks: new_locks(),
        }
    }

    pub fn params(&self) -> IndexParams {
        self.inner.read().params.clone()
    }

    /// Vector dimension (lock-free).
    pub fn dim(&self) -> usize {
        self.dim
    }

    /// Number of live vectors (lock-free; reflects every completed mutation
    /// and, during `add_batch`, every completed chunk).
    pub fn len(&self) -> usize {
        self.live.load(AtomicOrdering::Relaxed)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn tombstone_count(&self) -> usize {
        self.inner.read().tombstone_count
    }

    pub fn contains(&self, key: u64) -> bool {
        self.inner.read().key_map().contains_key(&key)
    }

    fn build_threads(params: &IndexParams) -> usize {
        if params.build_threads > 0 {
            params.build_threads
        } else {
            std::thread::available_parallelism().map_or(1, |n| n.get())
        }
    }

    /// Insert or replace one vector.
    pub fn add(&self, key: u64, vector: &[f32]) -> Result<()> {
        self.add_many(1, |_| key, |_| vector)
    }

    /// Insert or replace many vectors, linking them in parallel.
    pub fn add_batch(&self, items: &[(u64, Vec<f32>)]) -> Result<()> {
        self.add_many(items.len(), |i| items[i].0, |i| items[i].1.as_slice())
    }

    /// Insert or replace `keys.len()` vectors stored contiguously in `flat`.
    pub fn add_batch_flat(&self, keys: &[u64], flat: &[f32]) -> Result<()> {
        let dim = self.dim();
        if flat.len() != keys.len() * dim {
            return Err(IndexError::DimensionMismatch {
                expected: keys.len() * dim,
                got: flat.len(),
            });
        }
        self.add_many(keys.len(), |i| keys[i], |i| &flat[i * dim..(i + 1) * dim])
    }

    fn add_many<'v, K, V>(&self, n: usize, key_at: K, vec_at: V) -> Result<()>
    where
        K: Fn(usize) -> u64,
        V: Fn(usize) -> &'v [f32],
    {
        if n == 0 {
            return Ok(());
        }
        let (dim, metric, threads) = {
            let inner = self.inner.read();
            (self.dim, inner.params.metric, Self::build_threads(&inner.params))
        };
        // Reject the whole batch before mutating anything.
        for i in 0..n {
            validate_vector(vec_at(i), dim, metric)?;
        }
        let mut chunk_start = 0;
        while chunk_start < n {
            let chunk_end = (chunk_start + INSERT_CHUNK).min(n);
            let prepared: Vec<Vec<f32>> = (chunk_start..chunk_end)
                .map(|i| prepare_vector(vec_at(i), dim, metric))
                .collect::<Result<_>>()?;
            let mut inner = self.inner.write();
            if inner.slot_count() + prepared.len() > MAX_SLOTS {
                return Err(IndexError::CapacityExceeded { max: MAX_SLOTS });
            }
            inner.reserve(n - chunk_start);
            let first = inner.slot_count();
            for (offset, v) in prepared.iter().enumerate() {
                inner.allocate(key_at(chunk_start + offset), v)?;
            }
            let last = inner.slot_count();
            inner.link_range(first, last, threads, &self.locks, &self.visited);
            self.live.store(inner.live_count(), AtomicOrdering::Relaxed);
            drop(inner);
            chunk_start = chunk_end;
        }
        Ok(())
    }

    /// Tombstone a key. Returns `false` if the key was not present.
    pub fn remove(&self, key: u64) -> bool {
        let mut inner = self.inner.write();
        match inner.key_map_mut().remove(&key) {
            Some(slot) => {
                inner.set_tombstone(slot);
                self.live.store(inner.live_count(), AtomicOrdering::Relaxed);
                true
            },
            None => false,
        }
    }

    /// Rebuild the graph without tombstoned slots. Uses stored f32 vectors when
    /// available; with `keep_float = false` the int8 codes are dequantised,
    /// which is lossy but idempotent.
    pub fn compact(&self) -> Result<()> {
        let mut inner = self.inner.write();
        if inner.tombstone_count == 0 {
            return Ok(());
        }
        let mut fresh = Inner::new(inner.params.clone());
        fresh.rng = inner.rng.clone();
        fresh.reserve(inner.live_count());
        let metric = inner.params.metric;
        let dim = inner.params.dim;
        let keys = inner.keys.as_slice();
        for slot in 0..inner.slot_count() as u32 {
            if inner.is_tombstoned(slot) {
                continue;
            }
            let v = prepare_vector(&inner.vector_of(slot), dim, metric)?;
            fresh.allocate(keys[slot as usize], &v)?;
        }
        let threads = Self::build_threads(&inner.params);
        let total = fresh.slot_count();
        fresh.link_range(0, total, threads, &self.locks, &self.visited);
        *inner = fresh;
        self.live.store(inner.live_count(), AtomicOrdering::Relaxed);
        Ok(())
    }

    /// k-NN search. Scores are similarities (higher is better).
    pub fn search(&self, query: &[f32], k: usize, ef: Option<usize>) -> Result<Vec<(u64, f32)>> {
        self.search_impl(query, SearchOptions { k, ef, rescore_multiplier: None }, None)
    }

    /// k-NN search restricted to keys accepted by `filter`. Rejected nodes still
    /// route the traversal. Very selective filters degrade towards a full scan.
    pub fn search_filtered<F>(
        &self,
        query: &[f32],
        k: usize,
        ef: Option<usize>,
        filter: F,
    ) -> Result<Vec<(u64, f32)>>
    where
        F: Fn(u64) -> bool,
    {
        self.search_impl(query, SearchOptions { k, ef, rescore_multiplier: None }, Some(&filter))
    }

    /// Search with explicit per-query options (e.g. rescoring on/off).
    pub fn search_with(
        &self,
        query: &[f32],
        opts: SearchOptions,
        filter: Option<&dyn Fn(u64) -> bool>,
    ) -> Result<Vec<(u64, f32)>> {
        self.search_impl(query, opts, filter)
    }

    fn search_impl(
        &self,
        query: &[f32],
        opts: SearchOptions,
        filter: Option<&dyn Fn(u64) -> bool>,
    ) -> Result<Vec<(u64, f32)>> {
        let inner = self.inner.read();
        let p = &inner.params;
        let q = prepare_vector(query, p.dim, p.metric)?;
        let Some((ep, max_level)) = inner.entry else {
            return Ok(Vec::new());
        };
        if opts.k == 0 || inner.live_count() == 0 {
            return Ok(Vec::new());
        }
        let k = opts.k;
        let ef = opts.ef.unwrap_or(p.ef_search).max(k);
        let mult = opts.rescore_multiplier.unwrap_or(p.rescore_multiplier);
        let rescore = p.stores_codes() && p.stores_float() && mult > 0;
        let pool_size = if rescore { ef.max(k.saturating_mul(mult)) } else { ef };

        let links = SliceLinks {
            layout: inner.layout,
            l0: inner.links0.as_slice(),
            upper: inner.upper.as_slice(),
            upper_off: inner.upper_off.as_slice(),
        };
        let keys = inner.keys.as_slice();
        let slot_count = inner.slot_count();
        let accept = |slot: u32| {
            !inner.is_tombstoned(slot)
                && filter.is_none_or(|f| keys.get(slot as usize).is_some_and(|&key| f(key)))
        };

        let mut visited = self.visited.get(slot_count);
        let mut scratch = Scratch::default();
        let mut out = Vec::with_capacity(pool_size);
        match p.quantization {
            Quantization::Int8 => {
                let space = I8Space {
                    dim: p.dim,
                    metric: p.metric,
                    codes: inner.codes.as_slice(),
                    scales: inner.scales.as_slice(),
                    norms: inner.norms.as_slice(),
                };
                let mut codes = vec![0i8; p.dim];
                let (scale, norm) = quantize(&q, &mut codes);
                let qq = I8Query { codes: &codes, scale, norm };
                knn(
                    &space,
                    &links,
                    &qq,
                    ep,
                    max_level,
                    pool_size,
                    &mut visited,
                    &mut scratch,
                    accept,
                    &mut out,
                );
            },
            Quantization::None => {
                let space =
                    F32Space { dim: p.dim, metric: p.metric, floats: inner.floats.as_slice() };
                knn(
                    &space,
                    &links,
                    &q.as_slice(),
                    ep,
                    max_level,
                    pool_size,
                    &mut visited,
                    &mut scratch,
                    accept,
                    &mut out,
                );
            },
        }
        self.visited.put(visited);

        if rescore {
            let space = F32Space { dim: p.dim, metric: p.metric, floats: inner.floats.as_slice() };
            out.truncate(k.saturating_mul(mult));
            for c in out.iter_mut() {
                c.dist = space.dist_vec(&q, c.id);
            }
            out.sort_unstable();
        }
        out.truncate(k);
        Ok(out
            .into_iter()
            .filter_map(|c| keys.get(c.id as usize).map(|&key| (key, -c.dist)))
            .collect())
    }

    /// Persist to `path` (atomic write via a temporary file + rename). Holds
    /// the read lock: concurrent searches keep running, writers wait until the
    /// file is written.
    pub fn save(&self, path: impl AsRef<Path>) -> Result<()> {
        let inner = self.inner.read();
        crate::persist::save(&inner, path.as_ref())
    }

    /// Memory-map an index file. Searches read codes, vectors, keys and links
    /// in place; the first mutation copies the arrays it touches into owned
    /// buffers (see [`crate::buf::Buf`]).
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let inner = crate::persist::load(path.as_ref())?;
        Ok(Self::from_inner(inner))
    }

    /// Heap bytes held by the index (vectors, graph, key map, locks, pools).
    pub fn memory_bytes(&self) -> usize {
        let inner = self.inner.read();
        inner.heap_bytes()
            + self.locks.len() * std::mem::size_of::<Mutex<()>>()
            + self.visited.heap_bytes()
    }

    pub fn stats(&self) -> IndexStats {
        let inner = self.inner.read();
        let memory_bytes = inner.heap_bytes()
            + self.locks.len() * std::mem::size_of::<Mutex<()>>()
            + self.visited.heap_bytes();
        IndexStats {
            count: inner.live_count(),
            slots: inner.slot_count(),
            tombstones: inner.tombstone_count,
            dim: inner.params.dim,
            memory_bytes,
            mapped_bytes: inner.mapped_bytes(),
            mapped: inner.is_mapped(),
            max_level: inner.entry.map_or(0, |e| e.1),
            kernels: kernels::kernel_name(),
            params: inner.params.clone(),
        }
    }

    /// Drop pooled visited sets (e.g. after a large compaction).
    pub fn release_scratch(&self) {
        self.visited.clear();
    }
}

#[allow(clippy::too_many_arguments)]
fn knn<S: Space, F: Fn(u32) -> bool>(
    space: &S,
    links: &SliceLinks<'_>,
    q: &S::Query<'_>,
    ep: u32,
    max_level: usize,
    ef: usize,
    visited: &mut Visited,
    scratch: &mut Scratch,
    accept: F,
    out: &mut Vec<Candidate>,
) {
    let mut cur = Candidate { dist: space.dist_query(q, ep), id: ep };
    let mut buf = Vec::new();
    for level in (1..=max_level).rev() {
        cur = greedy_closest(space, links, q, cur, level, &mut buf);
    }
    search_layer(space, links, q, &[cur], ef, 0, visited, scratch, accept, out);
}

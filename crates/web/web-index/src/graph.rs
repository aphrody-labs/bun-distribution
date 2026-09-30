//! HNSW graph algorithms (Malkov & Yashunin, 2018).
//!
//! Link layout (shared by the in-memory and on-disk representations):
//! * layer 0: fixed blocks of `M0 + 1` u32 per slot at `slot * (M0 + 1)`: `[count, n_0, ..,
//!   n_{M0-1}]`;
//! * layers >= 1: blocks of `M + 1` u32 per (slot, level) in a flat array, node `slot` owns
//!   `upper[upper_off[slot] .. upper_off[slot + 1]]`, with level `l` at `upper_off[slot] + (l - 1)
//!   * (M + 1)`.

use std::{
    cmp::{Ordering, Reverse},
    collections::BinaryHeap,
    sync::atomic::{AtomicU32, Ordering as AtomicOrdering},
};

use parking_lot::{Mutex, MutexGuard};

use crate::{space::Space, visited::Visited};

/// Number of lock stripes guarding link lists during parallel construction.
pub const LOCK_STRIPES: usize = 1 << 16;

/// A (distance, slot) pair ordered by distance (total order), then slot.
#[derive(Debug, Clone, Copy)]
pub struct Candidate {
    pub dist: f32,
    pub id: u32,
}

impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Candidate {}
impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> Ordering {
        self.dist.total_cmp(&other.dist).then_with(|| self.id.cmp(&other.id))
    }
}

/// Connectivity parameters.
#[derive(Debug, Clone, Copy)]
pub struct Layout {
    pub m: usize,
    pub m0: usize,
}

impl Layout {
    #[inline]
    pub fn block(&self, level: usize) -> usize {
        if level == 0 { self.m0 + 1 } else { self.m + 1 }
    }
}

/// Read access to adjacency lists.
pub trait LinkView: Sync {
    /// Copy the neighbours of `slot` at `level` into `out` (cleared first).
    fn read(&self, slot: u32, level: usize, out: &mut Vec<u32>);
}

/// Immutable links borrowed from owned vectors or a memory map. Every access
/// is bounds-checked, so corrupted adjacency can degrade results but never
/// cause UB or a panic.
pub struct SliceLinks<'a> {
    pub layout: Layout,
    pub l0: &'a [u32],
    pub upper: &'a [u32],
    pub upper_off: &'a [u64],
}

#[inline]
fn upper_block_range(
    layout: Layout,
    upper_off: &[u64],
    slot: u32,
    level: usize,
) -> Option<(usize, usize)> {
    let s = slot as usize;
    let start = *upper_off.get(s)? as usize;
    let end = *upper_off.get(s + 1)? as usize;
    let bs = layout.m + 1;
    let off = start.checked_add((level - 1).checked_mul(bs)?)?;
    if off.checked_add(bs)? > end {
        return None;
    }
    Some((off, bs))
}

impl LinkView for SliceLinks<'_> {
    #[inline]
    fn read(&self, slot: u32, level: usize, out: &mut Vec<u32>) {
        out.clear();
        let block = if level == 0 {
            let bs = self.layout.m0 + 1;
            let base = slot as usize * bs;
            self.l0.get(base..base + bs)
        } else {
            upper_block_range(self.layout, self.upper_off, slot, level)
                .and_then(|(off, bs)| self.upper.get(off..off + bs))
        };
        if let Some(block) = block {
            let cnt = (block[0] as usize).min(block.len() - 1);
            out.extend_from_slice(&block[1..1 + cnt]);
        }
    }
}

/// Mutable links used during (parallel) construction. Values are atomics so
/// that shared references are enough; multi-word consistency of a list is
/// guaranteed by the striped mutex of its slot. At most one stripe lock is
/// held at a time, so there is no lock-ordering deadlock.
pub struct AtomicLinks<'a> {
    pub layout: Layout,
    pub l0: &'a [AtomicU32],
    pub upper: &'a [AtomicU32],
    pub upper_off: &'a [u64],
    pub locks: &'a [Mutex<()>],
}

impl<'a> AtomicLinks<'a> {
    #[inline]
    pub fn lock(&self, slot: u32) -> MutexGuard<'a, ()> {
        self.locks[slot as usize & (self.locks.len() - 1)].lock()
    }

    #[inline]
    fn block(&self, slot: u32, level: usize) -> Option<&'a [AtomicU32]> {
        if level == 0 {
            let bs = self.layout.m0 + 1;
            let base = slot as usize * bs;
            self.l0.get(base..base + bs)
        } else {
            upper_block_range(self.layout, self.upper_off, slot, level)
                .and_then(|(off, bs)| self.upper.get(off..off + bs))
        }
    }

    /// Read without taking the lock (caller holds it).
    #[inline]
    pub fn read_unlocked(&self, slot: u32, level: usize, out: &mut Vec<u32>) {
        out.clear();
        if let Some(block) = self.block(slot, level) {
            let cnt = (block[0].load(AtomicOrdering::Relaxed) as usize).min(block.len() - 1);
            out.extend(block[1..1 + cnt].iter().map(|a| a.load(AtomicOrdering::Relaxed)));
        }
    }

    /// Overwrite a list without taking the lock (caller holds it). Extra ids
    /// beyond the block capacity are dropped.
    #[inline]
    pub fn write_unlocked(&self, slot: u32, level: usize, ids: impl IntoIterator<Item = u32>) {
        if let Some(block) = self.block(slot, level) {
            let mut n = 0usize;
            for (dst, id) in block[1..].iter().zip(ids) {
                dst.store(id, AtomicOrdering::Relaxed);
                n += 1;
            }
            block[0].store(n as u32, AtomicOrdering::Relaxed);
        }
    }
}

impl LinkView for AtomicLinks<'_> {
    #[inline]
    fn read(&self, slot: u32, level: usize, out: &mut Vec<u32>) {
        let _guard = self.lock(slot);
        self.read_unlocked(slot, level, out);
    }
}

/// Reusable per-thread buffers.
#[derive(Default)]
pub struct Scratch {
    candidates: BinaryHeap<Reverse<Candidate>>,
    results: BinaryHeap<Candidate>,
    neighbours: Vec<u32>,
    pub layer_out: Vec<Candidate>,
    pub selected: Vec<Candidate>,
    discarded: Vec<Candidate>,
    prune: Vec<Candidate>,
    kept: Vec<Candidate>,
}

/// Greedy ef=1 descent on one layer.
#[inline]
pub fn greedy_closest<S: Space, L: LinkView>(
    space: &S,
    links: &L,
    q: &S::Query<'_>,
    mut cur: Candidate,
    level: usize,
    buf: &mut Vec<u32>,
) -> Candidate {
    loop {
        let mut changed = false;
        links.read(cur.id, level, buf);
        for &n in buf.iter() {
            space.prefetch(n);
        }
        for &n in buf.iter() {
            let d = space.dist_query(q, n);
            if d < cur.dist {
                cur = Candidate { dist: d, id: n };
                changed = true;
            }
        }
        if !changed {
            return cur;
        }
    }
}

/// Algorithm 2 (SEARCH-LAYER). Nodes rejected by `accept` still route the
/// traversal but never enter the result set. Results are written to `out`
/// sorted by ascending distance.
#[allow(clippy::too_many_arguments)]
pub fn search_layer<S: Space, L: LinkView, F: Fn(u32) -> bool>(
    space: &S,
    links: &L,
    q: &S::Query<'_>,
    entries: &[Candidate],
    ef: usize,
    level: usize,
    visited: &mut Visited,
    scratch: &mut Scratch,
    accept: F,
    out: &mut Vec<Candidate>,
) {
    let ef = ef.max(1);
    let Scratch { candidates, results, neighbours, .. } = scratch;
    candidates.clear();
    results.clear();
    let mut lower = f32::INFINITY;
    for &e in entries {
        if visited.insert(e.id) {
            candidates.push(Reverse(e));
            if accept(e.id) {
                results.push(e);
                if results.len() > ef {
                    results.pop();
                }
            }
        }
    }
    if let Some(worst) = results.peek() {
        lower = worst.dist;
    }
    while let Some(Reverse(c)) = candidates.pop() {
        if c.dist > lower && results.len() >= ef {
            break;
        }
        links.read(c.id, level, neighbours);
        for &n in neighbours.iter() {
            space.prefetch(n);
        }
        for &n in neighbours.iter() {
            if !visited.insert(n) {
                continue;
            }
            let d = space.dist_query(q, n);
            if results.len() < ef || d < lower {
                let cand = Candidate { dist: d, id: n };
                candidates.push(Reverse(cand));
                if accept(n) {
                    results.push(cand);
                    if results.len() > ef {
                        results.pop();
                    }
                    if let Some(worst) = results.peek() {
                        lower = worst.dist;
                    }
                }
            }
        }
    }
    out.clear();
    out.extend(results.drain());
    out.sort_unstable();
}

/// Algorithm 4 (SELECT-NEIGHBORS-HEURISTIC) without candidate extension.
/// `cands` must be sorted by ascending distance to the base element.
pub fn select_neighbours<S: Space>(
    space: &S,
    cands: &[Candidate],
    m: usize,
    keep_pruned: bool,
    out: &mut Vec<Candidate>,
    discarded: &mut Vec<Candidate>,
) {
    out.clear();
    discarded.clear();
    if keep_pruned && cands.len() <= m {
        // With keepPrunedConnections every candidate ends up selected anyway.
        out.extend_from_slice(cands);
        return;
    }
    for &c in cands {
        if out.len() >= m {
            break;
        }
        // Keep `c` only if it is closer to the base than to every selected
        // neighbour (diversity criterion).
        let good = out.iter().all(|r| space.dist_nodes(c.id, r.id) >= c.dist);
        if good {
            out.push(c);
        } else if keep_pruned {
            discarded.push(c);
        }
    }
    if keep_pruned {
        for &c in discarded.iter() {
            if out.len() >= m {
                break;
            }
            out.push(c);
        }
    }
}

/// Global entry point: `(slot, level)`.
pub type Entry = Option<(u32, usize)>;

/// Everything an insertion worker needs.
pub struct Inserter<'a, S: Space> {
    pub space: &'a S,
    pub links: AtomicLinks<'a>,
    pub levels: &'a [u8],
    pub entry: &'a Mutex<Entry>,
    pub ef_construction: usize,
    pub keep_pruned: bool,
    pub slot_count: usize,
}

impl<S: Space> Inserter<'_, S> {
    /// Algorithm 1 (INSERT) for a slot whose vector and (empty) link blocks
    /// are already allocated.
    pub fn insert(&self, slot: u32, visited: &mut Visited, scratch: &mut Scratch) {
        let level = self.levels.get(slot as usize).copied().unwrap_or(0) as usize;
        let mut guard = self.entry.lock();
        let (ep, max_level) = match *guard {
            None => {
                *guard = Some((slot, level));
                return;
            },
            Some(e) => e,
        };
        // A node that raises the top level keeps the entry lock for its whole
        // insertion (rare: probability ~1/M per level) so that concurrent
        // inserts never observe an entry point without links.
        let held = if level > max_level {
            Some(guard)
        } else {
            drop(guard);
            None
        };

        let layout = self.links.layout;
        let q = self.space.slot_query(slot);
        let mut cur = Candidate { dist: self.space.dist_query(&q, ep), id: ep };
        let mut buf = std::mem::take(&mut scratch.neighbours);
        for lc in (level + 1..=max_level).rev() {
            cur = greedy_closest(self.space, &self.links, &q, cur, lc, &mut buf);
        }
        scratch.neighbours = buf;

        let mut entries = vec![cur];
        let mut layer_out = std::mem::take(&mut scratch.layer_out);
        let mut selected = std::mem::take(&mut scratch.selected);
        let mut discarded = std::mem::take(&mut scratch.discarded);
        let mut prune = std::mem::take(&mut scratch.prune);
        let mut kept = std::mem::take(&mut scratch.kept);
        let mut ids = Vec::new();

        for lc in (0..=level.min(max_level)).rev() {
            visited.reset(self.slot_count);
            search_layer(
                self.space,
                &self.links,
                &q,
                &entries,
                self.ef_construction,
                lc,
                visited,
                scratch,
                |id| id != slot,
                &mut layer_out,
            );
            select_neighbours(
                self.space,
                &layer_out,
                layout.m,
                self.keep_pruned,
                &mut selected,
                &mut discarded,
            );

            // Set our own list. A concurrent insert may already have linked
            // to us at this level; merge instead of overwriting.
            {
                let _g = self.links.lock(slot);
                self.links.read_unlocked(slot, lc, &mut ids);
                if ids.is_empty() {
                    self.links.write_unlocked(slot, lc, selected.iter().map(|c| c.id));
                } else {
                    let mmax = layout.block(lc) - 1;
                    prune.clear();
                    prune.extend(selected.iter().copied());
                    for &id in &ids {
                        if id != slot && !prune.iter().any(|c| c.id == id) {
                            prune.push(Candidate { dist: self.space.dist_query(&q, id), id });
                        }
                    }
                    prune.sort_unstable();
                    select_neighbours(
                        self.space,
                        &prune,
                        mmax,
                        self.keep_pruned,
                        &mut kept,
                        &mut discarded,
                    );
                    self.links.write_unlocked(slot, lc, kept.iter().map(|c| c.id));
                }
            }

            let mmax = layout.block(lc) - 1;
            for c in selected.iter() {
                self.add_backlink(
                    c.id,
                    slot,
                    lc,
                    mmax,
                    &mut ids,
                    &mut prune,
                    &mut kept,
                    &mut discarded,
                );
            }
            if !layer_out.is_empty() {
                entries.clear();
                entries.extend_from_slice(&layer_out);
            }
        }

        scratch.layer_out = layer_out;
        scratch.selected = selected;
        scratch.discarded = discarded;
        scratch.prune = prune;
        scratch.kept = kept;

        if let Some(mut g) = held {
            *g = Some((slot, level));
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn add_backlink(
        &self,
        node: u32,
        new: u32,
        level: usize,
        mmax: usize,
        ids: &mut Vec<u32>,
        prune: &mut Vec<Candidate>,
        kept: &mut Vec<Candidate>,
        discarded: &mut Vec<Candidate>,
    ) {
        if node == new {
            return;
        }
        let _g = self.links.lock(node);
        self.links.read_unlocked(node, level, ids);
        if ids.contains(&new) {
            return;
        }
        if ids.len() < mmax {
            ids.push(new);
            self.links.write_unlocked(node, level, ids.iter().copied());
            return;
        }
        prune.clear();
        let base = self.space.slot_query(node);
        for &id in ids.iter().chain(std::iter::once(&new)) {
            prune.push(Candidate { dist: self.space.dist_query(&base, id), id });
        }
        prune.sort_unstable();
        select_neighbours(self.space, prune, mmax, self.keep_pruned, kept, discarded);
        self.links.write_unlocked(node, level, kept.iter().map(|c| c.id));
    }
}

/// View `&mut [u32]` as `&[AtomicU32]` for the duration of the borrow.
pub fn as_atomic(slice: &mut [u32]) -> &[AtomicU32] {
    // SAFETY: `AtomicU32` has the same size, alignment and bit validity as
    // `u32` (documented guarantee), and the exclusive borrow ensures no other
    // plain `&u32` alias exists while the atomic view is alive. This mirrors
    // the unstable `AtomicU32::from_mut_slice`.
    unsafe { &*(slice as *mut [u32] as *const [AtomicU32]) }
}

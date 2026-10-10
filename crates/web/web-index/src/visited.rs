//! Epoch-tagged visited sets, pooled so that searches do not allocate O(N)
//! memory per query.

use parking_lot::Mutex;

/// Visited set over dense slot ids. Resetting is O(1) (epoch bump) except on
/// the rare epoch wrap-around.
#[derive(Default)]
pub struct Visited {
    tags: Vec<u32>,
    epoch: u32,
}

impl Visited {
    /// Prepare for a traversal over `n` slots.
    pub fn reset(&mut self, n: usize) {
        if self.tags.len() < n {
            self.tags.resize(n, 0);
        }
        self.epoch = self.epoch.wrapping_add(1);
        if self.epoch == 0 {
            self.tags.fill(0);
            self.epoch = 1;
        }
    }

    /// Mark `id`; returns `true` if it was not visited before. Out-of-range
    /// ids are reported as already visited so they are never expanded.
    #[inline]
    pub fn insert(&mut self, id: u32) -> bool {
        match self.tags.get_mut(id as usize) {
            Some(tag) if *tag != self.epoch => {
                *tag = self.epoch;
                true
            },
            _ => false,
        }
    }

    pub fn heap_bytes(&self) -> usize {
        self.tags.capacity() * std::mem::size_of::<u32>()
    }
}

/// Pool of visited sets shared by concurrent searches.
#[derive(Default)]
pub struct VisitedPool {
    pool: Mutex<Vec<Visited>>,
}

impl VisitedPool {
    pub fn get(&self, n: usize) -> Visited {
        let mut v = self.pool.lock().pop().unwrap_or_default();
        v.reset(n);
        v
    }

    pub fn put(&self, v: Visited) {
        let mut pool = self.pool.lock();
        // Bound the pool so a burst of concurrent queries does not pin memory.
        if pool.len() < 64 {
            pool.push(v);
        }
    }

    pub fn heap_bytes(&self) -> usize {
        self.pool.lock().iter().map(Visited::heap_bytes).sum()
    }

    pub fn clear(&self) {
        self.pool.lock().clear();
    }
}

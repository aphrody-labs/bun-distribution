// SPDX-License-Identifier: Apache-2.0
//! Bump arena allocation inspired by `bun_alloc`.
//!
//! Provides zero-allocation-per-node AST storage and string deduplication
//! for shell scripts and parsers.

use std::cell::RefCell;

/// Default chunk size for the arena allocator (64 KiB).
pub const DEFAULT_CHUNK_SIZE: usize = 64 * 1024;

/// Chunk-based memory arena for fast bump allocation.
#[derive(Debug)]
pub struct AstArena {
    chunks: RefCell<Vec<Vec<u8>>>,
    current: RefCell<Vec<u8>>,
    chunk_size: usize,
}

impl Default for AstArena {
    fn default() -> Self {
        Self::new(DEFAULT_CHUNK_SIZE)
    }
}

impl AstArena {
    /// Create a new arena with a specified chunk size.
    pub fn new(chunk_size: usize) -> Self {
        Self {
            chunks: RefCell::new(Vec::new()),
            current: RefCell::new(Vec::with_capacity(chunk_size)),
            chunk_size: chunk_size.max(1024),
        }
    }

    /// Allocate a byte slice in the arena and return a stable string reference.
    pub fn alloc_str<'a>(&'a self, s: &str) -> &'a str {
        let bytes = s.as_bytes();
        let len = bytes.len();
        let mut cur = self.current.borrow_mut();

        if cur.capacity() - cur.len() < len {
            let next_capacity = self.chunk_size.max(len);
            let old = std::mem::replace(&mut *cur, Vec::with_capacity(next_capacity));
            if !old.is_empty() {
                self.chunks.borrow_mut().push(old);
            }
        }

        let start = cur.len();
        cur.extend_from_slice(bytes);
        let slice = &cur[start..start + len];

        // SAFETY: The memory is pinned in the arena chunk vector and won't be reallocated
        // or freed until the AstArena itself is dropped.
        unsafe {
            let ptr = slice.as_ptr();
            let s_slice = std::slice::from_raw_parts(ptr, len);
            std::str::from_utf8_unchecked(s_slice)
        }
    }

    /// Total bytes currently allocated across all chunks.
    pub fn allocated_bytes(&self) -> usize {
        let in_chunks: usize = self.chunks.borrow().iter().map(|c| c.capacity()).sum();
        in_chunks + self.current.borrow().capacity()
    }

    /// Reset the arena, retaining capacity for reuse.
    pub fn reset(&self) {
        self.chunks.borrow_mut().clear();
        self.current.borrow_mut().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_arena_alloc_str() {
        let arena = AstArena::new(256);
        let s1 = arena.alloc_str("hello");
        let s2 = arena.alloc_str("world");
        assert_eq!(s1, "hello");
        assert_eq!(s2, "world");
        assert!(arena.allocated_bytes() >= 256);
    }
}

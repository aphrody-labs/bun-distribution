//! Flat arrays that are either owned or borrowed in place from a memory map.
//!
//! A loaded index serves searches straight from the mapping. The first
//! mutation that needs to grow or rewrite an array calls [`Buf::to_mut`],
//! which copies that one array into an owned `Vec` (copy-on-first-write per
//! array). Arrays that are never mutated keep pointing into the mapping.

use std::{marker::PhantomData, sync::Arc};

use memmap2::Mmap;

mod sealed {
    pub trait Sealed {}
    impl Sealed for u8 {}
    impl Sealed for i8 {}
    impl Sealed for u32 {}
    impl Sealed for u64 {}
    impl Sealed for f32 {}
}

/// Plain-old-data scalars whose every bit pattern is valid and whose on-disk
/// representation is little-endian.
pub trait Pod: sealed::Sealed + Copy + Default + Send + Sync + 'static {}
impl Pod for u8 {}
impl Pod for i8 {}
impl Pod for u32 {}
impl Pod for u64 {}
impl Pod for f32 {}

/// Owned or memory-mapped flat array.
pub enum Buf<T: Pod> {
    Owned(Vec<T>),
    Mapped {
        map: Arc<Mmap>,
        /// Byte offset of the first element (aligned for `T`).
        offset: usize,
        /// Element count.
        len: usize,
        _marker: PhantomData<T>,
    },
}

impl<T: Pod> Default for Buf<T> {
    fn default() -> Self {
        Buf::Owned(Vec::new())
    }
}

impl<T: Pod> Buf<T> {
    /// Create a mapped view. Validates bounds and alignment so that
    /// [`Buf::as_slice`] is always sound.
    pub fn mapped(map: Arc<Mmap>, offset: usize, len: usize) -> Option<Self> {
        let size = std::mem::size_of::<T>();
        let bytes = len.checked_mul(size)?;
        let end = offset.checked_add(bytes)?;
        if end > map.len() {
            return None;
        }
        let ptr = map.as_ptr().wrapping_add(offset);
        if !(ptr as usize).is_multiple_of(std::mem::align_of::<T>()) {
            return None;
        }
        Some(Buf::Mapped { map, offset, len, _marker: PhantomData })
    }

    #[inline]
    pub fn as_slice(&self) -> &[T] {
        match self {
            Buf::Owned(v) => v.as_slice(),
            Buf::Mapped { map, offset, len, .. } => {
                let bytes = &map[*offset..*offset + *len * std::mem::size_of::<T>()];
                // SAFETY: bounds and alignment were validated in `mapped`; `T`
                // is a sealed POD scalar for which every bit pattern is valid;
                // the mapping is kept alive by the `Arc` borrowed from `self`.
                unsafe { std::slice::from_raw_parts(bytes.as_ptr() as *const T, *len) }
            },
        }
    }

    /// Materialise into an owned vector (copying from the map once).
    pub fn to_mut(&mut self) -> &mut Vec<T> {
        if let Buf::Mapped { .. } = self {
            let owned = self.as_slice().to_vec();
            *self = Buf::Owned(owned);
        }
        match self {
            Buf::Owned(v) => v,
            Buf::Mapped { .. } => unreachable!("materialised above"),
        }
    }

    pub fn len(&self) -> usize {
        match self {
            Buf::Owned(v) => v.len(),
            Buf::Mapped { len, .. } => *len,
        }
    }

    pub fn is_mapped(&self) -> bool {
        matches!(self, Buf::Mapped { .. })
    }

    /// Heap bytes owned by this buffer (mapped bytes are reported separately).
    pub fn heap_bytes(&self) -> usize {
        match self {
            Buf::Owned(v) => v.capacity() * std::mem::size_of::<T>(),
            Buf::Mapped { .. } => 0,
        }
    }

    /// Bytes of the mapping referenced by this buffer.
    pub fn mapped_bytes(&self) -> usize {
        match self {
            Buf::Owned(_) => 0,
            Buf::Mapped { len, .. } => *len * std::mem::size_of::<T>(),
        }
    }
}

/// View a POD slice as raw little-endian bytes (for writing).
pub fn as_bytes<T: Pod>(slice: &[T]) -> &[u8] {
    // SAFETY: POD scalars have no padding and any byte view of them is valid.
    unsafe { std::slice::from_raw_parts(slice.as_ptr() as *const u8, std::mem::size_of_val(slice)) }
}

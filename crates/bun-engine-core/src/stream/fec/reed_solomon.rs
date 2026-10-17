// SPDX-License-Identifier: BSD-2-Clause
// Absorbed from fec-rs (https://github.com/hgaiser/fec-rs, revision 402f41f970bb8c3ef7c88639821032e3b6460f63),
// Copyright (c) 2026, Hans Gaiser. See crates/bun-engine-core/STREAM-PROVENANCE.md.
use std::collections::HashMap;
use std::sync::Mutex;

use super::errors::{Error, SBSError};
use super::galois::{self, EXP_TABLE, LOG_TABLE};
use super::matrix::Matrix;

const DATA_DECODE_MATRIX_CACHE_CAPACITY: usize = 254;

/// Reed-Solomon erasure code encoder/decoder.
///
/// Operates over GF(2^8) with generating polynomial 29, compatible
/// with the Moonlight streaming protocol.
///
/// # Example
///
#[derive(Debug)]
pub struct ReedSolomon {
    data_shard_count: usize,
    parity_shard_count: usize,
    total_shard_count: usize,
    matrix: Matrix,
    mul_slice_fn: galois::MulSliceFn,
    mul_slice_xor_fn: galois::MulSliceFn,
    data_decode_matrix_cache: Mutex<HashMap<Vec<usize>, Matrix>>,
}

impl Clone for ReedSolomon {
    fn clone(&self) -> Self {
        ReedSolomon {
            data_shard_count: self.data_shard_count,
            parity_shard_count: self.parity_shard_count,
            total_shard_count: self.total_shard_count,
            matrix: self.matrix.clone(),
            mul_slice_fn: self.mul_slice_fn,
            mul_slice_xor_fn: self.mul_slice_xor_fn,
            data_decode_matrix_cache: Mutex::new(HashMap::new()),
        }
    }
}

impl PartialEq for ReedSolomon {
    fn eq(&self, rhs: &ReedSolomon) -> bool {
        self.data_shard_count == rhs.data_shard_count
            && self.parity_shard_count == rhs.parity_shard_count
            && self.matrix == rhs.matrix
    }
}

impl ReedSolomon {
    fn build_matrix(data_shards: usize, total_shards: usize) -> Matrix {
        let vandermonde = Matrix::vandermonde(total_shards, data_shards);
        let top = vandermonde.sub_matrix(0, 0, data_shards, data_shards);
        let mut result = vandermonde.multiply(&top.invert().unwrap());

        let parity_shards = total_shards - data_shards;
        let mut inverse = vec![0u8; 256];
        inverse[0] = 0;
        inverse[1] = 1;
        for i in 2..256 {
            inverse[i] = EXP_TABLE[(255 - LOG_TABLE[i]) as usize];
        }

        for j in 0..parity_shards {
            for i in 0..data_shards {
                result.data[(data_shards + j) * data_shards + i] = inverse[(parity_shards + i) ^ j];
            }
        }

        result
    }

    /// Creates a new Reed-Solomon encoder/decoder.
    ///
    /// # Errors
    ///
    /// Returns an error if `data_shards` or `parity_shards` is 0,
    /// or if `data_shards + parity_shards > 256`.
    pub fn new(data_shards: usize, parity_shards: usize) -> Result<Self, Error> {
        if data_shards == 0 {
            return Err(Error::TooFewDataShards);
        }
        if parity_shards == 0 {
            return Err(Error::TooFewParityShards);
        }
        if data_shards + parity_shards > 256 {
            return Err(Error::TooManyShards);
        }

        let total_shards = data_shards + parity_shards;
        let matrix = Self::build_matrix(data_shards, total_shards);
        let (mul_slice_fn, mul_slice_xor_fn) = galois::detect_mul_slice();

        Ok(ReedSolomon {
            data_shard_count: data_shards,
            parity_shard_count: parity_shards,
            total_shard_count: total_shards,
            matrix,
            mul_slice_fn,
            mul_slice_xor_fn,
            data_decode_matrix_cache: Mutex::new(HashMap::new()),
        })
    }

    /// Directly set the parity rows of the encoding matrix.
    ///
    /// `parity` must have exactly `parity_shard_count * data_shard_count` elements.
    /// This is used for compatibility with the Moonlight audio protocol,
    /// where the parity matrix values are hardcoded from OpenFEC.
    pub fn set_parity_matrix(&mut self, parity: &[u8]) -> Result<(), Error> {
        let expected = self.parity_shard_count * self.data_shard_count;
        if parity.len() != expected {
            return Err(Error::InvalidParityMatrix);
        }
        let offset = self.data_shard_count * self.data_shard_count;
        self.matrix.data[offset..offset + expected].copy_from_slice(parity);
        self.data_decode_matrix_cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clear();
        Ok(())
    }

    pub fn data_shard_count(&self) -> usize {
        self.data_shard_count
    }

    pub fn parity_shard_count(&self) -> usize {
        self.parity_shard_count
    }

    pub fn total_shard_count(&self) -> usize {
        self.total_shard_count
    }

    #[inline]
    fn get_parity_rows(&self) -> Vec<&[u8]> {
        (self.data_shard_count..self.total_shard_count)
            .map(|i| self.matrix.get_row(i))
            .collect()
    }

    /// Multiply `input` by `c` in GF(2^8), write to `out`. Uses pre-detected SIMD path.
    #[inline(always)]
    fn mul_slice(&self, c: u8, input: &[u8], out: &mut [u8]) {
        assert_eq!(input.len(), out.len());
        if c == 0 {
            out.iter_mut().for_each(|o| *o = 0);
            return;
        }
        if c == 1 {
            out.copy_from_slice(input);
            return;
        }
        (self.mul_slice_fn)(c, input, out);
    }

    /// Multiply `input` by `c` in GF(2^8), XOR into `out`. Uses pre-detected SIMD path.
    #[inline(always)]
    fn mul_slice_xor(&self, c: u8, input: &[u8], out: &mut [u8]) {
        assert_eq!(input.len(), out.len());
        if c == 0 {
            return;
        }
        if c == 1 {
            for (o, i) in out.iter_mut().zip(input.iter()) {
                *o ^= *i;
            }
            return;
        }
        (self.mul_slice_xor_fn)(c, input, out);
    }

    fn code_some_slices(&self, matrix_rows: &[&[u8]], inputs: &[&[u8]], outputs: &mut [&mut [u8]]) {
        for (i_input, input) in inputs.iter().enumerate() {
            self.code_single_slice(matrix_rows, i_input, input, outputs);
        }
    }

    #[inline]
    fn code_single_slice(
        &self,
        matrix_rows: &[&[u8]],
        i_input: usize,
        input: &[u8],
        outputs: &mut [&mut [u8]],
    ) {
        for (i_row, output) in outputs.iter_mut().enumerate() {
            let c = matrix_rows[i_row][i_input];
            if i_input == 0 {
                self.mul_slice(c, input, output);
            } else {
                self.mul_slice_xor(c, input, output);
            }
        }
    }

    /// Constructs the parity shards.
    ///
    /// The parity shard slots will be overwritten.

    pub fn encode<T: AsRef<[u8]> + AsMut<[u8]>>(&self, shards: &mut [T]) -> Result<(), Error> {
        if shards.len() < self.total_shard_count {
            return Err(Error::TooFewShards);
        }
        if shards.len() > self.total_shard_count {
            return Err(Error::TooManyShards);
        }
        Self::check_slices_uniform(shards)?;

        let (data, parity) = shards.split_at_mut(self.data_shard_count);
        let parity_rows = self.get_parity_rows();

        Self::encode_sequential(
            data,
            parity,
            &parity_rows,
            self.mul_slice_fn,
            self.mul_slice_xor_fn,
        );
        Ok(())
    }

    fn encode_sequential<T: AsRef<[u8]> + AsMut<[u8]>>(
        data: &[T],
        parity: &mut [T],
        parity_rows: &[&[u8]],
        mul_slice_fn: galois::MulSliceFn,
        mul_slice_xor_fn: galois::MulSliceFn,
    ) {
        for i_input in 0..data.len() {
            let input = data[i_input].as_ref();
            for (i_row, p) in parity.iter_mut().enumerate() {
                let c = parity_rows[i_row][i_input];
                let output = p.as_mut();
                if c == 0 {
                    if i_input == 0 {
                        output.iter_mut().for_each(|o| *o = 0);
                    }
                } else if c == 1 {
                    if i_input == 0 {
                        output.copy_from_slice(input);
                    } else {
                        for (o, i) in output.iter_mut().zip(input.iter()) {
                            *o ^= *i;
                        }
                    }
                } else if i_input == 0 {
                    mul_slice_fn(c, input, output);
                } else {
                    mul_slice_xor_fn(c, input, output);
                }
            }
        }
    }

    /// Constructs the parity shards using separate data and parity references.
    pub fn encode_sep<T: AsRef<[u8]>, U: AsRef<[u8]> + AsMut<[u8]>>(
        &self,
        data: &[T],
        parity: &mut [U],
    ) -> Result<(), Error> {
        if data.len() != self.data_shard_count {
            return Err(if data.len() < self.data_shard_count {
                Error::TooFewDataShards
            } else {
                Error::TooManyDataShards
            });
        }
        if parity.len() != self.parity_shard_count {
            return Err(if parity.len() < self.parity_shard_count {
                Error::TooFewParityShards
            } else {
                Error::TooManyParityShards
            });
        }

        let data_refs: Vec<&[u8]> = data.iter().map(|s| s.as_ref()).collect();
        let mut parity_refs: Vec<&mut [u8]> = parity.iter_mut().map(|s| s.as_mut()).collect();

        // Ensure all slices (data + parity) have the same non-zero length.
        let shard_len = data_refs[0].len();
        if shard_len == 0 {
            return Err(Error::EmptyShard);
        }
        for d in &data_refs[1..] {
            if d.len() != shard_len {
                return Err(Error::IncorrectShardSize);
            }
        }
        for p in parity_refs.iter() {
            if p.len() != shard_len {
                return Err(Error::IncorrectShardSize);
            }
        }

        let parity_rows = self.get_parity_rows();
        self.code_some_slices(&parity_rows, &data_refs, &mut parity_refs);

        Ok(())
    }

    /// Constructs the parity shards incrementally using a single data shard.
    ///
    /// Must be called in order from `i_data = 0` to `data_shard_count - 1`.
    /// When `i_data == 0`, parity shards are overwritten. Otherwise, results
    /// are XOR-accumulated.
    pub fn encode_single<T: AsRef<[u8]> + AsMut<[u8]>>(
        &self,
        i_data: usize,
        shards: &mut [T],
    ) -> Result<(), Error> {
        if i_data >= self.data_shard_count {
            return Err(Error::InvalidIndex);
        }
        if shards.len() != self.total_shard_count {
            return Err(if shards.len() < self.total_shard_count {
                Error::TooFewShards
            } else {
                Error::TooManyShards
            });
        }
        Self::check_slices_uniform(shards)?;

        let (data_part, parity_part) = shards.split_at_mut(self.data_shard_count);
        let input = data_part[i_data].as_ref();
        let mut parity_refs: Vec<&mut [u8]> = parity_part.iter_mut().map(|s| s.as_mut()).collect();

        let parity_rows = self.get_parity_rows();
        self.code_single_slice(&parity_rows, i_data, input, &mut parity_refs);

        Ok(())
    }

    /// Constructs the parity shards incrementally using a single data shard (separated).
    pub fn encode_single_sep<U: AsRef<[u8]> + AsMut<[u8]>>(
        &self,
        i_data: usize,
        single_data: &[u8],
        parity: &mut [U],
    ) -> Result<(), Error> {
        if i_data >= self.data_shard_count {
            return Err(Error::InvalidIndex);
        }
        if parity.len() != self.parity_shard_count {
            return Err(if parity.len() < self.parity_shard_count {
                Error::TooFewParityShards
            } else {
                Error::TooManyParityShards
            });
        }
        if single_data.is_empty() {
            return Err(Error::EmptyShard);
        }
        for p in parity.iter() {
            if p.as_ref().len() != single_data.len() {
                return Err(Error::IncorrectShardSize);
            }
        }

        let mut parity_refs: Vec<&mut [u8]> = parity.iter_mut().map(|s| s.as_mut()).collect();
        let parity_rows = self.get_parity_rows();
        self.code_single_slice(&parity_rows, i_data, single_data, &mut parity_refs);

        Ok(())
    }

    /// Checks if the parity shards are correct.
    pub fn verify<T: AsRef<[u8]>>(&self, shards: &[T]) -> Result<bool, Error> {
        if shards.len() != self.total_shard_count {
            return Err(if shards.len() < self.total_shard_count {
                Error::TooFewShards
            } else {
                Error::TooManyShards
            });
        }
        Self::check_slices_uniform(shards)?;

        let slice_len = shards[0].as_ref().len();
        let mut buffer: Vec<Vec<u8>> = (0..self.parity_shard_count)
            .map(|_| vec![0u8; slice_len])
            .collect();

        let data = &shards[0..self.data_shard_count];
        let to_check = &shards[self.data_shard_count..];

        let data_refs: Vec<&[u8]> = data.iter().map(|s| s.as_ref()).collect();
        let mut buf_refs: Vec<&mut [u8]> = buffer.iter_mut().map(|s| s.as_mut_slice()).collect();

        let parity_rows = self.get_parity_rows();
        self.code_some_slices(&parity_rows, &data_refs, &mut buf_refs);

        for (computed, expected) in buffer.iter().zip(to_check.iter()) {
            if computed.as_slice() != expected.as_ref() {
                return Ok(false);
            }
        }

        Ok(true)
    }

    /// Reconstructs all missing shards.
    ///
    /// Shards that are `None` will be reconstructed. The number of present
    /// shards must be >= `data_shard_count`.
    pub fn reconstruct<T: ReconstructShard>(&self, shards: &mut [T]) -> Result<(), Error> {
        self.reconstruct_internal(shards, false)
    }

    /// Reconstructs only missing data shards.
    pub fn reconstruct_data<T: ReconstructShard>(&self, shards: &mut [T]) -> Result<(), Error> {
        self.reconstruct_internal(shards, true)
    }

    fn get_data_decode_matrix(
        &self,
        valid_indices: &[usize],
        invalid_indices: &[usize],
    ) -> Result<Matrix, Error> {
        {
            let cache = self
                .data_decode_matrix_cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(m) = cache.get(invalid_indices) {
                return Ok(m.clone());
            }
        }

        let mut sub_matrix = Matrix::new(self.data_shard_count, self.data_shard_count);
        for (sub_row, &valid_index) in valid_indices.iter().enumerate() {
            for c in 0..self.data_shard_count {
                sub_matrix.set(sub_row, c, self.matrix.get(valid_index, c));
            }
        }

        let data_decode_matrix = sub_matrix.invert().map_err(|_| Error::SingularMatrix)?;

        {
            let mut cache = self
                .data_decode_matrix_cache
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if cache.len() >= DATA_DECODE_MATRIX_CACHE_CAPACITY {
                // Simple eviction: clear the cache when full
                cache.clear();
            }
            cache.insert(invalid_indices.to_vec(), data_decode_matrix.clone());
        }

        Ok(data_decode_matrix)
    }

    fn reconstruct_internal<T: ReconstructShard>(
        &self,
        shards: &mut [T],
        data_only: bool,
    ) -> Result<(), Error> {
        if shards.len() != self.total_shard_count {
            return Err(if shards.len() < self.total_shard_count {
                Error::TooFewShards
            } else {
                Error::TooManyShards
            });
        }

        // Count present shards and find shard length
        let mut number_present = 0usize;
        let mut shard_len: Option<usize> = None;

        for shard in shards.iter() {
            if let Some(len) = shard.len() {
                if len == 0 {
                    return Err(Error::EmptyShard);
                }
                number_present += 1;
                if let Some(old_len) = shard_len {
                    if len != old_len {
                        return Err(Error::IncorrectShardSize);
                    }
                }
                shard_len = Some(len);
            }
        }

        if number_present == self.total_shard_count {
            return Ok(());
        }

        if number_present < self.data_shard_count {
            return Err(Error::TooFewShardsPresent);
        }

        let shard_len = shard_len.expect("at least one shard present");

        // Categorize shards
        let mut valid_indices: Vec<usize> = Vec::with_capacity(self.data_shard_count);
        let mut invalid_indices: Vec<usize> = Vec::with_capacity(self.parity_shard_count);

        for (i, shard) in shards.iter().enumerate() {
            if shard.len().is_some() {
                if valid_indices.len() < self.data_shard_count {
                    valid_indices.push(i);
                }
            } else {
                invalid_indices.push(i);
            }
        }

        // Initialize missing shards
        for &i in &invalid_indices {
            if i < self.data_shard_count || !data_only {
                shards[i].initialize(shard_len);
            }
        }

        let data_decode_matrix = self.get_data_decode_matrix(&valid_indices, &invalid_indices)?;

        // Reconstruct missing data shards.
        // We need to read from valid shards and write to invalid shards simultaneously.
        // Since the index sets are disjoint, we use raw pointers to avoid borrow conflicts.
        let missing_data_indices: Vec<usize> = invalid_indices
            .iter()
            .copied()
            .filter(|&i| i < self.data_shard_count)
            .collect();

        if !missing_data_indices.is_empty() {
            let matrix_rows: Vec<&[u8]> = missing_data_indices
                .iter()
                .map(|&i| data_decode_matrix.get_row(i))
                .collect();

            // For each data shard input, encode into each missing data output
            for (i_input, &valid_idx) in valid_indices.iter().enumerate() {
                // SAFETY: valid_idx and missing indices are disjoint sets,
                // so we can safely read from valid_idx while writing to missing indices.
                let input_ptr = shards[valid_idx].get().unwrap().as_ptr();
                let input_slice = unsafe { std::slice::from_raw_parts(input_ptr, shard_len) };

                for (i_out, &missing_idx) in missing_data_indices.iter().enumerate() {
                    let c = matrix_rows[i_out][i_input];
                    let output = shards[missing_idx].get_mut().unwrap();
                    if i_input == 0 {
                        self.mul_slice(c, input_slice, output);
                    } else {
                        self.mul_slice_xor(c, input_slice, output);
                    }
                }
            }
        }

        if data_only {
            return Ok(());
        }

        // Reconstruct missing parity shards from all data shards
        let missing_parity_indices: Vec<usize> = invalid_indices
            .iter()
            .copied()
            .filter(|&i| i >= self.data_shard_count)
            .collect();

        if !missing_parity_indices.is_empty() {
            let parity_rows = self.get_parity_rows();
            let matrix_rows: Vec<&[u8]> = missing_parity_indices
                .iter()
                .map(|&i| parity_rows[i - self.data_shard_count])
                .collect();

            for i_input in 0..self.data_shard_count {
                // SAFETY: data shards (0..data_shard_count) are disjoint from parity shards.
                let input_ptr = shards[i_input].get().unwrap().as_ptr();
                let input_slice = unsafe { std::slice::from_raw_parts(input_ptr, shard_len) };

                for (i_out, &missing_idx) in missing_parity_indices.iter().enumerate() {
                    let c = matrix_rows[i_out][i_input];
                    let output = shards[missing_idx].get_mut().unwrap();
                    if i_input == 0 {
                        self.mul_slice(c, input_slice, output);
                    } else {
                        self.mul_slice_xor(c, input_slice, output);
                    }
                }
            }
        }

        Ok(())
    }

    fn check_slices_uniform<T: AsRef<[u8]>>(slices: &[T]) -> Result<(), Error> {
        if slices.is_empty() {
            return Ok(());
        }
        let size = slices[0].as_ref().len();
        if size == 0 {
            return Err(Error::EmptyShard);
        }
        for slice in slices.iter().skip(1) {
            if slice.as_ref().len() != size {
                return Err(Error::IncorrectShardSize);
            }
        }
        Ok(())
    }
}

/// A trait for types that can hold optional shard data for reconstruction.
///
/// # Safety
///
/// Implementations must guarantee that distinct indices in a `&mut [T]` slice
/// yield non-overlapping memory regions from `get()`/`get_mut()`. Specifically:
/// - `get()` on element `i` must not alias `get_mut()` on element `j` when `i != j`.
/// - The returned slices must remain valid and not be moved/reallocated while borrows are active.
///
/// This is required because `reconstruct_internal` uses raw pointers to read from
/// some shard indices while writing to others simultaneously.
pub unsafe trait ReconstructShard {
    /// Returns the length of the shard data, or `None` if absent.
    fn len(&self) -> Option<usize>;
    /// Returns `true` if the shard data is absent.
    fn is_empty(&self) -> bool {
        self.len().is_none()
    }
    /// Get an immutable reference to the shard data.
    fn get(&self) -> Option<&[u8]>;
    /// Get a mutable reference to the shard data.
    fn get_mut(&mut self) -> Option<&mut [u8]>;
    /// Initialize the shard data to the given length (zeroed).
    fn initialize(&mut self, len: usize);
}

// SAFETY: `Option<Vec<u8>>` stores each shard in its own heap allocation,
// so distinct indices in a slice always yield non-overlapping memory.
unsafe impl ReconstructShard for Option<Vec<u8>> {
    fn len(&self) -> Option<usize> {
        self.as_ref().map(|v| v.len())
    }

    fn get(&self) -> Option<&[u8]> {
        self.as_ref().map(|v| v.as_slice())
    }

    fn get_mut(&mut self) -> Option<&mut [u8]> {
        self.as_mut().map(|v| v.as_mut_slice())
    }

    fn initialize(&mut self, len: usize) {
        if self.is_none() {
            *self = Some(vec![0u8; len]);
        }
    }
}

/// Bookkeeper for shard-by-shard encoding.
///
/// Useful for streaming use cases where data shards arrive one at a time.
///
/// # Example
///
pub struct ShardByShard<'a> {
    codec: &'a ReedSolomon,
    cur_input: usize,
}

impl<'a> ShardByShard<'a> {
    pub fn new(codec: &'a ReedSolomon) -> Self {
        ShardByShard {
            codec,
            cur_input: 0,
        }
    }

    /// Checks if all data shards have been encoded.
    pub fn parity_ready(&self) -> bool {
        self.cur_input == self.codec.data_shard_count
    }

    /// Resets the bookkeeping state.
    ///
    /// Returns `SBSError::LeftoverShards` if shards were encoded but parity is not ready.
    pub fn reset(&mut self) -> Result<(), SBSError> {
        if self.cur_input > 0 && !self.parity_ready() {
            return Err(SBSError::LeftoverShards);
        }
        self.cur_input = 0;
        Ok(())
    }

    /// Resets unconditionally.
    pub fn reset_force(&mut self) {
        self.cur_input = 0;
    }

    /// Returns the current data shard index to be encoded.
    pub fn cur_input_index(&self) -> usize {
        self.cur_input
    }

    /// Encodes the current data shard into the parity shards.
    pub fn encode<T: AsRef<[u8]> + AsMut<[u8]>>(
        &mut self,
        shards: &mut [T],
    ) -> Result<(), SBSError> {
        if self.parity_ready() {
            return Err(SBSError::TooManyCalls);
        }
        self.codec
            .encode_single(self.cur_input, shards)
            .map_err(SBSError::RSError)?;
        self.cur_input += 1;
        Ok(())
    }

    /// Encodes the current data shard using separate data and parity references.
    pub fn encode_sep<U: AsRef<[u8]> + AsMut<[u8]>>(
        &mut self,
        data: &[&[u8]],
        parity: &mut [U],
    ) -> Result<(), SBSError> {
        if self.parity_ready() {
            return Err(SBSError::TooManyCalls);
        }
        if data.len() != self.codec.data_shard_count {
            return Err(SBSError::RSError(
                if data.len() < self.codec.data_shard_count {
                    Error::TooFewDataShards
                } else {
                    Error::TooManyDataShards
                },
            ));
        }
        self.codec
            .encode_single_sep(self.cur_input, data[self.cur_input], parity)
            .map_err(SBSError::RSError)?;
        self.cur_input += 1;
        Ok(())
    }
}

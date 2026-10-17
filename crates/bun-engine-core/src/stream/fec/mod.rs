// SPDX-License-Identifier: BSD-2-Clause
// Absorbed from fec-rs (https://github.com/hgaiser/fec-rs, revision 402f41f970bb8c3ef7c88639821032e3b6460f63),
// Copyright (c) 2026, Hans Gaiser. See crates/bun-engine-core/STREAM-PROVENANCE.md.
//! A pure Rust Reed-Solomon erasure coding library with runtime SIMD acceleration.
//!
//! # Features
//!
//! - **Pure Rust** — No C/C++ dependencies or FFI. Everything is implemented in safe Rust
//!   (with targeted `unsafe` for SIMD intrinsics).
//! - **Runtime SIMD detection** — Automatically uses the fastest available instruction set
//!   via `std::is_x86_feature_detected!`. A single binary works on all x86_64 systems.
//! - **GF(2^8)** — Operates over the Galois field GF(2^8) with generating polynomial 29 (0x1D),
//!   compatible with the Moonlight streaming protocol.
//! - **Shard-by-shard encoding** — Incremental encoding via `ShardByShard` for streaming use cases.
//! - **Reconstruction** — Reconstruct missing data and/or parity shards from any sufficient subset.
//!
//! # SIMD Acceleration
//!
//! On x86_64, the library automatically detects CPU features at runtime and uses
//! the best available instruction set:
//!
//! - **GFNI + AVX2** — Single-instruction GF multiply on 32 bytes (Intel Alder Lake+, AMD Zen 4+)
//! - **AVX2** — VPSHUFB split-table nibble lookup on 32 bytes
//! - **GFNI + SSE** — Single-instruction GF multiply on 16 bytes
//! - **SSSE3** — VPSHUFB split-table nibble lookup on 16 bytes
//! - **Scalar** — Lookup table fallback
//!
#![allow(dead_code)]

mod errors;
pub mod galois;
mod matrix;
mod reed_solomon;

pub use errors::Error;
pub use reed_solomon::{ReconstructShard, ReedSolomon};

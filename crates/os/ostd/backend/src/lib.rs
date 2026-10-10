// SPDX-License-Identifier: Apache-2.0
pub mod base;
#[cfg(not(target_arch = "wasm32"))]
mod mirror;
pub mod stdio_capture;

#[cfg(not(target_arch = "wasm32"))]
pub use mirror::{Md3Mirror, cli_main};

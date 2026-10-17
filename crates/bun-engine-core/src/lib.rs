#![deny(unsafe_op_in_unsafe_fn)]
#![recursion_limit = "256"]
//! Bun Engine: every in-tree emulation core behind one [`machine::Machine`] trait, run by the Bevy
//! runtime ([`runtime`]: one App, window, input, audio, UI and render graph on wgpu 30). See
//! `BEVY.md`.

/// The Bevy this crate is built against; consumers use it to stay on the same version.
#[cfg(feature = "runtime")]
pub use ::bevy;

pub mod backend;
pub mod binary;
#[cfg(feature = "cartridge")]
pub mod cartridge;
pub mod ffi;
#[cfg(feature = "firmware")]
pub mod firmware;
#[cfg(feature = "host")]
pub mod host;
pub mod machine;
pub mod recomp;
#[cfg(feature = "runtime")]
pub mod runtime;
#[cfg(feature = "steam")]
pub mod steam;
#[cfg(feature = "stream")]
pub mod stream;
#[cfg(all(feature = "web", target_arch = "wasm32"))]
pub mod web;
#[cfg(feature = "runtime")]
pub mod window;

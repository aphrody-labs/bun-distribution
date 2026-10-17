//! Nintendo 3DS emulator frontend over [`aphrody_ctr_emu`].
//!
//! [`Layout`] places the 400x240 top and 320x240 bottom screens in a window and maps pointer
//! positions to touch coordinates. [`Renderer`] draws both screens through wgpu, with an optional
//! red/cyan anaglyph for titles that render stereo 3D. The `desktop` feature adds the winit and
//! cpal host (the `aphrody-ctr` binary); the `web` feature adds the WebGPU canvas host.

mod layout;
mod render;

#[cfg(feature = "desktop")]
pub mod audio;
#[cfg(all(feature = "web", target_arch = "wasm32"))]
pub mod web;

pub use aphrody_ctr_emu as emu;
pub use layout::{Layout, Rect};
pub use render::{Renderer, Stereo};

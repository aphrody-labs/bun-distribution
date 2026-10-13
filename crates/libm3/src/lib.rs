// SPDX-License-Identifier: Apache-2.0
//! Material 3 contracts independent of a window system, with an optional COSMIC renderer.
//! Material owns the native token engine. This crate adapts its values for application layouts
//! and COSMIC widgets; it does not maintain a separate color algorithm or token palette.
#![no_std]

#[cfg(any(feature = "cosmic", feature = "std"))]
extern crate std;

pub mod color;
pub mod component;
pub mod layout;
pub mod theme;
pub mod tokens;

#[cfg(feature = "cosmic")]
pub mod cosmic;

pub use color::{Color, ColorScheme, Role};
pub use component::{Component, ComponentStyle, Interaction};
pub use layout::{ApplicationFamily, ApplicationLayout, WindowClass};
pub use m3_tokens as tokens_owner;
pub use theme::{Density, Theme, ThemeMode};

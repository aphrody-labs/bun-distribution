// SPDX-License-Identifier: Apache-2.0
//! Entry points of the former `design`, `export_assets` and `pixel` binaries, now reached through
//! the `aphrody identity <design|export-assets|pixel>` subcommands of the multi-call binary.

mod design;
mod export_assets;
mod pixel;

pub use design::design_main;
pub use export_assets::export_assets_main;
pub use pixel::pixel_main;

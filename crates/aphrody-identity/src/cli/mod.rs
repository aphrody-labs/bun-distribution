// SPDX-License-Identifier: Apache-2.0
//! Entry points of the `aphrody identity <charger|design|export-assets|pet|pixel|terminal-theme>`
//! subcommands of the multi-call binary (`design`, `export_assets` and `pixel` were standalone
//! binaries before).

mod charger;
mod design;
mod export_assets;
mod pet;
mod pixel;
mod terminal_theme;

pub use charger::charger_main;
pub use design::design_main;
pub use export_assets::export_assets_main;
pub use pet::pet_main;
pub use pixel::pixel_main;
pub use terminal_theme::terminal_theme_main;

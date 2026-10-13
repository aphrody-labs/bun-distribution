// SPDX-License-Identifier: Apache-2.0
// Merged from the former `aphrody-icons` crate (its `svg` feature is now always on: this module
// lives in `aphrody-bun`, which is `std` and always used it). The FFI wrappers (`bun_rs_icon_*`)
// stay in `../icons_ffi.rs`, outside this module, so `unsafe` stays forbidden here.
#![forbid(unsafe_code)]
// The code predates the stricter crate-level `deny(clippy::all)` of `bun_rs`; keep its original
// (warn) level instead of turning every pre-existing style lint into a hard error.
#![warn(clippy::all)]

//! `bun_rs::icons` (package `aphrody-bun`; formerly the `aphrody-icons` crate): the Google
//! Material Symbols variable fonts (`Outlined`, `Rounded`, `Sharp`) embedded in the binary, so
//! native renderers and WASM targets need neither filesystem IO nor HTTP to draw an icon.
//!
//! The bytes come from `material-symbols@0.44.8`, pinned once in
//! `packages/m3-fonts/fonts.lock.json` and synced by Material's `packages/m3/scripts/fonts-sync.ts`; `build.rs`
//! verifies them before embedding. A build without them (see [`available`]) still compiles and
//! reports [`SvgError::FontsUnavailable`].

mod svg;
pub use svg::{Axes, Style, SvgError, icon_names, icon_path, icon_svg};

/// Whether this build embeds the Material Symbols fonts, CSS and name list.
pub const fn available() -> bool {
    cfg!(aphrody_symbols)
}

#[cfg(aphrody_symbols)]
mod embedded {
    macro_rules! symbols_file {
        ($include:ident, $name:literal) => {
            $include!(concat!(env!("APHRODY_SYMBOLS_DIR"), "/", $name))
        };
    }

    pub(super) const WOFF2_OUTLINED: &[u8] =
        symbols_file!(include_bytes, "material-symbols-outlined.woff2");
    pub(super) const WOFF2_ROUNDED: &[u8] =
        symbols_file!(include_bytes, "material-symbols-rounded.woff2");
    pub(super) const WOFF2_SHARP: &[u8] =
        symbols_file!(include_bytes, "material-symbols-sharp.woff2");
    pub(super) const CSS_OUTLINED: &str = symbols_file!(include_str, "outlined.css");
    pub(super) const CSS_ROUNDED: &str = symbols_file!(include_str, "rounded.css");
    pub(super) const CSS_SHARP: &str = symbols_file!(include_str, "sharp.css");
    /// `index.d.ts` of the package: the `MaterialSymbols` tuple of every icon name it ships.
    pub(super) const NAMES: &str = symbols_file!(include_str, "index.d.ts");
}

impl Style {
    /// WOFF2 bytes of this variable font, `None` when the build does not embed them.
    pub const fn woff2_data(self) -> Option<&'static [u8]> {
        #[cfg(aphrody_symbols)]
        {
            Some(match self {
                Self::Outlined => embedded::WOFF2_OUTLINED,
                Self::Rounded => embedded::WOFF2_ROUNDED,
                Self::Sharp => embedded::WOFF2_SHARP,
            })
        }
        #[cfg(not(aphrody_symbols))]
        {
            let _ = self;
            None
        }
    }

    /// The package's CSS for this style, `None` when the build does not embed it.
    pub const fn css(self) -> Option<&'static str> {
        #[cfg(aphrody_symbols)]
        {
            Some(match self {
                Self::Outlined => embedded::CSS_OUTLINED,
                Self::Rounded => embedded::CSS_ROUNDED,
                Self::Sharp => embedded::CSS_SHARP,
            })
        }
        #[cfg(not(aphrody_symbols))]
        {
            let _ = self;
            None
        }
    }

    /// The CSS `font-family` name of this style.
    pub const fn font_family(self) -> &'static str {
        match self {
            Self::Outlined => "Material Symbols Outlined",
            Self::Rounded => "Material Symbols Rounded",
            Self::Sharp => "Material Symbols Sharp",
        }
    }

    /// A `@font-face` rule and icon class with the WOFF2 font inlined as base64, `None` when
    /// the build does not embed the font.
    pub fn base64_css(self) -> Option<String> {
        use base64::prelude::*;
        let encoded = BASE64_STANDARD.encode(self.woff2_data()?);
        let family = self.font_family();
        Some(format!(
            "@font-face {{
              font-family: \"{family}\";
              font-style: normal;
              font-weight: 100 700;
              font-display: block;
              src: url(\"data:font/woff2;charset=utf-8;base64,{encoded}\") format(\"woff2\");
            }}
            .{class_name} {{
              font-family: \"{family}\";
              font-weight: normal;
              font-style: normal;
              font-size: 24px;
              line-height: 1;
              letter-spacing: normal;
              text-transform: none;
              display: inline-block;
              white-space: nowrap;
              word-wrap: normal;
              direction: ltr;
              -webkit-font-smoothing: antialiased;
              -moz-osx-font-smoothing: grayscale;
              text-rendering: optimizeLegibility;
              font-feature-settings: \"liga\";
            }}",
            class_name = family.to_lowercase().replace(' ', "-"),
        ))
    }
}

/// Every icon name of the embedded package, from its `index.d.ts` (empty without the fonts).
fn package_names() -> impl Iterator<Item = &'static str> {
    #[cfg(aphrody_symbols)]
    let source = embedded::NAMES;
    #[cfg(not(aphrody_symbols))]
    let source = "";
    source
        .lines()
        .filter_map(|line| line.trim().trim_end_matches(',').strip_prefix('"')?.strip_suffix('"'))
}

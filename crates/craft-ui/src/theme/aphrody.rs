// SPDX-License-Identifier: Apache-2.0
//! The egui adapter for the canonical M3 framework and Aphrody identity.
//!
//! Only application chrome belongs here. Document, media and diagnostic colors
//! remain owned by each editor. Schemes are cached rather than generated per frame.

use std::sync::OnceLock;

use aphrody_m3::theme::Theme;
use aphrody_m3_tokens::scheme::DynamicScheme;
pub use aphrody_m3_tokens::scheme::Role;
use egui::Color32;

pub struct Palette {
    scheme: DynamicScheme,
    colors: [(Role, Color32); Role::ALL.len()],
}

impl Palette {
    pub fn get(dark: bool, high_contrast: bool) -> &'static Self {
        static LIGHT: OnceLock<Palette> = OnceLock::new();
        static DARK: OnceLock<Palette> = OnceLock::new();
        static LIGHT_CONTRAST: OnceLock<Palette> = OnceLock::new();
        static DARK_CONTRAST: OnceLock<Palette> = OnceLock::new();
        let slot = match (dark, high_contrast) {
            (false, false) => &LIGHT,
            (true, false) => &DARK,
            (false, true) => &LIGHT_CONTRAST,
            (true, true) => &DARK_CONTRAST,
        };
        slot.get_or_init(|| {
            let request = Theme::aphrody_request();
            let request = if high_contrast {
                request.high_contrast()
            } else {
                request
            };
            let scheme = request.scheme(dark);
            let colors = std::array::from_fn(|index| {
                let role = Role::ALL[index];
                (role, color32(scheme.argb(role)))
            });
            Self { scheme, colors }
        })
    }

    pub fn color(&self, role: Role) -> Color32 {
        self.colors
            .iter()
            .find_map(|(candidate, color)| (*candidate == role).then_some(*color))
            .unwrap_or_else(|| color32(self.scheme.argb(role)))
    }
}

fn color32(argb: u32) -> Color32 {
    Color32::from_rgb((argb >> 16) as u8, (argb >> 8) as u8, argb as u8)
}

// SPDX-License-Identifier: Apache-2.0
//! Material Design 3 for native Tauri v2 apps.
//!
//! The plugin (`m3`) gives the webview the same M3 layer the Bun packages use, computed natively:
//!
//! - `plugin:m3|css`: any sheet of `aphrody_m3_tokens::sheets` (`tokens`, `tailwind`, `spaceui`,
//!   `scheme`), bit-identical to `m3Css()` of `@aphrody/bun` and to material-color-utilities;
//! - `plugin:m3|scheme`: the 49 role colours of a scheme as `{ role: "#rrggbb" }`;
//! - `plugin:m3|system_accent`: the OS accent colour, to seed dynamic colour from the desktop;
//! - `plugin:m3|sync_window`: paint the native window background with the scheme surface so resizes
//!   and first paint never flash a foreign colour.
//!
//! ```rust,ignore
//! tauri::Builder::default().plugin(aphrody_tauri_m3::init())
//! ```
//! and `"m3:default"` in the capability. `@aphrody/m3-theme/tauri` calls these commands.

pub mod accent;

use std::collections::BTreeMap;

use aphrody_m3_tokens::{
    color_math::hex_from_argb,
    scheme::{DynamicScheme, Role},
    sheets::{self, SheetRequest},
};
use serde::Deserialize;
use tauri::{
    Runtime, WebviewWindow,
    plugin::{Builder, TauriPlugin},
    window::Color,
};

/// Scheme parameters shared by the commands (all optional; default: tonal spot of `#6750A4`,
/// light, standard contrast). `seed: "system"` uses the OS accent colour.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemeArgs {
    /// `#rrggbb`, `#rgb` or `system`.
    pub seed: Option<String>,
    /// `tonal-spot`, `vibrant`, `expressive`, `neutral`, `monochrome`, `rainbow`, `fruit-salad`.
    pub variant: Option<String>,
    /// Dark scheme.
    pub dark: Option<bool>,
    /// Contrast level, -1..=1.
    pub contrast: Option<f64>,
}

impl SchemeArgs {
    fn request(&self, sheet: &str) -> Result<SheetRequest, String> {
        let system = self.seed.as_deref() == Some("system");
        let accent = system.then(accent::system_accent).flatten().map(hex_from_argb);
        let seed = if system { accent.as_deref() } else { self.seed.as_deref() };
        SheetRequest::parse(sheet, seed, self.variant.as_deref(), self.dark, self.contrast)
    }

    fn scheme(&self) -> Result<DynamicScheme, String> {
        let request = self.request("scheme")?;
        Ok(DynamicScheme::from_argb(request.seed, request.variant, request.dark, request.contrast))
    }
}

/// Render an M3 sheet.
#[tauri::command]
fn css(sheet: String, args: Option<SchemeArgs>) -> Result<String, String> {
    Ok(sheets::render(&args.unwrap_or_default().request(&sheet)?))
}

/// The 49 system roles of a scheme.
#[tauri::command]
fn scheme(args: Option<SchemeArgs>) -> Result<BTreeMap<&'static str, String>, String> {
    let scheme = args.unwrap_or_default().scheme()?;
    Ok(scheme.roles().map(|(role, argb)| (role.name(), hex_from_argb(argb))).collect())
}

/// The OS accent colour as `#rrggbb`, when the OS exposes one.
#[tauri::command]
fn system_accent() -> Option<String> {
    accent::system_accent().map(hex_from_argb)
}

/// Paint the window background with the scheme `surface` and set the native theme.
#[tauri::command]
fn sync_window<R: Runtime>(
    window: WebviewWindow<R>,
    args: Option<SchemeArgs>,
) -> Result<String, String> {
    let args = args.unwrap_or_default();
    let dark = args.dark.unwrap_or(false);
    let surface = args.scheme()?.argb(Role::Surface);
    let [_, r, g, b] = surface.to_be_bytes();
    window.set_background_color(Some(Color(r, g, b, 255))).map_err(|e| e.to_string())?;
    window
        .set_theme(Some(if dark { tauri::Theme::Dark } else { tauri::Theme::Light }))
        .map_err(|e| e.to_string())?;
    Ok(hex_from_argb(surface))
}

/// The `m3` plugin.
#[must_use]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("m3")
        .invoke_handler(tauri::generate_handler![css, scheme, system_accent, sync_window])
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn css_command_renders_every_sheet() {
        for sheet in ["tokens", "tailwind", "spaceui", "scheme"] {
            assert!(css(sheet.into(), None).unwrap().contains("--"), "{sheet}");
        }
        assert!(css("nope".into(), None).is_err());
    }

    #[test]
    fn scheme_command_returns_49_roles() {
        let args =
            SchemeArgs { seed: Some("#1a73e8".into()), dark: Some(true), ..SchemeArgs::default() };
        let roles = scheme(Some(args)).unwrap();
        assert_eq!(roles.len(), 49);
        assert!(roles["primary"].starts_with('#'));
    }

    #[test]
    fn system_seed_falls_back_to_the_baseline() {
        // Without an OS accent the request keeps the default seed; with one it uses it.
        let args = SchemeArgs { seed: Some("system".into()), ..SchemeArgs::default() };
        let request = args.request("scheme").unwrap();
        match accent::system_accent() {
            Some(argb) => assert_eq!(request.seed, argb),
            None => assert_eq!(request.seed, sheets::BASELINE_SEED),
        }
    }
}

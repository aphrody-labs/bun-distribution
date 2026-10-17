//! Theme files (`bun-os-theme/1`) shared with the web: JSON, TOML or CSS custom properties, layered
//! over the baseline (`packages/bun-os-platform/themes/baseline.json`) and resolved with the
//! canonical M3 engine (`aphrody-m3-tokens`: dynamic scheme, token tables). The resolved
//! [`Tokens`] serialize to the same JSON as `resolveTheme` in `packages/bun-os-platform/src/theme`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use aphrody_m3_tokens::color_math::{argb_from_hex, hex_from_argb};
use aphrody_m3_tokens::role::Role;
use aphrody_m3_tokens::scheme::{DynamicScheme, Variant};
use aphrody_m3_tokens::theme::export_token_tables;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::paths::Paths;

pub const SCHEMA: &str = "bun-os-theme/1";
const EMBEDDED_BASELINE: &str =
    include_str!("../../../packages/bun-os-platform/themes/baseline.json");

/// A theme file; every field is optional and layers over the baseline.
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ThemeFile {
    pub schema: Option<String>,
    pub id: Option<String>,
    pub name: Option<String>,
    /// Fluent id of the display name (`platform-theme-baseline`).
    pub name_key: Option<String>,
    pub color: ColorSpec,
    #[serde(rename = "type")]
    pub typescale: TypeSpec,
    pub shape: BTreeMap<String, f32>,
    pub motion: MotionSpec,
    pub elevation: BTreeMap<String, f32>,
    pub state: BTreeMap<String, f32>,
    pub space: BTreeMap<String, f32>,
    pub icon: BTreeMap<String, f32>,
    pub high_contrast: HighContrastSpec,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ColorSpec {
    pub seed: Option<String>,
    pub variant: Option<String>,
    pub contrast: Option<f64>,
    /// `dark`, `light` or `system`.
    pub mode: Option<String>,
    /// `art`: re-seed from the focused game's art (DIRECTION.md); `none`: keep the seed.
    pub dynamic: Option<String>,
    /// Kebab-case M3 role overrides, applied to both modes (`primary`: `#ff6b35`).
    pub roles: BTreeMap<String, String>,
    pub light: BTreeMap<String, String>,
    pub dark: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TypeSpec {
    pub font: Option<String>,
    pub scale: Option<f32>,
    pub styles: BTreeMap<String, TypeOverride>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TypeOverride {
    pub size: Option<f32>,
    pub line_height: Option<f32>,
    pub weight: Option<u16>,
    pub tracking: Option<f32>,
    pub font: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct MotionSpec {
    pub durations: BTreeMap<String, f32>,
    pub easings: BTreeMap<String, [f32; 4]>,
    pub reduced: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HighContrastSpec {
    pub contrast: Option<f64>,
    pub roles: BTreeMap<String, String>,
}

fn merge_json(base: &mut Value, over: Value) {
    match (base, over) {
        (Value::Object(b), Value::Object(o)) => {
            for (k, v) in o {
                merge_json(b.entry(k).or_insert(Value::Null), v);
            }
        }
        (b, o) => *b = o,
    }
}

/// `--name: value;` pairs of a CSS theme (`:root { ... }`), mapped onto the file schema.
fn from_css(text: &str) -> Value {
    let mut file = serde_json::json!({});
    let mut set = |path: &[&str], value: Value| {
        let mut node = &mut file;
        for (i, key) in path.iter().enumerate() {
            if i + 1 == path.len() {
                node[*key] = value.clone();
            } else {
                if node.get(*key).is_none() {
                    node[*key] = serde_json::json!({});
                }
                node = node.get_mut(*key).expect("inserted");
            }
        }
    };
    let num = |v: &str| {
        v.trim_end_matches("px")
            .trim_end_matches("ms")
            .trim()
            .parse::<f64>()
            .ok()
    };
    for decl in text.split(';') {
        let Some((name, value)) = decl.split_once(':') else {
            continue;
        };
        let name = name
            .trim()
            .rsplit(['{', '}', '\n'])
            .next()
            .unwrap_or("")
            .trim();
        let value = value.trim();
        let Some(var) = name.strip_prefix("--") else {
            continue;
        };
        if let Some(k) = var.strip_prefix("bun-os-theme-") {
            match k {
                "seed" | "variant" | "mode" | "dynamic" => set(&["color", k], value.into()),
                "contrast" => set(
                    &["color", "contrast"],
                    num(value).map_or(Value::Null, Into::into),
                ),
                "id" | "name" => set(&[k], value.trim_matches('"').into()),
                "font" => set(&["type", "font"], value.trim_matches('"').into()),
                "type-scale" => set(
                    &["type", "scale"],
                    num(value).map_or(Value::Null, Into::into),
                ),
                _ => {}
            }
        } else if let Some(role) = var.strip_prefix("md-sys-color-") {
            set(&["color", "roles", role], value.into());
        } else if let Some(n) = var.strip_prefix("md-sys-shape-corner-") {
            if let Some(v) = num(value) {
                set(&["shape", n], v.into());
            }
        } else if let Some(n) = var.strip_prefix("md-sys-motion-duration-") {
            if let Some(v) = num(value) {
                set(&["motion", "durations", n], v.into());
            }
        } else if let Some(n) = var.strip_prefix("md-sys-motion-easing-") {
            let inner = value
                .trim_start_matches("cubic-bezier(")
                .trim_end_matches(')');
            let p: Vec<Value> = inner
                .split(',')
                .filter_map(|x| x.trim().parse::<f64>().ok())
                .map(Into::into)
                .collect();
            if p.len() == 4 {
                set(&["motion", "easings", n], Value::Array(p));
            }
        } else if let Some(n) = var.strip_prefix("md-sys-state-") {
            if let (Some(n), Some(v)) = (n.strip_suffix("-state-layer-opacity"), num(value)) {
                set(&["state", n], v.into());
            }
        } else if let Some(rest) = var.strip_prefix("md-sys-typescale-") {
            for (suffix, key) in [
                ("-size", "size"),
                ("-line-height", "lineHeight"),
                ("-weight", "weight"),
                ("-tracking", "tracking"),
            ] {
                if let (Some(style), Some(v)) = (rest.strip_suffix(suffix), num(value)) {
                    set(&["type", "styles", style, key], v.into());
                }
            }
        } else if let Some(n) = var.strip_prefix("bun-os-space-") {
            if let Some(v) = num(value) {
                set(&["space", n], v.into());
            }
        } else if let Some(n) = var.strip_prefix("bun-os-icon-")
            && let Some(v) = num(value)
        {
            set(&["icon", n], v.into());
        }
    }
    file
}

/// Parses a theme file by extension (`.json`, `.toml`, `.css`).
pub fn parse(path: &Path, text: &str) -> Result<Value, String> {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("json") {
        "toml" => toml::from_str::<Value>(text).map_err(|e| format!("{}: {e}", path.display())),
        "css" => Ok(from_css(text)),
        _ => serde_json::from_str(text).map_err(|e| format!("{}: {e}", path.display())),
    }
}

/// Finds a theme by id or path in the theme directories.
pub fn find(paths: &Paths, id_or_path: &str) -> Option<PathBuf> {
    let direct = PathBuf::from(id_or_path);
    if direct.is_file() {
        return Some(direct);
    }
    for dir in paths.theme_dirs() {
        for ext in ["json", "toml", "css"] {
            let p = dir.join(format!("{id_or_path}.{ext}"));
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// The baseline layered with `theme` (an id or a path); `None` is the baseline itself.
pub fn load(paths: &Paths, theme: Option<&str>) -> Result<ThemeFile, String> {
    let base_text = std::fs::read_to_string(paths.package.join("themes").join("baseline.json"))
        .unwrap_or_else(|_| EMBEDDED_BASELINE.to_string());
    let mut value: Value = serde_json::from_str(&base_text).map_err(|e| e.to_string())?;
    if let Some(theme) = theme.filter(|t| *t != "baseline") {
        let path = find(paths, theme).ok_or_else(|| format!("theme {theme} not found"))?;
        let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        merge_json(&mut value, parse(&path, &text)?);
    }
    serde_json::from_value(value).map_err(|e| e.to_string())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeToken {
    pub font: String,
    pub size: f32,
    pub line_height: f32,
    pub weight: u16,
    pub tracking: f32,
}

/// Resolved tokens for one mode: every value a UI may use, nothing else.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tokens {
    pub schema: &'static str,
    pub id: String,
    pub seed: String,
    pub variant: String,
    pub contrast: f64,
    pub dark: bool,
    pub high_contrast: bool,
    pub dynamic_art: bool,
    /// Role -> `#rrggbb`.
    pub color: BTreeMap<String, String>,
    pub typescale: BTreeMap<String, TypeToken>,
    pub shape: BTreeMap<String, f32>,
    pub duration: BTreeMap<String, f32>,
    pub easing: BTreeMap<String, [f32; 4]>,
    pub elevation: BTreeMap<String, f32>,
    pub state: BTreeMap<String, f32>,
    pub space: BTreeMap<String, f32>,
    pub icon: BTreeMap<String, f32>,
    pub reduced_motion: bool,
    #[serde(skip)]
    argb: BTreeMap<String, u32>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ResolveOptions {
    /// Overrides the file mode (`system` resolves to dark on a TV shell).
    pub dark: Option<bool>,
    /// OS high contrast / forced colors.
    pub high_contrast: bool,
    /// Dynamic color seed (focused art), `0xAARRGGBB`.
    pub seed: Option<u32>,
    pub reduced_motion: bool,
}

/// Two decimals, the precision both resolvers emit.
fn round2(v: f32) -> f32 {
    (v * 100.0).round() / 100.0
}

fn parse_hex(hex: &str) -> Option<u32> {
    argb_from_hex(hex.trim()).map(|v| v | 0xFF00_0000)
}

impl Tokens {
    pub fn resolve(file: &ThemeFile, opts: ResolveOptions) -> Self {
        let seed = opts
            .seed
            .or_else(|| file.color.seed.as_deref().and_then(parse_hex))
            .unwrap_or(0xFF67_50A4)
            | 0xFF00_0000;
        let variant = file
            .color
            .variant
            .as_deref()
            .and_then(Variant::from_name)
            .unwrap_or(Variant::TonalSpot);
        let mut contrast = file.color.contrast.unwrap_or(0.0).clamp(-1.0, 1.0);
        if opts.high_contrast {
            contrast = file.high_contrast.contrast.unwrap_or(1.0).clamp(-1.0, 1.0);
        }
        let dark = opts
            .dark
            .unwrap_or(file.color.mode.as_deref() != Some("light"));
        let scheme = DynamicScheme::from_argb(seed, variant, dark, contrast);
        let mut argb: BTreeMap<String, u32> = Role::ALL
            .iter()
            .map(|r| (r.name().to_string(), scheme.argb(*r)))
            .collect();
        let mode_roles = if dark {
            &file.color.dark
        } else {
            &file.color.light
        };
        for (role, hex) in file.color.roles.iter().chain(mode_roles) {
            if let Some(v) = parse_hex(hex) {
                argb.insert(role.clone(), v);
            }
        }
        if opts.high_contrast {
            for (role, hex) in &file.high_contrast.roles {
                if let Some(v) = parse_hex(hex) {
                    argb.insert(role.clone(), v);
                }
            }
        }
        let color = argb
            .iter()
            .map(|(k, v)| (k.clone(), hex_from_argb(*v)))
            .collect();

        let tables = export_token_tables();
        let scale = file.typescale.scale.unwrap_or(1.0);
        let typescale = tables
            .typography
            .iter()
            .map(|s| {
                let o = file
                    .typescale
                    .styles
                    .get(s.name)
                    .cloned()
                    .unwrap_or_default();
                let font = o
                    .font
                    .or_else(|| file.typescale.font.clone())
                    .unwrap_or_else(|| s.font.to_string());
                (
                    s.name.to_string(),
                    TypeToken {
                        font,
                        size: round2(o.size.unwrap_or(s.size_dp) * scale),
                        line_height: round2(o.line_height.unwrap_or(s.line_height_dp) * scale),
                        weight: o.weight.unwrap_or(s.weight),
                        tracking: o.tracking.unwrap_or(s.letter_spacing_dp),
                    },
                )
            })
            .collect();
        let mut shape: BTreeMap<String, f32> = tables
            .shape
            .iter()
            .map(|s| (s.name.to_string(), f32::from(s.dp)))
            .collect();
        shape.extend(file.shape.clone());
        let mut duration: BTreeMap<String, f32> = tables
            .motion
            .durations
            .iter()
            .map(|d| (d.name.to_string(), f32::from(d.ms)))
            .collect();
        duration.extend(file.motion.durations.clone());
        let reduced_motion = opts.reduced_motion || file.motion.reduced.unwrap_or(false);
        if reduced_motion {
            duration.values_mut().for_each(|d| *d = 0.0);
        }
        let mut easing: BTreeMap<String, [f32; 4]> = tables
            .motion
            .easings
            .iter()
            .filter_map(|e| {
                let p: Vec<f32> = e
                    .cubic_bezier
                    .trim_start_matches("cubic-bezier(")
                    .trim_end_matches(')')
                    .split(',')
                    .filter_map(|x| x.trim().parse().ok())
                    .collect();
                (p.len() == 4).then(|| (e.name.to_string(), [p[0], p[1], p[2], p[3]]))
            })
            .collect();
        easing.extend(file.motion.easings.clone());
        let mut elevation: BTreeMap<String, f32> = tables
            .elevation
            .iter()
            .map(|e| (format!("level{}", e.level), f32::from(e.dp)))
            .collect();
        elevation.extend(file.elevation.clone());
        let mut state: BTreeMap<String, f32> = aphrody_m3_tokens::state::NAMES
            .iter()
            .zip(aphrody_m3_tokens::state::ALL)
            .map(|(n, s)| ((*n).to_string(), s.opacity))
            .collect();
        state.extend(file.state.clone());

        Self {
            schema: SCHEMA,
            id: file.id.clone().unwrap_or_else(|| "baseline".into()),
            seed: hex_from_argb(seed),
            variant: variant.name().to_string(),
            contrast,
            dark,
            high_contrast: opts.high_contrast,
            dynamic_art: file.color.dynamic.as_deref() == Some("art"),
            color,
            typescale,
            shape,
            duration,
            easing,
            elevation,
            state,
            space: file.space.clone(),
            icon: file.icon.clone(),
            reduced_motion,
            argb,
        }
    }

    /// `0xAARRGGBB` of a role (kebab-case M3 name); magenta marks an unknown role.
    pub fn argb(&self, role: &str) -> u32 {
        self.argb.get(role).copied().unwrap_or(0xFFFF_00FF)
    }

    /// sRGB components 0..=255 of a role.
    pub fn rgba8(&self, role: &str) -> [u8; 4] {
        let v = self.argb(role);
        [(v >> 16) as u8, (v >> 8) as u8, v as u8, (v >> 24) as u8]
    }

    pub fn duration_secs(&self, name: &str) -> f32 {
        self.duration.get(name).copied().unwrap_or(0.0) / 1000.0
    }

    pub fn space(&self, name: &str) -> f32 {
        self.space.get(name).copied().unwrap_or(0.0)
    }

    pub fn shape(&self, name: &str) -> f32 {
        self.shape.get(name).copied().unwrap_or(0.0)
    }

    pub fn icon(&self, name: &str) -> f32 {
        self.icon.get(name).copied().unwrap_or(0.0)
    }

    pub fn easing(&self, name: &str) -> [f32; 4] {
        self.easing
            .get(name)
            .copied()
            .unwrap_or([0.0, 0.0, 1.0, 1.0])
    }
}

/// OS high contrast (Windows `SPI_GETHIGHCONTRAST`, `HCF_HIGHCONTRASTON`).
pub fn os_high_contrast() -> bool {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW};
        use windows::Win32::UI::WindowsAndMessaging::{
            SPI_GETHIGHCONTRAST, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS, SystemParametersInfoW,
        };
        let mut hc = HIGHCONTRASTW {
            cbSize: size_of::<HIGHCONTRASTW>() as u32,
            ..Default::default()
        };
        // SAFETY: `hc` is a correctly sized HIGHCONTRASTW the call fills in.
        let ok = unsafe {
            SystemParametersInfoW(
                SPI_GETHIGHCONTRAST,
                hc.cbSize,
                Some(std::ptr::from_mut(&mut hc).cast()),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            )
        };
        return ok.is_ok() && (hc.dwFlags & HCF_HIGHCONTRASTON) == HCF_HIGHCONTRASTON;
    }
    #[allow(unreachable_code)]
    std::env::var("BUN_OS_HIGH_CONTRAST").is_ok_and(|v| v == "1")
}

/// Settings + OS: the theme a native host should show now.
pub fn current(paths: &Paths, seed: Option<u32>, reduced_motion: bool) -> Result<Tokens, String> {
    let settings = crate::paths::Settings::read(paths);
    let theme = std::env::var("BUN_OS_THEME").ok().or(settings.theme);
    let file = load(paths, theme.as_deref())?;
    let high_contrast = match settings.contrast.as_deref() {
        Some("high") => true,
        Some("standard") => false,
        _ => os_high_contrast(),
    };
    Ok(Tokens::resolve(
        &file,
        ResolveOptions {
            dark: None,
            high_contrast,
            seed,
            reduced_motion,
        },
    ))
}

// SPDX-License-Identifier: Apache-2.0
//! Terminal themes generated from the Aphrody M3 scheme: Windows Terminal, Rio, Nushell and the
//! Bun Shell prompt read the same roles.
//!
//! The scheme is the product one ([`crate::design::pet_seed_hex`], Tonal Spot, standard
//! contrast), resolved by `aphrody-m3-tokens` for both modes. Nothing here picks a colour by hand:
//!
//! - the terminal chrome (background, text, cursor, selection) is a set of M3 roles;
//! - red is the `error` palette and magenta the `primary` palette;
//! - green, yellow, blue and cyan are conventional hues **harmonised** toward the seed (M3 custom
//!   colours, `blend::harmonize`, at most 15° of rotation) so the four stay recognisable;
//! - every accent is read at the tone of its M3 role (80 dark, 40 light); the bright variant is
//!   the next tone away from the background (90 dark, 30 light), so it gains contrast in both modes;
//! - black and white are neutral roles (`surface-container-highest`, `outline`,
//!   `on-surface-variant`, `on-surface`, `surface-container-lowest`).
//!
//! [`TerminalTheme::contrast_checks`] measures every pair a terminal actually draws (WCAG, on the
//! 8-bit sRGB values written to the files) and the tests hold each to its minimum.

use std::fmt::Write as _;

use aphrody_m3_tokens::{
    blend::harmonize,
    color_math::{hex_from_argb, lstar_from_argb},
    contrast::ratio_of_tones,
    hct::Hct,
    palette::{CorePalette, TonalPalette},
    scheme::{DynamicScheme, Role},
    theme::{SPEC_VERSION, ThemeRequest},
};

/// Windows Terminal scheme name of the dark mode. Other tools (the Windows Terminal fork) look it
/// up by this name: keep it stable.
pub const WT_SCHEME_DARK: &str = "Aphrody M3";
/// Windows Terminal scheme name of the light mode.
pub const WT_SCHEME_LIGHT: &str = "Aphrody M3 Light";
/// Rio theme file stem of the dark mode (`themes/<name>.toml`).
pub const RIO_THEME_DARK: &str = "aphrody-m3";
/// Rio theme file stem of the light mode.
pub const RIO_THEME_LIGHT: &str = "aphrody-m3-light";
/// Generated files, relative to `tools/config/host/windows/terminal/`.
pub const FILES: [&str; 5] = [
    "aphrody-m3.wt-scheme.json",
    "rio/themes/aphrody-m3.toml",
    "rio/themes/aphrody-m3-light.toml",
    "nushell/aphrody-m3-colors.nu",
    "aphrody-m3.prompt.json",
];
/// Directory of the versioned terminal configuration, relative to the repository root.
pub const CONFIG_DIR: &str = "tools/config/host/windows/terminal";

const GENERATED_BY: &str = "aphrody identity terminal-theme";

/// The sixteen ANSI slots, in SGR order: 30–37 then 90–97.
pub const ANSI_NAMES: [&str; 16] = [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "bright-black",
    "bright-red",
    "bright-green",
    "bright-yellow",
    "bright-blue",
    "bright-magenta",
    "bright-cyan",
    "bright-white",
];

/// Index of an ANSI slot in [`TerminalScheme::ansi`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub enum Ansi {
    Black = 0,
    Red,
    Green,
    Yellow,
    Blue,
    Magenta,
    Cyan,
    White,
    BrightBlack,
    BrightRed,
    BrightGreen,
    BrightYellow,
    BrightBlue,
    BrightMagenta,
    BrightCyan,
    BrightWhite,
}

/// Where one of the six chromatic ANSI hues comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HueSource {
    /// The scheme's own `error` palette.
    Error,
    /// The scheme's own `primary` palette.
    Primary,
    /// A conventional hue (ARGB), harmonised toward the seed like an M3 custom colour.
    Harmonized(u32),
}

/// The six chromatic hues, red to cyan.
///
/// The harmonised sources are the Material 2014 500 swatches of each hue — only their hue and a
/// chroma of at least 48 survive (`CorePalette::of`), the tone is the role's.
pub const HUES: [(&str, HueSource); 6] = [
    ("red", HueSource::Error),
    ("green", HueSource::Harmonized(0xFF4C_AF50)),
    ("yellow", HueSource::Harmonized(0xFFFF_C107)),
    ("blue", HueSource::Harmonized(0xFF21_96F3)),
    ("magenta", HueSource::Primary),
    ("cyan", HueSource::Harmonized(0xFF00_BCD4)),
];

/// Accent tones: the M3 role tone, then one step further from the background.
const fn accent_tones(dark: bool) -> (f64, f64) {
    if dark { (80.0, 90.0) } else { (40.0, 30.0) }
}

/// Black, bright black, white, bright white.
const fn neutral_roles(dark: bool) -> [Role; 4] {
    if dark {
        [Role::SurfaceContainerHighest, Role::Outline, Role::OnSurfaceVariant, Role::OnSurface]
    } else {
        [Role::OnSurface, Role::OnSurfaceVariant, Role::SurfaceContainerHighest, Role::SurfaceContainerLowest]
    }
}

/// A colour reference resolved per mode: an ANSI slot or an M3 role.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ink {
    /// One of the sixteen slots.
    Ansi(Ansi),
    /// An M3 system role.
    Role(Role),
}

/// One terminal scheme (one mode).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TerminalScheme {
    /// Dark mode.
    pub dark: bool,
    /// The resolved M3 scheme the colours come from.
    pub scheme: DynamicScheme,
    /// The sixteen ANSI colours, ARGB, in [`ANSI_NAMES`] order.
    pub ansi: [u32; 16],
}

impl TerminalScheme {
    /// Resolve one mode of `request`.
    #[must_use]
    pub fn new(request: ThemeRequest, dark: bool) -> Self {
        let scheme = request.scheme(dark);
        let (normal, bright) = accent_tones(dark);
        let mut ansi = [0u32; 16];
        for (i, (_, source)) in HUES.iter().enumerate() {
            let palette = hue_palette(&scheme, request.seed(), *source);
            ansi[i + 1] = palette.tone(normal);
            ansi[i + 9] = palette.tone(bright);
        }
        let [black, bright_black, white, bright_white] = neutral_roles(dark);
        ansi[Ansi::Black as usize] = scheme.argb(black);
        ansi[Ansi::BrightBlack as usize] = scheme.argb(bright_black);
        ansi[Ansi::White as usize] = scheme.argb(white);
        ansi[Ansi::BrightWhite as usize] = scheme.argb(bright_white);
        Self { dark, scheme, ansi }
    }

    /// ARGB of a role.
    #[must_use]
    pub fn role(&self, role: Role) -> u32 {
        self.scheme.argb(role)
    }

    /// ARGB of an [`Ink`].
    #[must_use]
    pub fn ink(&self, ink: Ink) -> u32 {
        match ink {
            Ink::Ansi(slot) => self.ansi[slot as usize],
            Ink::Role(role) => self.role(role),
        }
    }

    /// `surface`.
    #[must_use]
    pub fn background(&self) -> u32 {
        self.role(Role::Surface)
    }

    /// `on-surface`.
    #[must_use]
    pub fn foreground(&self) -> u32 {
        self.role(Role::OnSurface)
    }

    /// `primary`.
    #[must_use]
    pub fn cursor(&self) -> u32 {
        self.role(Role::Primary)
    }

    /// `primary-container`.
    #[must_use]
    pub fn selection_background(&self) -> u32 {
        self.role(Role::PrimaryContainer)
    }

    /// `on-primary-container`.
    #[must_use]
    pub fn selection_foreground(&self) -> u32 {
        self.role(Role::OnPrimaryContainer)
    }

    /// Windows Terminal scheme name.
    #[must_use]
    pub const fn wt_name(&self) -> &'static str {
        if self.dark { WT_SCHEME_DARK } else { WT_SCHEME_LIGHT }
    }

    /// Rio theme file stem.
    #[must_use]
    pub const fn rio_name(&self) -> &'static str {
        if self.dark { RIO_THEME_DARK } else { RIO_THEME_LIGHT }
    }

    fn mode(&self) -> &'static str {
        if self.dark { "dark" } else { "light" }
    }

    fn hex(&self, ink: Ink) -> String {
        hex_from_argb(self.ink(ink))
    }
}

fn hue_palette(scheme: &DynamicScheme, seed: u32, source: HueSource) -> TonalPalette {
    match source {
        HueSource::Error => scheme.palettes.error,
        HueSource::Primary => scheme.palettes.primary,
        HueSource::Harmonized(value) => CorePalette::of(harmonize(value, seed)).a1,
    }
}

/// The hue (HCT degrees) actually used for each of [`HUES`].
#[must_use]
pub fn hue_degrees(request: ThemeRequest) -> [f64; 6] {
    let scheme = request.scheme(true);
    HUES.map(|(_, source)| hue_palette(&scheme, request.seed(), source).hue)
}

/// A styled Nushell `color_config` entry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Paint {
    /// Foreground, or the terminal default.
    pub fg: Option<Ink>,
    /// Background.
    pub bg: Option<Ink>,
    /// Nushell attributes (`b` bold, `u` underline, `r` reverse, `n` normal).
    pub attr: Option<&'static str>,
}

const fn fg(ink: Ink) -> Paint {
    Paint { fg: Some(ink), bg: None, attr: None }
}
const fn bold(ink: Ink) -> Paint {
    Paint { fg: Some(ink), bg: None, attr: Some("b") }
}
const fn on(fg: Ink, bg: Ink) -> Paint {
    Paint { fg: Some(fg), bg: Some(bg), attr: None }
}
const fn attr(attr: &'static str) -> Paint {
    Paint { fg: None, bg: None, attr: Some(attr) }
}

use Ansi::{
    Blue, BrightBlack, BrightMagenta, BrightYellow, Cyan, Green, Magenta, Yellow,
};
const PRIMARY: Ink = Ink::Role(Role::Primary);
const SECONDARY: Ink = Ink::Role(Role::Secondary);
const TERTIARY: Ink = Ink::Role(Role::Tertiary);
const ON_SURFACE: Ink = Ink::Role(Role::OnSurface);
const ON_SURFACE_VARIANT: Ink = Ink::Role(Role::OnSurfaceVariant);
const fn ansi(slot: Ansi) -> Ink {
    Ink::Ansi(slot)
}

/// Nushell `$env.config.color_config`, every key of the 0.116 default theme.
///
/// Types follow the M3 accents (numbers `tertiary`, dates `primary`, structure `secondary`), the
/// syntax shapes follow the ANSI slots Nushell's own default uses, now drawn from the scheme.
pub const NUSHELL: [(&str, Paint); 68] = [
    ("separator", fg(ansi(BrightBlack))),
    ("leading_trailing_space_bg", attr("n")),
    ("header", bold(PRIMARY)),
    ("empty", fg(ansi(Blue))),
    ("bool", fg(ansi(Cyan))),
    ("int", fg(TERTIARY)),
    ("float", fg(TERTIARY)),
    ("filesize", fg(ansi(Cyan))),
    ("duration", fg(TERTIARY)),
    ("datetime", fg(PRIMARY)),
    ("range", fg(ON_SURFACE)),
    ("string", fg(ON_SURFACE)),
    ("nothing", fg(ansi(BrightBlack))),
    ("binary", fg(ansi(Magenta))),
    ("cell-path", fg(ON_SURFACE_VARIANT)),
    ("row_index", bold(SECONDARY)),
    ("record", fg(ON_SURFACE)),
    ("list", fg(ON_SURFACE)),
    ("block", fg(ON_SURFACE)),
    ("closure", bold(ansi(Green))),
    ("glob", bold(ansi(Cyan))),
    ("semver", bold(ansi(Cyan))),
    ("semver-range", bold(ansi(Cyan))),
    ("hints", fg(ansi(BrightBlack))),
    ("search_result", on(Ink::Role(Role::OnTertiaryContainer), Ink::Role(Role::TertiaryContainer))),
    ("selection", on(Ink::Role(Role::OnPrimaryContainer), Ink::Role(Role::PrimaryContainer))),
    ("selection_cursor", attr("n")),
    ("binary_null_char", fg(ansi(BrightBlack))),
    ("binary_printable", bold(ansi(Cyan))),
    ("binary_whitespace", bold(ansi(Green))),
    ("binary_ascii_other", bold(ansi(Magenta))),
    ("binary_non_ascii", bold(ansi(Yellow))),
    ("shape_binary", bold(ansi(Magenta))),
    ("shape_block", bold(ansi(Blue))),
    ("shape_bool", fg(ansi(Cyan))),
    ("shape_closure", bold(ansi(Green))),
    ("shape_custom", fg(ansi(Green))),
    ("shape_datetime", bold(ansi(Cyan))),
    ("shape_directory", fg(ansi(Cyan))),
    ("shape_external", fg(ansi(Cyan))),
    ("shape_externalarg", bold(ansi(Green))),
    ("shape_external_resolved", bold(ansi(BrightYellow))),
    ("shape_filepath", fg(ansi(Cyan))),
    ("shape_flag", bold(ansi(Blue))),
    ("shape_float", bold(TERTIARY)),
    (
        "shape_garbage",
        Paint {
            fg: Some(Ink::Role(Role::OnError)),
            bg: Some(Ink::Role(Role::Error)),
            attr: Some("b"),
        },
    ),
    ("shape_glob_interpolation", bold(ansi(Cyan))),
    ("shape_globpattern", bold(ansi(Cyan))),
    ("shape_int", bold(TERTIARY)),
    ("shape_internalcall", bold(PRIMARY)),
    ("shape_keyword", bold(ansi(Cyan))),
    ("shape_list", bold(SECONDARY)),
    ("shape_literal", fg(ansi(Blue))),
    ("shape_match_pattern", fg(ansi(Green))),
    ("shape_matching_brackets", attr("u")),
    ("shape_nothing", fg(ansi(Cyan))),
    ("shape_operator", fg(ansi(Yellow))),
    ("shape_pipe", bold(ansi(Magenta))),
    ("shape_range", bold(ansi(Yellow))),
    ("shape_raw_string", fg(ansi(BrightMagenta))),
    ("shape_record", bold(SECONDARY)),
    ("shape_redirection", bold(ansi(Magenta))),
    ("shape_signature", bold(ansi(Green))),
    ("shape_string", fg(ansi(Green))),
    ("shape_string_interpolation", bold(ansi(Cyan))),
    ("shape_table", bold(ansi(Blue))),
    ("shape_variable", fg(ansi(Magenta))),
    ("shape_vardecl", fg(ansi(Magenta))),
];

/// Bun Shell prompt elements and their ink.
pub const PROMPT: [(&str, Ink); 9] = [
    ("brand", PRIMARY),
    ("cwd", Ink::Ansi(Cyan)),
    ("git", TERTIARY),
    ("symbol", SECONDARY),
    ("success", Ink::Ansi(Green)),
    ("error", Ink::Role(Role::Error)),
    ("duration", Ink::Ansi(Yellow)),
    ("muted", Ink::Ansi(BrightBlack)),
    ("text", ON_SURFACE),
];

/// One measured foreground/background pair.
#[derive(Clone, Debug, PartialEq)]
pub struct ContrastCheck {
    /// `dark` or `light`.
    pub mode: &'static str,
    /// What is drawn (`wt.red`, `nushell.shape_string`, …).
    pub what: String,
    /// Foreground ARGB.
    pub fg: u32,
    /// Background ARGB.
    pub bg: u32,
    /// WCAG ratio of the 8-bit colours.
    pub ratio: f64,
    /// Required minimum: 4.5 for text, 3 for the cursor (non-text, WCAG 1.4.11).
    pub minimum: f64,
}

impl ContrastCheck {
    /// The pair meets its minimum.
    #[must_use]
    pub fn ok(&self) -> bool {
        self.ratio >= self.minimum
    }
}

/// WCAG contrast ratio of two opaque ARGB colours.
#[must_use]
pub fn contrast(a: u32, b: u32) -> f64 {
    ratio_of_tones(lstar_from_argb(a), lstar_from_argb(b))
}

/// Both modes of the terminal theme.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TerminalTheme {
    /// The validated request (seed, variant, contrast).
    pub request: ThemeRequest,
    /// Dark mode.
    pub dark: TerminalScheme,
    /// Light mode.
    pub light: TerminalScheme,
}

impl TerminalTheme {
    /// The product theme: [`crate::design::pet_seed_hex`], Tonal Spot, standard contrast.
    ///
    /// # Panics
    /// Never: the seed is a constant opaque `#rrggbb`.
    #[must_use]
    pub fn aphrody() -> Self {
        let request = ThemeRequest::parse(Some(crate::design::pet_seed_hex()), None, None)
            .expect("pet seed is an opaque hex colour");
        Self::from_request(request)
    }

    /// Both modes of any validated request.
    #[must_use]
    pub fn from_request(request: ThemeRequest) -> Self {
        Self {
            request,
            dark: TerminalScheme::new(request, true),
            light: TerminalScheme::new(request, false),
        }
    }

    /// Dark, then light.
    #[must_use]
    pub const fn modes(&self) -> [&TerminalScheme; 2] {
        [&self.dark, &self.light]
    }

    fn provenance(&self) -> String {
        format!(
            "seed {}, Material color spec {SPEC_VERSION}, variant {}, contrast {}",
            hex_from_argb(self.request.seed()),
            self.request.variant().name(),
            self.request.contrast_level()
        )
    }

    /// `aphrody-m3.wt-scheme.json`: both schemes, as Windows Terminal's `schemes` entries.
    #[must_use]
    pub fn windows_terminal_json(&self) -> String {
        let mut s = String::from("[\n");
        for (i, m) in self.modes().into_iter().enumerate() {
            if i > 0 {
                s.push_str(",\n");
            }
            s.push_str(&wt_scheme(m, "  "));
        }
        s.push_str("\n]\n");
        s
    }

    /// One Rio theme (`[colors]`), for `themes/<name>.toml`.
    #[must_use]
    pub fn rio_toml(&self, dark: bool) -> String {
        let m = if dark { &self.dark } else { &self.light };
        let mut s = format!(
            "# Aphrody M3 ({}) for Rio. Generated by `{GENERATED_BY}`, do not edit.\n# {}.\n\n[colors]\n",
            m.mode(),
            self.provenance()
        );
        let roles = [
            ("background", Ink::Role(Role::Surface)),
            ("foreground", Ink::Role(Role::OnSurface)),
            ("cursor", PRIMARY),
            ("vi-cursor", TERTIARY),
            ("selection-background", Ink::Role(Role::PrimaryContainer)),
            ("selection-foreground", Ink::Role(Role::OnPrimaryContainer)),
            ("tabs", Ink::Role(Role::SurfaceContainerHigh)),
            ("tabs-active", PRIMARY),
            ("split", Ink::Role(Role::OutlineVariant)),
            ("split-active", PRIMARY),
            ("search-match-background", Ink::Role(Role::SecondaryContainer)),
            ("search-match-foreground", Ink::Role(Role::OnSecondaryContainer)),
            ("search-focused-match-background", TERTIARY),
            ("search-focused-match-foreground", Ink::Role(Role::OnTertiary)),
            ("hint-background", Ink::Role(Role::TertiaryContainer)),
            ("hint-foreground", Ink::Role(Role::OnTertiaryContainer)),
        ];
        for (key, ink) in roles {
            let _ = writeln!(s, "{key} = \"{}\"", m.hex(ink));
        }
        for (i, name) in ANSI_NAMES.iter().enumerate() {
            let key = name.replace("bright-", "light-");
            let _ = writeln!(s, "{key} = \"{}\"", hex_from_argb(m.ansi[i]));
        }
        s
    }

    /// `nushell/aphrody-m3-colors.nu`: `color_config` for both modes, dark unless
    /// `APHRODY_THEME=light`.
    #[must_use]
    pub fn nushell(&self) -> String {
        let mut s = format!(
            "# Aphrody M3 colours for Nushell. Generated by `{GENERATED_BY}`, do not edit.\n\
             # {}.\n\
             # Loaded by scripts/tools/shell/setup.nu; APHRODY_THEME=light selects the light mode.\n",
            self.provenance()
        );
        for m in self.modes() {
            let _ = write!(s, "\nexport const {} = {{\n", m.mode());
            for (key, paint) in NUSHELL {
                let _ = writeln!(s, "  {}: {}", nu_key(key), nu_paint(m, paint));
            }
            s.push_str("}\n");
        }
        s.push_str(
            "\nexport-env {\n  \
             $env.config.color_config = if ($env.APHRODY_THEME? == \"light\") { $light } else { $dark }\n\
             }\n",
        );
        s
    }

    /// `aphrody-m3.prompt.json`: the Bun Shell prompt palette, truecolor hex plus the nearest
    /// xterm-256 index for terminals without 24-bit colour.
    #[must_use]
    pub fn prompt_json(&self) -> String {
        let mut s = format!(
            "{{\n  \"schemaVersion\": 1,\n  \"generator\": \"{GENERATED_BY}\",\n  \"seed\": \"{}\",\n  \"spec\": \"{SPEC_VERSION}\"",
            hex_from_argb(self.request.seed())
        );
        for m in self.modes() {
            let _ = write!(s, ",\n  \"{}\": {{\n", m.mode());
            let bg = m.background();
            let _ = write!(
                s,
                "    \"background\": {{ \"hex\": \"{}\", \"ansi256\": {} }}",
                hex_from_argb(bg),
                xterm256(bg)
            );
            for (name, ink) in PROMPT {
                let c = m.ink(ink);
                let _ = write!(
                    s,
                    ",\n    \"{name}\": {{ \"hex\": \"{}\", \"ansi256\": {} }}",
                    hex_from_argb(c),
                    xterm256(c)
                );
            }
            s.push_str("\n  }");
        }
        s.push_str("\n}\n");
        s
    }

    /// Every generated file, keyed by its path relative to [`CONFIG_DIR`], in [`FILES`] order.
    #[must_use]
    pub fn files(&self) -> [(&'static str, String); 5] {
        [
            (FILES[0], self.windows_terminal_json()),
            (FILES[1], self.rio_toml(true)),
            (FILES[2], self.rio_toml(false)),
            (FILES[3], self.nushell()),
            (FILES[4], self.prompt_json()),
        ]
    }

    /// Replace the `schemes` array of a Windows Terminal `settings.json` with both generated
    /// schemes, leaving every other byte of the file as it is.
    ///
    /// # Errors
    /// When the file has no top-level `"schemes": [ … ]`.
    pub fn splice_wt_settings(&self, settings: &str) -> Result<String, String> {
        let key = settings.find("\"schemes\"").ok_or("settings.json: no \"schemes\" key")?;
        let open = key
            + settings[key..].find('[').ok_or("settings.json: \"schemes\" is not an array")?;
        let close = matching_bracket(settings, open).ok_or("settings.json: unbalanced schemes")?;
        let line_start = settings[..key].rfind('\n').map_or(0, |i| i + 1);
        let indent = &settings[line_start..key];
        let inner = format!("{indent}  ");
        let mut array = String::from("[\n");
        for (i, m) in self.modes().into_iter().enumerate() {
            if i > 0 {
                array.push_str(",\n");
            }
            array.push_str(&wt_scheme(m, &inner));
        }
        let _ = write!(array, "\n{indent}]");
        Ok(format!("{}{array}{}", &settings[..open], &settings[close + 1..]))
    }

    /// Every pair the generated files draw, measured.
    #[must_use]
    pub fn contrast_checks(&self) -> Vec<ContrastCheck> {
        let mut out = Vec::new();
        for m in self.modes() {
            let mode = m.mode();
            let bg = m.background();
            let mut push = |what: String, fg: u32, bg: u32, minimum: f64| {
                out.push(ContrastCheck { mode, what, fg, bg, ratio: contrast(fg, bg), minimum });
            };
            push("foreground".into(), m.foreground(), bg, 4.5);
            push("cursor".into(), m.cursor(), bg, 3.0);
            push("selection".into(), m.foreground(), m.selection_background(), 4.5);
            push("selection-foreground".into(), m.selection_foreground(), m.selection_background(), 4.5);
            // Black is a background slot in dark mode and white one in light mode: drawn as text
            // they are meant to vanish, so they are not text pairs.
            for (i, name) in ANSI_NAMES.iter().enumerate() {
                let background_slot = if m.dark { i == Ansi::Black as usize } else {
                    i == Ansi::White as usize || i == Ansi::BrightWhite as usize
                };
                if !background_slot {
                    push(format!("ansi.{name}"), m.ansi[i], bg, 4.5);
                }
            }
            for (key, paint) in NUSHELL {
                if let Some(ink) = paint.fg {
                    let under = paint.bg.map_or(bg, |b| m.ink(b));
                    push(format!("nushell.{key}"), m.ink(ink), under, 4.5);
                }
            }
            for (name, ink) in PROMPT {
                push(format!("prompt.{name}"), m.ink(ink), bg, 4.5);
            }
            let rio = [
                ("rio.tabs-active", PRIMARY, Role::SurfaceContainerHigh),
                ("rio.search-match", Ink::Role(Role::OnSecondaryContainer), Role::SecondaryContainer),
                ("rio.search-focused-match", Ink::Role(Role::OnTertiary), Role::Tertiary),
                ("rio.hint", Ink::Role(Role::OnTertiaryContainer), Role::TertiaryContainer),
            ];
            for (what, ink, under) in rio {
                push(what.into(), m.ink(ink), m.role(under), 4.5);
            }
        }
        out
    }
}

fn wt_scheme(m: &TerminalScheme, indent: &str) -> String {
    const WT_KEYS: [&str; 16] = [
        "black",
        "red",
        "green",
        "yellow",
        "blue",
        "purple",
        "cyan",
        "white",
        "brightBlack",
        "brightRed",
        "brightGreen",
        "brightYellow",
        "brightBlue",
        "brightPurple",
        "brightCyan",
        "brightWhite",
    ];
    let mut fields = vec![
        ("name", m.wt_name().to_owned()),
        ("background", hex_from_argb(m.background())),
        ("foreground", hex_from_argb(m.foreground())),
        ("cursorColor", hex_from_argb(m.cursor())),
        ("selectionBackground", hex_from_argb(m.selection_background())),
    ];
    fields.extend(WT_KEYS.iter().zip(m.ansi).map(|(k, c)| (*k, hex_from_argb(c))));
    let mut s = format!("{indent}{{\n");
    for (i, (k, v)) in fields.iter().enumerate() {
        let comma = if i + 1 < fields.len() { "," } else { "" };
        let _ = writeln!(s, "{indent}  \"{k}\": \"{v}\"{comma}");
    }
    let _ = write!(s, "{indent}}}");
    s
}

fn matching_bracket(text: &str, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (i, c) in text[open..].char_indices() {
        if in_string {
            match (escaped, c) {
                (true, _) => escaped = false,
                (false, '\\') => escaped = true,
                (false, '"') => in_string = false,
                _ => {},
            }
            continue;
        }
        match c {
            '"' => in_string = true,
            '[' | '{' => depth += 1,
            ']' | '}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(open + i);
                }
            },
            _ => {},
        }
    }
    None
}

fn nu_key(key: &str) -> String {
    if key.contains('-') { format!("\"{key}\"") } else { key.to_owned() }
}

fn nu_paint(m: &TerminalScheme, paint: Paint) -> String {
    match paint {
        Paint { fg: Some(ink), bg: None, attr: None } => format!("\"{}\"", m.hex(ink)),
        Paint { fg, bg, attr } => {
            let mut parts = Vec::new();
            if let Some(ink) = fg {
                parts.push(format!("fg: \"{}\"", m.hex(ink)));
            }
            if let Some(ink) = bg {
                parts.push(format!("bg: \"{}\"", m.hex(ink)));
            }
            if let Some(a) = attr {
                parts.push(format!("attr: \"{a}\""));
            }
            format!("{{ {} }}", parts.join(", "))
        },
    }
}

/// Nearest xterm-256 index (6×6×6 cube or grey ramp), by squared sRGB distance.
#[must_use]
pub fn xterm256(argb: u32) -> u8 {
    const LEVELS: [u32; 6] = [0, 95, 135, 175, 215, 255];
    let [r, g, b] = [(argb >> 16) & 0xFF, (argb >> 8) & 0xFF, argb & 0xFF];
    let nearest = |v: u32| {
        (0..6u8).min_by_key(|&i| LEVELS[usize::from(i)].abs_diff(v)).unwrap_or(0)
    };
    let dist = |c: [u32; 3]| {
        let d = |a: u32, b: u32| {
            let x = a.abs_diff(b);
            x * x
        };
        d(c[0], r) + d(c[1], g) + d(c[2], b)
    };
    let (ri, gi, bi) = (nearest(r), nearest(g), nearest(b));
    let cube = [LEVELS[usize::from(ri)], LEVELS[usize::from(gi)], LEVELS[usize::from(bi)]];
    let cube_index = 16 + 36 * ri + 6 * gi + bi;
    let grey_step = ((r + g + b) / 3).saturating_sub(3) / 10;
    let grey_step = u8::try_from(grey_step.min(23)).unwrap_or(23);
    let grey = 8 + 10 * u32::from(grey_step);
    if dist([grey, grey, grey]) < dist(cube) { 232 + grey_step } else { cube_index }
}

/// HCT of a colour, for reports.
#[must_use]
pub fn hct(argb: u32) -> Hct {
    Hct::from_argb(argb)
}

//! Aphrody M3 semantic chrome for ArtCraft; document and media colors remain independent.

use std::sync::Arc;

use egui::epaint::text::VariationCoords;
use egui::{
    Color32, CornerRadius, FontData, FontDefinitions, FontFamily, FontId, FontTweak, Stroke,
    TextStyle, Visuals,
};

/// `ui-background`: the page behind the feed.
pub fn bg() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::Surface)
}
/// `ui-panel`: the top bar, modals and the lightbox.
pub fn panel() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::SurfaceContainer)
}
/// `ui-controls`: the sidebar, the prompt box and toolbar buttons.
pub fn controls() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::SurfaceContainerHigh)
}
/// The window chrome behind the content panel: the title bar and the sidebar.
pub fn chrome() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::SurfaceContainerLow)
}
/// `ui-sunken`: wells and inputs.
pub fn sunken() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::SurfaceContainerLowest)
}

/// `base-fg`: body text.
pub fn ink() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::OnSurface)
}
pub fn ink_strong() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::OnSurface)
}
/// `base-fg/60`: secondary text and placeholders.
pub fn muted() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::OnSurfaceVariant)
}
/// `base-fg/50`: idle toolbar icons.
pub fn dim() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::OnSurfaceVariant)
}
/// `base-fg/40`: counters and captions.
pub fn faint() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::OnSurfaceVariant)
}
/// The sidebar's link colour (`white/72`).
pub fn sidebar_ink() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::OnSurfaceVariant)
}

/// `white/15`: every hairline.
pub fn line() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::OutlineVariant)
}
/// `white/25`: dashed drop targets.
pub fn line_dashed() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::Outline)
}
/// `base-fg/40`: outlined buttons and corner marks.
pub fn line_strong() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::Outline)
}
/// `white/5`: quiet fills.
pub fn wash() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::SurfaceContainerHigh)
}
/// `white/8`: the selected sidebar row.
pub fn wash_selected() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::SecondaryContainer)
}
/// `white/10`: hovered menu rows.
pub fn wash_hover() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::SurfaceContainerHighest)
}

/// The brand blue (`primary`).
pub fn accent() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::Primary)
}
/// `primary-400`: progress bars and selection rings.
pub fn accent_400() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::Primary)
}
/// `ui-accent-ink`: blue text and focus rings.
pub fn accent_ink() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::Primary)
}

/// The inverted primary button (white block, near-black text).
pub fn invert_bg() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::Primary)
}
pub fn invert_fg() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::OnPrimary)
}

/// `red-400`: failure text.
pub fn bad() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false).color(craft_ui::theme::aphrody::Role::Error)
}
/// `red`: destructive fills.
pub fn danger() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false).color(craft_ui::theme::aphrody::Role::Error)
}
/// The "BETA" / "NEW" sidebar badges.
pub fn badge_beta() -> Color32 {
    craft_ui::theme::aphrody::Palette::get(true, false)
        .color(craft_ui::theme::aphrody::Role::Tertiary)
}

/// M3 small corner for buttons, inputs and the prompt box.
pub const RADIUS: CornerRadius = craft_ui::theme::shape::CONTROL;

/// Height of toolbar buttons (`py-1.5` + 14 px text + hairline).
pub const CONTROL_H: f32 = 34.0;
/// The `.hud-label`: 11 px Geist Mono, upper case, 0.15 em apart.
pub const HUD_SIZE: f32 = 11.0;
pub const HUD_SPACING: f32 = HUD_SIZE * 0.15;
/// Section labels and mono buttons are tracked a little tighter (0.12 em).
pub const LABEL_SPACING: f32 = HUD_SIZE * 0.12;

pub fn hairline() -> Stroke {
    Stroke::new(1.0, line())
}

/// `c` at `a` (0–1) of its opacity.
pub fn fade(c: Color32, a: f32) -> Color32 {
    c.gamma_multiply(a.clamp(0.0, 1.0))
}

/// The shadow under menus, modals and toasts.
pub fn shadow() -> egui::epaint::Shadow {
    egui::epaint::Shadow {
        offset: [0, 8],
        blur: 24,
        spread: 0,
        color: Color32::from_black_alpha(140),
    }
}

/// Inter 500.
pub fn medium() -> FontFamily {
    FontFamily::Name("medium".into())
}

/// Inter 600.
pub fn semibold() -> FontFamily {
    FontFamily::Name("semibold".into())
}

/// Archivo 620 at 118 % width: `.font-display` headings.
pub fn display() -> FontFamily {
    FontFamily::Name("display".into())
}

/// Geist Mono 500: HUD labels.
pub fn mono() -> FontFamily {
    FontFamily::Name("mono".into())
}

/// Geist Mono 600–700: section labels and mono buttons.
pub fn mono_bold() -> FontFamily {
    FontFamily::Name("mono-bold".into())
}

fn visuals() -> Visuals {
    let mut v = Visuals::dark();
    v.panel_fill = bg();
    v.window_fill = panel();
    v.extreme_bg_color = sunken();
    v.text_edit_bg_color = Some(Color32::TRANSPARENT);
    v.faint_bg_color = controls();
    v.code_bg_color = sunken();
    v.window_stroke = hairline();
    v.window_corner_radius = craft_ui::theme::shape::WINDOW;
    v.menu_corner_radius = craft_ui::theme::shape::MENU;
    v.window_shadow = shadow();
    v.popup_shadow = shadow();
    v.override_text_color = Some(ink());
    v.hyperlink_color = accent_ink();
    v.selection.bg_fill = accent();
    v.selection.stroke = Stroke::new(1.0, Color32::WHITE);
    v.text_cursor.stroke = Stroke::new(1.5, Color32::WHITE);
    v.warn_fg_color = badge_beta();
    v.error_fg_color = bad();
    v.striped = false;
    for (w, fill, stroke, fg) in [
        (&mut v.widgets.noninteractive, controls(), line(), muted()),
        (&mut v.widgets.inactive, controls(), line(), ink()),
        (
            &mut v.widgets.hovered,
            wash_hover(),
            line_strong(),
            ink_strong(),
        ),
        (
            &mut v.widgets.active,
            wash_hover(),
            line_strong(),
            ink_strong(),
        ),
        (
            &mut v.widgets.open,
            wash_hover(),
            line_strong(),
            ink_strong(),
        ),
    ] {
        w.bg_fill = fill;
        w.weak_bg_fill = fill;
        w.bg_stroke = Stroke::new(1.0, stroke);
        w.corner_radius = RADIUS;
        w.fg_stroke = Stroke::new(1.0, fg);
        w.expansion = 0.0;
    }
    v
}

/// Installs the fonts, colours and spacing. The app is dark only, like the webapp.
pub fn apply(ctx: &egui::Context) {
    install_fonts(ctx);
    ctx.set_visuals_of(egui::Theme::Dark, visuals());
    ctx.set_theme(egui::ThemePreference::Dark);
    ctx.all_styles_mut(|style| {
        style.spacing.item_spacing = egui::vec2(8.0, 6.0);
        style.spacing.button_padding = egui::vec2(12.0, 6.0);
        style.spacing.interact_size.y = CONTROL_H;
        style.spacing.menu_margin = egui::Margin::same(4);
        style.spacing.window_margin = egui::Margin::same(16);
        style.spacing.scroll = egui::style::ScrollStyle {
            bar_width: 8.0,
            floating: true,
            ..egui::style::ScrollStyle::thin()
        };
        style.text_styles = [
            (TextStyle::Heading, FontId::new(24.0, display())),
            (TextStyle::Body, FontId::new(14.0, FontFamily::Proportional)),
            (TextStyle::Button, FontId::new(14.0, medium())),
            (
                TextStyle::Small,
                FontId::new(12.0, FontFamily::Proportional),
            ),
            (
                TextStyle::Monospace,
                FontId::new(13.0, FontFamily::Monospace),
            ),
        ]
        .into();
    });
}

/// A font registered under `name`: its file, its variation coordinates and its family.
type Face<'a> = (&'a str, &'static [u8], &'a [([u8; 4], f32)], FontFamily);

/// Registers the three variable fonts, each at the weights (and width) the webapp uses.
fn install_fonts(ctx: &egui::Context) {
    const INTER: &[u8] = include_bytes!("../assets/fonts/Inter-Variable.ttf");
    const ARCHIVO: &[u8] = include_bytes!("../assets/fonts/Archivo-Variable.ttf");
    const GEIST_MONO: &[u8] = include_bytes!("../assets/fonts/GeistMono-Variable.ttf");
    let mut fonts = FontDefinitions::default();
    // egui's own fonts stay behind ours, for symbols and emoji ours don't have.
    let fallback = fonts
        .families
        .get(&FontFamily::Proportional)
        .cloned()
        .unwrap_or_default();
    let faces: [Face<'_>; 7] = [
        (
            "Inter",
            INTER,
            &[(*b"wght", 400.0), (*b"opsz", 14.0)],
            FontFamily::Proportional,
        ),
        (
            "Inter-Medium",
            INTER,
            &[(*b"wght", 500.0), (*b"opsz", 14.0)],
            medium(),
        ),
        (
            "Inter-SemiBold",
            INTER,
            &[(*b"wght", 600.0), (*b"opsz", 14.0)],
            semibold(),
        ),
        (
            "Archivo-Display",
            ARCHIVO,
            &[(*b"wght", 620.0), (*b"wdth", 118.0)],
            display(),
        ),
        (
            "GeistMono",
            GEIST_MONO,
            &[(*b"wght", 400.0)],
            FontFamily::Monospace,
        ),
        ("GeistMono-Medium", GEIST_MONO, &[(*b"wght", 500.0)], mono()),
        (
            "GeistMono-SemiBold",
            GEIST_MONO,
            &[(*b"wght", 650.0)],
            mono_bold(),
        ),
    ];
    for (name, bytes, coords, family) in faces {
        let tweak = FontTweak {
            coords: VariationCoords::new(coords.iter().copied()),
            ..Default::default()
        };
        fonts.font_data.insert(
            name.to_owned(),
            Arc::new(FontData::from_static(bytes).tweak(tweak)),
        );
        let mut stack = vec![name.to_owned()];
        stack.extend(fallback.iter().cloned());
        fonts.families.insert(family, stack);
    }
    ctx.set_fonts(fonts);
}

// SPDX-License-Identifier: Apache-2.0
use crate::{
    Color, Role, Theme,
    tokens::{ShapeRole, TypeRole},
};

/// Renderers use this shared model rather than maintaining per-platform token tables.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Component {
    FilledButton,
    TonalButton,
    OutlinedButton,
    TextButton,
    DestructiveButton,
    FloatingActionButton,
    FilledCard,
    ElevatedCard,
    OutlinedCard,
    TextField,
    Checkbox,
    Radio,
    Switch,
    Slider,
    FilterChip,
    SuggestionChip,
    NavigationBar,
    NavigationRail,
    NavigationDrawer,
    TopAppBar,
    Toolbar,
    Tabs,
    ListItem,
    Dialog,
    BottomSheet,
    SideSheet,
    Snackbar,
    Tooltip,
    Progress,
    Divider,
    Badge,
    Menu,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum Interaction {
    #[default]
    Rest,
    Hovered,
    Focused,
    Pressed,
    Selected,
    Disabled,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ComponentStyle {
    pub background: Color,
    pub foreground: Color,
    pub border: Color,
    pub corner_radius: u16,
    pub elevation_dp: u16,
    pub min_height: u16,
    pub typography: TypeRole,
}

impl Component {
    pub fn style(self, theme: Theme, interaction: Interaction) -> ComponentStyle {
        use Component::*;
        let (background, foreground, shape, elevation, typography) = match self {
            FilledButton | FloatingActionButton => (
                Role::Primary,
                Role::OnPrimary,
                ShapeRole::Full,
                0,
                TypeRole::LabelLarge,
            ),
            TonalButton | FilterChip => (
                Role::SecondaryContainer,
                Role::OnSecondaryContainer,
                ShapeRole::Full,
                0,
                TypeRole::LabelLarge,
            ),
            DestructiveButton => (
                Role::Error,
                Role::OnError,
                ShapeRole::Full,
                0,
                TypeRole::LabelLarge,
            ),
            OutlinedButton | TextButton | SuggestionChip => (
                Role::Surface,
                Role::Primary,
                ShapeRole::Full,
                0,
                TypeRole::LabelLarge,
            ),
            ElevatedCard => (
                Role::SurfaceContainerLow,
                Role::OnSurface,
                ShapeRole::Medium,
                1,
                TypeRole::BodyLarge,
            ),
            FilledCard => (
                Role::SurfaceContainerHighest,
                Role::OnSurface,
                ShapeRole::Medium,
                0,
                TypeRole::BodyLarge,
            ),
            Dialog | BottomSheet => (
                Role::SurfaceContainerHigh,
                Role::OnSurface,
                ShapeRole::ExtraLarge,
                6,
                TypeRole::BodyLarge,
            ),
            Snackbar | Tooltip => (
                Role::InverseSurface,
                Role::InverseOnSurface,
                ShapeRole::ExtraSmall,
                3,
                TypeRole::BodyMedium,
            ),
            Badge => (
                Role::Error,
                Role::OnError,
                ShapeRole::Full,
                0,
                TypeRole::LabelSmall,
            ),
            TextField => (
                Role::SurfaceContainerHighest,
                Role::OnSurface,
                ShapeRole::ExtraSmall,
                0,
                TypeRole::BodyLarge,
            ),
            NavigationBar | NavigationRail | NavigationDrawer | SideSheet | Menu => (
                Role::SurfaceContainer,
                Role::OnSurface,
                ShapeRole::Large,
                0,
                TypeRole::LabelLarge,
            ),
            Checkbox | Radio | Switch | Slider | Progress => (
                Role::Primary,
                Role::OnPrimary,
                ShapeRole::Full,
                0,
                TypeRole::LabelLarge,
            ),
            _ => (
                Role::Surface,
                Role::OnSurface,
                ShapeRole::None,
                0,
                TypeRole::BodyLarge,
            ),
        };
        let border = if matches!(
            self,
            OutlinedButton | OutlinedCard | SuggestionChip | TextField | Divider
        ) {
            theme.colors.get(Role::Outline)
        } else {
            Color::TRANSPARENT
        };
        let mut style = ComponentStyle {
            background: theme.colors.get(background),
            foreground: theme.colors.get(foreground),
            border,
            corner_radius: theme.shapes.get(shape),
            elevation_dp: elevation,
            min_height: theme.density.target_height(),
            typography,
        };
        if matches!(
            self,
            TextButton | OutlinedButton | OutlinedCard | SuggestionChip | ListItem | Tabs | Divider
        ) {
            style.background = Color::TRANSPARENT;
        }
        match interaction {
            Interaction::Rest => {}
            Interaction::Hovered => {
                style.background = style
                    .background
                    .overlay(style.foreground, opacity(m3_tokens::state::HOVER.opacity))
            }
            Interaction::Focused | Interaction::Pressed => {
                let layer = if interaction == Interaction::Focused {
                    m3_tokens::state::FOCUS
                } else {
                    m3_tokens::state::PRESSED
                };
                style.background = style
                    .background
                    .overlay(style.foreground, opacity(layer.opacity))
            }
            Interaction::Selected => {
                style.background = theme.colors.get(Role::SecondaryContainer);
                style.foreground = theme.colors.get(Role::OnSecondaryContainer);
            }
            Interaction::Disabled => {
                if style.background != Color::TRANSPARENT {
                    style.background = Color::TRANSPARENT.overlay(
                        theme.colors.get(Role::OnSurface),
                        opacity(m3_tokens::state::DISABLED_CONTAINER.opacity),
                    );
                }
                style.foreground = Color::TRANSPARENT.overlay(
                    theme.colors.get(Role::OnSurface),
                    opacity(m3_tokens::state::DISABLED_CONTENT.opacity),
                );
                style.border = if style.border == Color::TRANSPARENT {
                    style.border
                } else {
                    style.foreground
                };
                style.elevation_dp = 0;
            }
            Interaction::Error => {
                style.border = theme.colors.get(Role::Error);
                style.foreground = theme.colors.get(Role::Error);
            }
        }
        style
    }
}

impl Component {
    /// Style of a component that can be selected (chips, tabs, switches, list rows) and is in
    /// `interaction` at the same time: the selected container with the interaction's state layer
    /// on top, as M3 composites them. `Disabled` and `Error` take precedence over selection.
    pub fn style_with(self, theme: Theme, selected: bool, interaction: Interaction) -> ComponentStyle {
        if !selected || matches!(interaction, Interaction::Disabled | Interaction::Error) {
            return self.style(theme, interaction);
        }
        let mut style = self.style(theme, Interaction::Selected);
        let layer = match interaction {
            Interaction::Hovered => Some(m3_tokens::state::HOVER),
            Interaction::Focused => Some(m3_tokens::state::FOCUS),
            Interaction::Pressed => Some(m3_tokens::state::PRESSED),
            _ => None,
        };
        if let Some(layer) = layer {
            style.background = style
                .background
                .overlay(style.foreground, opacity(layer.opacity));
        }
        style
    }
}

fn opacity(value: f32) -> u8 {
    (value * 255.0 + 0.5) as u8
}

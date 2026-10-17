//! Screens, laid out per design-system/bun-os-play/DIRECTION.md: the focused game's real art
//! full-bleed with the M3 scheme regenerated from it, the game title as display type, one rail of
//! capsules, quiet chrome. Library, Game hub, Downloads, Settings and the game view follow the
//! same tokens. Views are Bevy UI trees built on `OnEnter` and despawned on exit; live values go
//! through `Bind` text bindings, colors through `Tint`.

use bevy::ecs::hierarchy::ChildSpawnerCommands;
use bevy::prelude::*;
use bevy::ui::{BackgroundGradient, ColorStop, LinearGradient};

use crate::app::{
    Action, MotionPref, Overlay, ProfileField, QuickAction, Screen, SettingKey, Settings, Shell,
};
use crate::assets::{Art, ArtRef};
use crate::library::{Game, Kind, Source};
use crate::machine::Suspended;
use crate::runtime::Running;
use crate::text::{t, tf};
use crate::theme::{R, Theme, icon, shape, size, space, typescale as ts};
use crate::ui::{
    Cover, DefaultFocus, FocusFx, Focusable, Kit, Layer, Motion, Spring, a11y_button, bg, bg_alpha,
    radius, ring,
};

/// Text whose content follows shell state.
#[derive(Component, Clone, Copy, PartialEq)]
pub enum Bind {
    Clock,
    Gpu,
    HeroPlatform,
    HeroTitle,
    HeroMeta,
    Toast,
    Hud,
    Profile(ProfileField),
    Setting(SettingKey),
    QuickValue(QuickAction),
    NvidiaPanel,
    DisplayPanel,
    SessionPanel,
    HubState,
}

/// A slot that shows real artwork once the loader has it (hidden until then).
#[derive(Component)]
pub struct ArtSlot(pub ArtRef);

#[derive(Component)]
pub struct GameTile {
    pub game: usize,
    pub slot: usize,
}

/// The full-bleed hero picture: cross-fades with the scheme re-tint.
#[derive(Component, Default)]
pub struct HeroBg {
    pub shown: Option<String>,
}

/// Scrims whose gradient follows the scheme (text legibility over the art, not decoration).
#[derive(Component, Clone, Copy)]
pub enum Scrim {
    Hero,
    Hub,
}

#[derive(Component)]
pub struct PlayButton;

#[derive(Component)]
pub struct HubButton;

/// Marks the label text inside the hero Play button.
#[derive(Component)]
pub struct PlayLabelSlot;

#[derive(Component)]
pub struct RailTrack(pub Spring);

#[derive(Component)]
pub struct LibraryScroll(pub Spring);

#[derive(Component)]
pub struct ToastBox(pub Spring);

#[derive(Component)]
pub struct HudBox;

/// The controller indicator in the top bar (shown while a pad is connected).
#[derive(Component)]
pub struct PadIndicator;

#[derive(Component)]
pub struct MachineView;

/// Artwork for a game's hero: the suspend picture of a machine game (its real last frame) first,
/// then the Steam or libretro art.
pub fn hero_art(shell: &Shell, game: &Game) -> ArtRef {
    let thumb = Suspended::of(&shell.paths.states(), &game.key).thumb;
    if game.is_native() && thumb.is_file() {
        return ArtRef::file(thumb).then(game.hero.clone());
    }
    game.hero.clone()
}

fn root(screen: Screen) -> impl Bundle {
    (
        Node {
            width: percent(100),
            height: percent(100),
            position_type: PositionType::Absolute,
            ..default()
        },
        bg(R::SurfaceDim),
        DespawnOnExit(screen),
    )
}

fn focusable(action: Action, grow: f32, label: &str) -> impl Bundle {
    (
        Focusable(action),
        FocusFx::new(grow),
        UiTransform::IDENTITY,
        ring(),
        Layer::Screen,
        a11y_button(label),
    )
}

/// Filled (primary) or tonal button with a leading icon and a text label.
pub fn button(
    p: &mut ChildSpawnerCommands,
    kit: &Kit,
    glyph: &str,
    label: &str,
    filled: bool,
    action: Action,
    extra: impl Bundle,
) {
    let (container, content) = if filled {
        (R::Primary, R::OnPrimary)
    } else {
        (R::SecondaryContainer, R::OnSecondaryContainer)
    };
    p.spawn((
        Node {
            height: px(size::BUTTON_HEIGHT),
            padding: UiRect::horizontal(px(space::LG + space::XS)),
            column_gap: px(space::SM + space::XS),
            align_items: AlignItems::Center,
            border_radius: radius(shape::FULL),
            ..default()
        },
        bg(container),
        focusable(action, 0.04, label),
        extra,
    ))
    .with_children(|b| {
        b.spawn(kit.icon(glyph, icon::MD, content));
        b.spawn((kit.text(label, ts::TITLE_MEDIUM, content), PlayLabelSlot));
    });
}

fn icon_button(p: &mut ChildSpawnerCommands, kit: &Kit, glyph: &str, label: &str, action: Action) {
    p.spawn((
        Node {
            width: px(size::TARGET),
            height: px(size::TARGET),
            justify_content: JustifyContent::Center,
            align_items: AlignItems::Center,
            border_radius: radius(shape::FULL),
            ..default()
        },
        bg_alpha(R::ContainerHigh, 0.85),
        focusable(action, 0.06, label),
    ))
    .with_children(|b| {
        b.spawn(kit.icon(glyph, icon::MD, R::OnSurface));
    });
}

fn chip(p: &mut ChildSpawnerCommands, kit: &Kit, label: &str, selected: bool, action: Action) {
    let (container, content) = if selected {
        (R::SecondaryContainer, R::OnSecondaryContainer)
    } else {
        (R::ContainerHigh, R::OnSurfaceVariant)
    };
    p.spawn((
        Node {
            height: px(size::CHIP_HEIGHT),
            padding: UiRect::horizontal(px(space::MD + space::XS)),
            align_items: AlignItems::Center,
            border_radius: radius(shape::FULL),
            ..default()
        },
        bg_alpha(container, if selected { 1.0 } else { 0.7 }),
        focusable(action, 0.04, label),
    ))
    .with_children(|b| {
        b.spawn(kit.text(label, ts::LABEL, content));
    });
}

/// A rail or library capsule: real art when it exists, otherwise a typographic tile of the real
/// title and system name.
fn capsule(
    p: &mut ChildSpawnerCommands,
    kit: &Kit,
    shell: &Shell,
    index: usize,
    slot: usize,
    dims: (f32, f32),
    initial: bool,
) {
    let game = &shell.library.games[index];
    let mut entity = p.spawn((
        Node {
            width: px(dims.0),
            height: px(dims.1),
            flex_shrink: 0.0,
            overflow: Overflow::clip(),
            border_radius: radius(shape::MEDIUM),
            ..default()
        },
        bg(R::ContainerHigh),
        focusable(Action::Play(index), size::FOCUS_GROW, &game.title),
        GameTile { game: index, slot },
    ));
    if initial {
        entity.insert(DefaultFocus);
    }
    entity.with_children(|c| {
        c.spawn(Node {
            width: percent(100),
            height: percent(100),
            padding: UiRect::all(px(space::MD)),
            flex_direction: FlexDirection::Column,
            justify_content: JustifyContent::SpaceBetween,
            ..default()
        })
        .with_children(|c| {
            c.spawn((
                kit.text(&game.title, ts::TITLE_MEDIUM, R::OnSurface),
                TextLayout::linebreak(LineBreak::WordBoundary),
            ));
            c.spawn(kit.text(&game.platform, ts::LABEL_SMALL, R::OnSurfaceVariant));
        });
        c.spawn((
            Node {
                width: percent(100),
                height: percent(100),
                position_type: PositionType::Absolute,
                ..default()
            },
            ImageNode::default(),
            Cover,
            ArtSlot(game.tile.clone()),
            Visibility::Hidden,
        ));
    });
}

fn top_bar(p: &mut ChildSpawnerCommands, kit: &Kit, shell: &Shell, current: Screen) {
    p.spawn(Node {
        width: percent(100),
        height: px(size::TARGET),
        align_items: AlignItems::Center,
        column_gap: px(space::SM + space::XS),
        ..default()
    })
    .with_children(|bar| {
        chip(
            bar,
            kit,
            &t("nav.games"),
            current == Screen::Home,
            Action::Go(Screen::Home),
        );
        chip(
            bar,
            kit,
            &t("nav.library"),
            current == Screen::Library,
            Action::Filter(shell.filter),
        );
        chip(
            bar,
            kit,
            &t("nav.downloads"),
            current == Screen::Downloads,
            Action::Go(Screen::Downloads),
        );
        chip(
            bar,
            kit,
            &t("nav.settings"),
            current == Screen::Settings,
            Action::Go(Screen::Settings),
        );
        bar.spawn(Node {
            flex_grow: 1.0,
            ..default()
        });
        bar.spawn((kit.text("", ts::LABEL, R::OnSurfaceVariant), Bind::Gpu));
        bar.spawn((
            kit.icon("sports_esports", icon::MD, R::OnSurfaceVariant),
            PadIndicator,
        ));
        bar.spawn((
            kit.text(crate::app::clock(), ts::TITLE, R::OnSurface),
            Bind::Clock,
        ));
        icon_button(
            bar,
            kit,
            "power_settings_new",
            &t("nav.power"),
            Action::Quick(QuickAction::Power),
        );
    });
}

fn hero_backdrop(r: &mut ChildSpawnerCommands, scrim: Scrim) {
    r.spawn((
        Node {
            width: percent(100),
            height: percent(100),
            position_type: PositionType::Absolute,
            ..default()
        },
        ImageNode::default().with_color(Color::WHITE.with_alpha(0.0)),
        Cover,
        HeroBg::default(),
    ));
    r.spawn((
        Node {
            width: percent(100),
            height: percent(100),
            position_type: PositionType::Absolute,
            ..default()
        },
        BackgroundGradient::default(),
        scrim,
    ));
}

pub fn spawn_home(mut commands: Commands, kit: Res<Kit>, shell: Res<Shell>, running: Res<Running>) {
    let shown: Vec<usize> = (0..shell.library.games.len())
        .take(size::RAIL_SHOWN)
        .collect();
    let focus_slot = shown.iter().position(|&i| i == shell.selected).unwrap_or(0);
    commands.spawn(root(Screen::Home)).with_children(|r| {
        hero_backdrop(r, Scrim::Hero);
        r.spawn(Node {
            width: percent(100),
            height: percent(100),
            position_type: PositionType::Absolute,
            flex_direction: FlexDirection::Column,
            padding: UiRect::axes(px(space::XXXL), px(space::XL + space::SM)),
            ..default()
        })
        .with_children(|col| {
            top_bar(col, &kit, &shell, Screen::Home);
            col.spawn(Node {
                flex_grow: 1.0,
                ..default()
            });
            col.spawn(Node {
                flex_direction: FlexDirection::Column,
                row_gap: px(space::SM),
                max_width: px(1200),
                ..default()
            })
            .with_children(|hero| {
                hero.spawn((
                    kit.text("", ts::TITLE_MEDIUM, R::Primary),
                    Bind::HeroPlatform,
                ));
                hero.spawn((
                    kit.text("", ts::DISPLAY_LARGE, R::OnSurface),
                    Bind::HeroTitle,
                ));
                hero.spawn((kit.text("", ts::BODY, R::OnSurfaceVariant), Bind::HeroMeta));
                hero.spawn(Node {
                    column_gap: px(space::MD),
                    margin: UiRect::top(px(space::MD)),
                    ..default()
                })
                .with_children(|row| {
                    let play = t("action.play");
                    button(
                        row,
                        &kit,
                        "play_arrow",
                        &play,
                        true,
                        Action::Play(shell.selected),
                        PlayButton,
                    );
                    let hub = t("action.game-hub");
                    button(
                        row,
                        &kit,
                        "tune",
                        &hub,
                        false,
                        Action::Hub(shell.selected),
                        HubButton,
                    );
                });
            });
            activity(col, &kit, &shell, &running);
            col.spawn(Node {
                width: percent(100),
                height: px(size::CAPSULE.1 + space::XL),
                margin: UiRect::top(px(space::LG)),
                padding: UiRect::axes(px(space::SM), px(space::MD)),
                ..default()
            })
            .with_children(|rail| {
                rail.spawn((
                    Node {
                        column_gap: px(size::CAPSULE_GAP),
                        left: px(0),
                        ..default()
                    },
                    RailTrack(Spring::spatial(0.0)),
                ))
                .with_children(|track| {
                    for (slot, &index) in shown.iter().enumerate() {
                        capsule(
                            track,
                            &kit,
                            &shell,
                            index,
                            slot,
                            size::CAPSULE,
                            slot == focus_slot,
                        );
                    }
                    let count = tf("library.count", &[("count", &shell.library.games.len())]);
                    track
                        .spawn((
                            Node {
                                width: px(size::CAPSULE.0),
                                height: px(size::CAPSULE.1),
                                flex_direction: FlexDirection::Column,
                                justify_content: JustifyContent::Center,
                                align_items: AlignItems::Center,
                                row_gap: px(space::SM),
                                border_radius: radius(shape::MEDIUM),
                                ..default()
                            },
                            bg_alpha(R::ContainerHigh, 0.9),
                            focusable(Action::Filter(None), size::FOCUS_GROW, &t("nav.library")),
                            GameTile {
                                game: usize::MAX,
                                slot: shown.len(),
                            },
                        ))
                        .with_children(|c| {
                            c.spawn(kit.icon("grid_view", icon::LG, R::OnSurface));
                            c.spawn(kit.text(t("nav.library"), ts::TITLE_MEDIUM, R::OnSurface));
                            c.spawn(kit.text(count, ts::LABEL_SMALL, R::OnSurfaceVariant));
                        });
                });
            });
        });
    });
}

/// Activity: one quiet line of real entries (resume point, running game, transfers, last
/// session), each a pill sized by its content.
fn activity(col: &mut ChildSpawnerCommands, kit: &Kit, shell: &Shell, running: &Running) {
    let mut items: Vec<(String, String, &str, Action)> = Vec::new();
    if let Some(ext) = &running.external {
        items.push((
            t("activity.running"),
            ext.title.clone(),
            "sports_esports",
            Action::ReturnToGame,
        ));
    }
    if let Some((i, game)) = shell.library.games.iter().enumerate().find(|(i, g)| {
        *i != shell.selected
            && g.is_native()
            && Suspended::of(&shell.paths.states(), &g.key).exists()
    }) {
        items.push((
            t("activity.resume"),
            game.title.clone(),
            "history",
            Action::Play(i),
        ));
    }
    let transfers = shell.library.downloads.len();
    items.push((
        t("activity.downloads"),
        if transfers == 0 {
            tf(
                "activity.packages",
                &[("count", &shell.library.packages.len())],
            )
        } else {
            tf("activity.transfers", &[("count", &transfers)])
        },
        "download",
        Action::Go(Screen::Downloads),
    ));
    let recent = shell.store.lock().unwrap().recent(1);
    if let Some((key, _, _, _)) = recent.first()
        && let Some((i, game)) = shell
            .library
            .games
            .iter()
            .enumerate()
            .find(|(_, g)| &g.key == key)
    {
        items.push((
            t("activity.last"),
            game.title.clone(),
            "videogame_asset",
            Action::Hub(i),
        ));
    }
    col.spawn(Node {
        column_gap: px(space::SM + space::XS),
        margin: UiRect::top(px(space::LG)),
        align_items: AlignItems::Center,
        ..default()
    })
    .with_children(|row| {
        row.spawn(kit.text(t("activity.title"), ts::LABEL, R::OnSurfaceVariant));
        for (title, body, glyph, action) in items {
            let label = format!("{title}: {body}");
            row.spawn((
                Node {
                    height: px(size::CHIP_HEIGHT),
                    padding: UiRect::horizontal(px(space::MD)),
                    column_gap: px(space::SM),
                    align_items: AlignItems::Center,
                    border_radius: radius(shape::FULL),
                    ..default()
                },
                bg_alpha(R::ContainerHigh, 0.8),
                focusable(action, 0.04, &label),
            ))
            .with_children(|pill| {
                pill.spawn(kit.icon(glyph, icon::SM, R::Primary));
                pill.spawn(kit.text(title, ts::LABEL, R::Primary));
                pill.spawn(kit.text(body, ts::LABEL, R::OnSurface));
            });
        }
    });
}

pub fn spawn_library(mut commands: Commands, kit: Res<Kit>, shell: Res<Shell>) {
    let games = shell.visible_games();
    let focus = games.iter().position(|&i| i == shell.selected).unwrap_or(0);
    commands.spawn(root(Screen::Library)).with_children(|r| {
        r.spawn(Node {
            width: percent(100),
            height: percent(100),
            flex_direction: FlexDirection::Column,
            padding: UiRect::axes(px(space::XXXL), px(space::XL + space::SM)),
            row_gap: px(space::LG),
            ..default()
        })
        .with_children(|col| {
            top_bar(col, &kit, &shell, Screen::Library);
            col.spawn(Node {
                column_gap: px(space::SM),
                align_items: AlignItems::Center,
                ..default()
            })
            .with_children(|row| {
                let count = tf("library.count", &[("count", &games.len())]);
                row.spawn(kit.text(count, ts::HEADLINE_SMALL, R::OnSurface));
                row.spawn(Node {
                    width: px(space::LG),
                    ..default()
                });
                for (key, filter) in [
                    ("library.all", None),
                    ("library.steam", Some(Source::Steam)),
                    ("library.emulators", Some(Source::Emulators)),
                    ("library.web", Some(Source::Web)),
                ] {
                    chip(
                        row,
                        &kit,
                        &t(key),
                        shell.filter == filter,
                        Action::Filter(filter),
                    );
                }
            });
            if games.is_empty() && shell.filter == Some(Source::Emulators) {
                col.spawn(kit.text(t("library.empty-emulators"), ts::BODY, R::OnSurfaceVariant));
            }
            col.spawn(Node {
                width: percent(100),
                flex_grow: 1.0,
                overflow: Overflow::clip(),
                padding: UiRect::all(px(space::MD)),
                ..default()
            })
            .with_children(|viewport| {
                viewport
                    .spawn((
                        Node {
                            width: percent(100),
                            flex_wrap: FlexWrap::Wrap,
                            column_gap: px(space::LG),
                            row_gap: px(space::LG),
                            top: px(0),
                            align_content: AlignContent::FlexStart,
                            ..default()
                        },
                        LibraryScroll(Spring::spatial(0.0)),
                    ))
                    .with_children(|grid| {
                        for (slot, &index) in games.iter().enumerate() {
                            capsule(
                                grid,
                                &kit,
                                &shell,
                                index,
                                slot,
                                size::GRID_CAPSULE,
                                slot == focus,
                            );
                        }
                    });
            });
        });
    });
}

pub fn spawn_hub(mut commands: Commands, kit: Res<Kit>, shell: Res<Shell>, running: Res<Running>) {
    let index = shell.hub;
    let Some(game) = shell.library.games.get(index) else {
        return;
    };
    let suspended = Suspended::of(&shell.paths.states(), &game.key);
    let active = running.machine_key() == Some(game.key.as_str());
    commands.spawn(root(Screen::Hub)).with_children(|r| {
        hero_backdrop(r, Scrim::Hub);
        r.spawn(Node {
            width: percent(100),
            height: percent(100),
            position_type: PositionType::Absolute,
            padding: UiRect::axes(px(space::XXXL), px(space::XXL)),
            column_gap: px(space::XXL),
            ..default()
        })
        .with_children(|row| {
            row.spawn(Node {
                flex_direction: FlexDirection::Column,
                row_gap: px(space::MD),
                width: px(1000),
                ..default()
            })
            .with_children(|col| {
                col.spawn(kit.text(&game.platform, ts::TITLE_MEDIUM, R::Primary));
                col.spawn(kit.text(&game.title, ts::DISPLAY_LARGE, R::OnSurface));
                col.spawn((kit.text("", ts::BODY, R::OnSurfaceVariant), Bind::HubState));
                col.spawn(Node {
                    column_gap: px(space::MD),
                    margin: UiRect::vertical(px(space::LG)),
                    ..default()
                })
                .with_children(|actions| {
                    let label = if active || (game.is_native() && suspended.exists()) {
                        t("action.resume")
                    } else {
                        play_verb(game)
                    };
                    button(
                        actions,
                        &kit,
                        "play_arrow",
                        &label,
                        true,
                        Action::Play(index),
                        DefaultFocus,
                    );
                    if game.is_native() && (suspended.exists() || active) {
                        let restart = t("action.restart");
                        button(
                            actions,
                            &kit,
                            "replay",
                            &restart,
                            false,
                            Action::Fresh(index),
                            (),
                        );
                    }
                    let home = t("action.home");
                    button(
                        actions,
                        &kit,
                        "home",
                        &home,
                        false,
                        Action::Go(Screen::Home),
                        (),
                    );
                });
                col.spawn(kit.text(t("hub.profile"), ts::TITLE, R::OnSurface));
                let mut rows = vec![
                    ("speed", "profile.frame-limit", ProfileField::FrameLimit),
                    ("aspect_ratio", "profile.scaling", ProfileField::Scaler),
                    (
                        "history",
                        "profile.instant-resume",
                        ProfileField::InstantResume,
                    ),
                    ("monitoring", "profile.performance", ProfileField::Hud),
                ];
                if !game.is_native() {
                    rows.insert(
                        0,
                        ("fullscreen", "profile.borderless", ProfileField::Borderless),
                    );
                }
                for (glyph, key, field) in rows {
                    let action = Action::Profile(index, field);
                    setting_row(col, &kit, glyph, &t(key), action, Bind::Profile(field));
                }
            });
            row.spawn((
                Node {
                    flex_direction: FlexDirection::Column,
                    row_gap: px(space::SM),
                    padding: UiRect::all(px(space::LG)),
                    width: px(560),
                    align_self: AlignSelf::FlexEnd,
                    border_radius: radius(shape::LARGE),
                    ..default()
                },
                bg_alpha(R::Container, 0.92),
            ))
            .with_children(|panel| {
                panel.spawn(kit.text(t("hub.details"), ts::TITLE_MEDIUM, R::OnSurface));
                for line in details(game) {
                    panel.spawn(kit.text(line, ts::BODY_MEDIUM, R::OnSurfaceVariant));
                }
            });
        });
    });
}

fn details(game: &Game) -> Vec<String> {
    let mut lines = Vec::new();
    match &game.kind {
        Kind::Steam { app_id, installed } => {
            lines.push(format!("Steam app {app_id}"));
            lines.push(if *installed {
                "steam://rungameid".into()
            } else {
                t("platform.steam-not-installed")
            });
        }
        Kind::Native { system, path, .. } => {
            lines.push(format!("{} ({system})", t("meta.bun-engine")));
            lines.push(
                path.file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default(),
            );
        }
        Kind::Route { route, system, .. } => {
            lines.push(route.clone().unwrap_or_else(|| system.clone()));
        }
        Kind::Web { core, systems } => {
            lines.push(format!("{core} ({})", systems.join(", ")));
        }
    }
    if game.size > 0 {
        lines.push(format!("{:.1} MB", game.size as f64 / 1_048_576.0));
    }
    if let Some(d) = &game.developer {
        lines.push(d.clone());
    }
    if let Some(y) = &game.year {
        lines.push(y.clone());
    }
    if let Some(last) = &game.last_played {
        lines.push(tf(
            "meta.last-played",
            &[("date", &last.get(..10).unwrap_or(last))],
        ));
    }
    lines
}

/// A list row: icon, label, value (bound text) and a chevron.
pub fn setting_row(
    p: &mut ChildSpawnerCommands,
    kit: &Kit,
    glyph: &str,
    label: &str,
    action: Action,
    bind: Bind,
) {
    p.spawn((
        Node {
            width: px(size::ROW_WIDTH),
            height: px(size::ROW_HEIGHT),
            padding: UiRect::horizontal(px(space::LG)),
            column_gap: px(space::MD),
            align_items: AlignItems::Center,
            border_radius: radius(shape::LARGE),
            ..default()
        },
        bg_alpha(R::ContainerHigh, 0.9),
        focusable(action, 0.015, label),
    ))
    .with_children(|row| {
        row.spawn(kit.icon(glyph, icon::MD, R::OnSurfaceVariant));
        row.spawn(kit.text(label, ts::BODY, R::OnSurface));
        row.spawn(Node {
            flex_grow: 1.0,
            ..default()
        });
        row.spawn((kit.text("", ts::BODY, R::Primary), bind));
        row.spawn(kit.icon("chevron_right", icon::MD, R::OnSurfaceVariant));
    });
}

pub fn spawn_downloads(mut commands: Commands, kit: Res<Kit>, shell: Res<Shell>) {
    commands.spawn(root(Screen::Downloads)).with_children(|r| {
        r.spawn(Node {
            width: percent(100),
            height: percent(100),
            flex_direction: FlexDirection::Column,
            padding: UiRect::axes(px(space::XXXL), px(space::XL + space::SM)),
            row_gap: px(space::LG),
            ..default()
        })
        .with_children(|col| {
            top_bar(col, &kit, &shell, Screen::Downloads);
            col.spawn(kit.text(t("downloads.steam"), ts::HEADLINE_SMALL, R::OnSurface));
            if shell.library.downloads.is_empty() {
                col.spawn(kit.text(t("downloads.none"), ts::BODY, R::OnSurfaceVariant));
            }
            for (i, d) in shell.library.downloads.iter().enumerate() {
                let progress = if d.total > 0 {
                    d.done as f32 / d.total as f32
                } else {
                    0.0
                };
                col.spawn((
                    Node {
                        width: px(1200),
                        flex_direction: FlexDirection::Column,
                        row_gap: px(space::SM),
                        padding: UiRect::all(px(space::LG)),
                        border_radius: radius(shape::LARGE),
                        ..default()
                    },
                    bg(R::ContainerHigh),
                    focusable(Action::Noop, 0.01, &d.title),
                ))
                .insert_if(DefaultFocus, || i == 0)
                .with_children(|c| {
                    let line = format!("{} · {}", d.title, d.state);
                    c.spawn(kit.text(line, ts::TITLE_MEDIUM, R::OnSurface));
                    c.spawn((
                        Node {
                            width: percent(100),
                            height: px(space::SM),
                            border_radius: radius(space::XS),
                            ..default()
                        },
                        bg(R::ContainerHighest),
                    ))
                    .with_children(|bar| {
                        bar.spawn((
                            Node {
                                width: percent(progress * 100.0),
                                height: percent(100),
                                border_radius: radius(space::XS),
                                ..default()
                            },
                            bg(R::Primary),
                        ));
                    });
                    let done = format!("{:.1}", d.done as f64 / 1e9);
                    let total = format!("{:.1}", d.total as f64 / 1e9);
                    c.spawn(kit.text(
                        tf("downloads.progress", &[("done", &done), ("total", &total)]),
                        ts::BODY_MEDIUM,
                        R::OnSurfaceVariant,
                    ));
                });
            }
            col.spawn(kit.text(t("downloads.packages"), ts::HEADLINE_SMALL, R::OnSurface));
            col.spawn(Node {
                flex_wrap: FlexWrap::Wrap,
                column_gap: px(space::SM),
                row_gap: px(space::SM),
                width: percent(100),
                ..default()
            })
            .with_children(|list| {
                for (i, package) in shell.library.packages.iter().enumerate() {
                    let label = format!("{} {}", package.id, package.version);
                    list.spawn((
                        Node {
                            height: px(size::CHIP_HEIGHT),
                            padding: UiRect::horizontal(px(space::MD)),
                            column_gap: px(space::SM),
                            align_items: AlignItems::Center,
                            border_radius: radius(shape::FULL),
                            ..default()
                        },
                        bg(R::Container),
                        focusable(Action::Noop, 0.03, &label),
                    ))
                    .insert_if(DefaultFocus, || {
                        i == 0 && shell.library.downloads.is_empty()
                    })
                    .with_children(|c| {
                        c.spawn(kit.text(&package.id, ts::LABEL, R::OnSurface));
                        c.spawn(kit.text(&package.version, ts::LABEL, R::OnSurfaceVariant));
                    });
                }
            });
        });
    });
}

pub fn spawn_settings(mut commands: Commands, kit: Res<Kit>, shell: Res<Shell>) {
    commands.spawn(root(Screen::Settings)).with_children(|r| {
        r.spawn(Node {
            width: percent(100),
            height: percent(100),
            flex_direction: FlexDirection::Column,
            padding: UiRect::axes(px(space::XXXL), px(space::XL + space::SM)),
            row_gap: px(space::MD),
            ..default()
        })
        .with_children(|col| {
            top_bar(col, &kit, &shell, Screen::Settings);
            col.spawn(Node {
                column_gap: px(space::XXL),
                margin: UiRect::top(px(space::LG)),
                ..default()
            })
            .with_children(|row| {
                row.spawn(Node {
                    flex_direction: FlexDirection::Column,
                    row_gap: px(space::SM + space::XS),
                    ..default()
                })
                .with_children(|list| {
                    list.spawn(kit.text(t("settings.console"), ts::TITLE, R::OnSurface));
                    for (glyph, key, setting) in [
                        ("vibration", "settings.haptics", SettingKey::Haptics),
                        ("motion_photos_off", "settings.motion", SettingKey::Motion),
                        ("monitoring", "settings.performance", SettingKey::Hud),
                        ("library_books", "settings.reload", SettingKey::Rescan),
                        ("desktop_windows", "settings.session", SettingKey::Session),
                        ("logout", "settings.desktop", SettingKey::Desktop),
                    ] {
                        let action = Action::Setting(setting);
                        setting_row(list, &kit, glyph, &t(key), action, Bind::Setting(setting));
                    }
                });
                row.spawn((
                    Node {
                        flex_direction: FlexDirection::Column,
                        row_gap: px(space::SM),
                        padding: UiRect::all(px(space::LG)),
                        width: px(700),
                        border_radius: radius(shape::LARGE),
                        ..default()
                    },
                    bg(R::Container),
                ))
                .with_children(|about| {
                    about.spawn(kit.text(t("settings.system"), ts::TITLE, R::OnSurface));
                    for bind in [Bind::NvidiaPanel, Bind::DisplayPanel, Bind::SessionPanel] {
                        about.spawn((kit.text("", ts::BODY_MEDIUM, R::OnSurfaceVariant), bind));
                    }
                });
            });
        });
    });
}

pub fn spawn_playing(mut commands: Commands, running: Res<Running>) {
    let (w, h) = running.image_size;
    let aspect = if h > 0 && w > 1 {
        w as f32 / h as f32
    } else {
        256.0 / 240.0
    };
    commands
        .spawn((
            Node {
                width: percent(100),
                height: percent(100),
                position_type: PositionType::Absolute,
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(Color::BLACK),
            DespawnOnExit(Screen::Playing),
        ))
        .with_children(|r| {
            r.spawn((
                Node {
                    height: percent(100),
                    aspect_ratio: Some(aspect),
                    max_width: percent(100),
                    ..default()
                },
                ImageNode::new(running.image.clone()),
                MachineView,
            ));
        });
}

/// Keeps the game view on the latest engine picture and aspect ratio.
pub fn update_machine_view(
    running: Res<Running>,
    mut views: Query<(&mut ImageNode, &mut Node), With<MachineView>>,
) {
    for (mut image, mut node) in &mut views {
        if image.image != running.image {
            image.image = running.image.clone();
        }
        let (w, h) = running.image_size;
        if h > 0 && w > 1 {
            let aspect = Some(w as f32 / h as f32);
            if node.aspect_ratio != aspect {
                node.aspect_ratio = aspect;
            }
        }
    }
}

/// Global toast and performance HUD (live across screens).
pub fn spawn_global(mut commands: Commands, kit: Res<Kit>) {
    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                bottom: px(space::XXL),
                width: percent(100),
                justify_content: JustifyContent::Center,
                ..default()
            },
            GlobalZIndex(30),
            Pickable::IGNORE,
        ))
        .with_children(|row| {
            row.spawn((
                Node {
                    padding: UiRect::axes(px(space::LG), px(space::MD)),
                    border_radius: radius(shape::FULL),
                    max_width: px(1400),
                    ..default()
                },
                bg(R::ContainerHighest),
                UiTransform::IDENTITY,
                ToastBox(Spring::spatial(0.0)),
                Visibility::Hidden,
            ))
            .with_children(|b| {
                b.spawn((kit.text("", ts::BODY, R::OnSurface), Bind::Toast));
            });
        });
    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                top: px(space::LG),
                right: px(space::LG),
                padding: UiRect::all(px(space::MD)),
                border_radius: radius(shape::MEDIUM),
                ..default()
            },
            bg_alpha(R::Scrim, 0.7),
            GlobalZIndex(40),
            Visibility::Hidden,
            HudBox,
        ))
        .with_children(|b| {
            b.spawn((kit.text("", ts::LABEL, R::OnSurface), Bind::Hud));
        });
}

/// Show artwork once decoded; the typographic tile stays when no real art exists.
pub fn fill_art(
    mut art: ResMut<Art>,
    mut slots: Query<(&ArtSlot, &mut ImageNode, &mut Visibility)>,
) {
    for (slot, mut image, mut visibility) in &mut slots {
        if *visibility == Visibility::Hidden
            && let Some(handle) = art.get(&slot.0)
        {
            image.image = handle;
            *visibility = Visibility::Inherited;
        }
    }
}

/// Follow focus on capsules: selected game, rail scroll and library scroll.
pub fn follow_focus(
    focus: Res<bevy::input_focus::InputFocus>,
    tiles: Query<&GameTile>,
    mut shell: ResMut<Shell>,
    mut rails: Query<&mut RailTrack>,
    mut grids: Query<&mut LibraryScroll>,
) {
    if !focus.is_changed() {
        return;
    }
    let Some(tile) = focus.get().and_then(|e| tiles.get(e).ok()) else {
        return;
    };
    if tile.game != usize::MAX && shell.selected != tile.game {
        shell.selected = tile.game;
    }
    for mut rail in &mut rails {
        rail.0.target = -((tile.slot as f32) * (size::CAPSULE.0 + size::CAPSULE_GAP));
    }
    for mut grid in &mut grids {
        let row = (tile.slot / size::GRID_COLUMNS) as f32;
        grid.0.target = -(row - 1.0).max(0.0) * (size::GRID_CAPSULE.1 + space::LG);
    }
}

pub fn animate_scroll(
    time: Res<Time>,
    motion: Res<Motion>,
    mut rails: Query<(&mut RailTrack, &mut Node), Without<LibraryScroll>>,
    mut grids: Query<(&mut LibraryScroll, &mut Node), Without<RailTrack>>,
) {
    let dt = time.delta_secs();
    for (mut rail, mut node) in &mut rails {
        rail.0.step(dt, motion.reduced);
        let left = px(rail.0.value());
        if node.left != left {
            node.left = left;
        }
    }
    for (mut grid, mut node) in &mut grids {
        grid.0.step(dt, motion.reduced);
        let top = px(grid.0.value());
        if node.top != top {
            node.top = top;
        }
    }
}

/// The orchestrated moment: when the focused game's art is ready, the hero cross-fades and the
/// scheme re-tints toward the art's source color together (~300 ms, emphasized easing).
pub fn hero_and_tint(
    time: Res<Time>,
    motion: Res<Motion>,
    shell: Res<Shell>,
    screen: Res<State<Screen>>,
    mut art: ResMut<Art>,
    mut theme: ResMut<Theme>,
    mut heroes: Query<(&mut HeroBg, &mut ImageNode)>,
) {
    let index = if *screen.get() == Screen::Hub {
        shell.hub
    } else {
        shell.selected
    };
    let game = shell.library.games.get(index);
    let wanted = game.map(|g| hero_art(&shell, g));
    let ready = wanted.as_ref().and_then(|a| art.entry(a));
    let tile_seed = game.and_then(|g| art.entry(&g.tile)).map(|(_, seed)| seed);
    let gone = wanted.as_ref().is_none_or(|a| art.unavailable(a));
    let id = wanted.as_ref().map(ArtRef::id);
    for (mut hero, mut image) in &mut heroes {
        if hero.shown == id {
            continue;
        }
        if let Some((handle, seed)) = &ready {
            image.image = handle.clone();
            hero.shown = id.clone();
            theme.retint(*seed, motion.reduced);
        } else if gone {
            hero.shown = id.clone();
            image.color = Color::WHITE.with_alpha(0.0);
            theme.retint(
                tile_seed.unwrap_or(crate::theme::BASELINE_SEED),
                motion.reduced,
            );
        }
    }
    let running = theme.step(time.delta_secs());
    let alpha = if running {
        theme.progress() * size::HERO_OPACITY
    } else {
        size::HERO_OPACITY
    };
    if ready.is_some() {
        for (hero, mut image) in &mut heroes {
            if hero.shown == id {
                image.color = Color::WHITE.with_alpha(alpha);
            }
        }
    }
}

/// Re-tint the legibility scrims with the scheme.
pub fn tint_scrims(theme: Res<Theme>, mut scrims: Query<(Ref<Scrim>, &mut BackgroundGradient)>) {
    for (scrim, mut gradient) in &mut scrims {
        if !theme.is_changed() && !scrim.is_added() {
            continue;
        }
        let s = theme.get(R::SurfaceDim);
        let (side, bottom) = match *scrim {
            Scrim::Hero => ((0.94, 0.62, 52.0, 82.0), (0.98, 52.0)),
            Scrim::Hub => ((0.96, 0.72, 58.0, 100.0), (0.9, 40.0)),
        };
        *gradient = BackgroundGradient(vec![
            LinearGradient::new(
                LinearGradient::TO_RIGHT,
                vec![
                    ColorStop::new(s.with_alpha(side.0), percent(0)),
                    ColorStop::new(s.with_alpha(side.1), percent(side.2)),
                    ColorStop::new(s.with_alpha(0.0), percent(side.3)),
                ],
            )
            .into(),
            LinearGradient::new(
                LinearGradient::TO_TOP,
                vec![
                    ColorStop::new(s.with_alpha(bottom.0), percent(0)),
                    ColorStop::new(s.with_alpha(0.0), percent(bottom.1)),
                ],
            )
            .into(),
        ]);
    }
}

/// Keep the hero actions on the selected game.
#[allow(clippy::type_complexity)]
pub fn hero_actions(
    shell: Res<Shell>,
    running: Res<Running>,
    mut play: Query<&mut Focusable, (With<PlayButton>, Without<HubButton>)>,
    mut hub: Query<&mut Focusable, (With<HubButton>, Without<PlayButton>)>,
    children: Query<&Children>,
    buttons: Query<Entity, With<PlayButton>>,
    mut labels: Query<&mut Text, With<PlayLabelSlot>>,
) {
    for mut f in &mut play {
        if f.0 != Action::Play(shell.selected) {
            f.0 = Action::Play(shell.selected);
        }
    }
    for mut f in &mut hub {
        if f.0 != Action::Hub(shell.selected) {
            f.0 = Action::Hub(shell.selected);
        }
    }
    let label = play_label(&shell, &running, shell.selected);
    for button in &buttons {
        for child in children.iter_descendants(button) {
            if let Ok(mut text) = labels.get_mut(child)
                && text.0 != label
            {
                text.0 = label.clone();
            }
        }
    }
}

fn play_verb(game: &Game) -> String {
    match game.kind {
        Kind::Steam {
            installed: false, ..
        } => t("action.steam-page"),
        Kind::Web { .. } => t("action.open"),
        _ => t("action.play"),
    }
}

pub fn play_label(shell: &Shell, running: &Running, index: usize) -> String {
    let Some(game) = shell.library.games.get(index) else {
        return t("action.play");
    };
    if running.external.as_ref().is_some_and(|e| e.key == game.key) {
        return t("action.return");
    }
    if running.machine_key() == Some(game.key.as_str())
        || (game.is_native() && Suspended::of(&shell.paths.states(), &game.key).exists())
    {
        return t("action.resume");
    }
    play_verb(game)
}

fn hero_meta(shell: &Shell, game: &Game) -> String {
    let mut parts = Vec::new();
    if let Some(y) = &game.year {
        parts.push(y.clone());
    }
    if let Some(d) = &game.developer {
        parts.push(d.clone());
    }
    if game.is_native() {
        parts.push(
            if Suspended::of(&shell.paths.states(), &game.key).exists() {
                t("meta.instant-resume")
            } else {
                t("meta.bun-engine")
            },
        );
    }
    if let Some(last) = &game.last_played {
        parts.push(tf(
            "meta.last-played",
            &[("date", &last.get(..10).unwrap_or(last))],
        ));
    }
    parts.join("  ·  ")
}

fn onoff(b: bool) -> String {
    t(if b { "value.on" } else { "value.off" })
}

fn limit(fps: u32) -> String {
    if fps == 0 {
        t("value.display-rate")
    } else {
        tf("value.fps", &[("fps", &fps)])
    }
}

fn scaler(s: &str) -> String {
    match s {
        "smooth" => t("value.smooth"),
        "fsr1" => t("value.fsr1"),
        _ => t("value.sharp"),
    }
}

fn nvidia_panel(gpu: &crate::nvidia::GpuState) -> String {
    if !gpu.available {
        return gpu.summary();
    }
    let vrr = gpu
        .vrr
        .map_or("unknown".to_string(), |(on, possible, active)| {
            format!(
                "{}{}{}",
                if on { "on" } else { "off" },
                if possible {
                    ""
                } else {
                    ", display not capable"
                },
                if active { ", active" } else { "" }
            )
        });
    format!(
        "{}\nDriver {}\n{}°C · core {} MHz · memory {} MHz · load {}%\n{:.0} W of {:.0} W · VRAM {} of {} MB\nG-SYNC/VRR {vrr}\nReflex {}",
        gpu.name,
        gpu.driver,
        gpu.temperature_c.unwrap_or(0),
        gpu.core_mhz.unwrap_or(0),
        gpu.memory_mhz.unwrap_or(0),
        gpu.load_percent.unwrap_or(0),
        gpu.power_w.unwrap_or(0.0),
        gpu.power_limit_w.unwrap_or(0.0),
        gpu.vram_used_mb.unwrap_or(0),
        gpu.vram_total_mb.unwrap_or(0),
        if gpu.reflex_api {
            "available in the driver, enabled by games"
        } else {
            "not exposed"
        },
    )
}

/// Every `Bind`, refreshed at 4 Hz (clock, NVIDIA, values) or on change; toast and HUD visibility.
#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub fn update_bindings(
    time: Res<Time>,
    mut since: Local<f32>,
    shell: Res<Shell>,
    running: Res<Running>,
    settings: Res<Settings>,
    motion: Res<Motion>,
    stats: Res<crate::script::Stats>,
    overlay: Res<State<Overlay>>,
    screen: Res<State<Screen>>,
    pads: Query<(), With<Gamepad>>,
    mut texts: Query<(&mut Text, &Bind)>,
    mut huds: Query<&mut Visibility, (With<HudBox>, Without<ToastBox>, Without<PadIndicator>)>,
    mut pad_icons: Query<&mut Visibility, (With<PadIndicator>, Without<HudBox>, Without<ToastBox>)>,
    mut toasts: Query<
        (&mut Visibility, &mut ToastBox, &mut UiTransform),
        (Without<PadIndicator>, Without<HudBox>),
    >,
) {
    let dt = time.delta_secs();
    for (mut visibility, mut toast, mut transform) in &mut toasts {
        toast.0.target = if shell.toast.is_some() { 1.0 } else { 0.0 };
        toast.0.step(dt, motion.reduced);
        let v = toast.0.value();
        *visibility = if v > 0.01 || shell.toast.is_some() {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
        transform.translation = Val2::px(0.0, (1.0 - v) * space::XL);
    }
    *since += dt;
    let refresh = *since >= 0.25
        || shell.is_changed()
        || settings.is_changed()
        || overlay.is_changed()
        || screen.is_changed();
    if !refresh {
        return;
    }
    *since = 0.0;
    let gpu = shell.gpu.lock().unwrap().clone();
    let info = crate::runtime::machine_info(&running);
    let profile = running
        .profile
        .clone()
        .filter(|_| running.machine.is_some())
        .unwrap_or_else(|| {
            shell.library.games.get(shell.selected).map_or_else(
                || crate::profiles::Profile::new(""),
                |g| shell.store.lock().unwrap().profile(&g.key),
            )
        });
    let hub_profile = shell
        .library
        .games
        .get(shell.hub)
        .map(|g| shell.store.lock().unwrap().profile(&g.key));
    let show_hud = settings.hud
        || running.profile.as_ref().is_some_and(|p| {
            p.hud && running.machine.is_some() && *screen.get() == Screen::Playing
        });
    for mut v in &mut huds {
        *v = if show_hud {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
    }
    let pad_count = pads.iter().count();
    for mut v in &mut pad_icons {
        *v = if pad_count > 0 {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
    }
    let selected = shell.library.games.get(shell.selected);
    for (mut text, bind) in &mut texts {
        let value = match bind {
            Bind::Clock => crate::app::clock(),
            Bind::Gpu => gpu.summary(),
            Bind::HeroPlatform => selected.map(|g| g.platform.clone()).unwrap_or_default(),
            Bind::HeroTitle => selected.map(|g| g.title.clone()).unwrap_or_default(),
            Bind::HeroMeta => selected.map(|g| hero_meta(&shell, g)).unwrap_or_default(),
            Bind::Toast => shell
                .toast
                .as_ref()
                .map(|(m, _)| m.clone())
                .unwrap_or_default(),
            Bind::Hud => {
                let mut lines = vec![format!(
                    "UI {:.0} fps · {:.2} ms · p99 {:.2} ms",
                    stats.fps(),
                    stats.mean_ms(),
                    stats.p99_ms()
                )];
                if let Some(i) = &info {
                    lines.push(format!("{} {:.1} fps", i.name, i.fps));
                }
                if gpu.available {
                    lines.push(format!(
                        "GPU {}°C · {} MHz · {}% · {:.0} W",
                        gpu.temperature_c.unwrap_or(0),
                        gpu.core_mhz.unwrap_or(0),
                        gpu.load_percent.unwrap_or(0),
                        gpu.power_w.unwrap_or(0.0)
                    ));
                }
                lines.join("\n")
            }
            Bind::Profile(field) => {
                let p = hub_profile.clone().unwrap_or_else(|| profile.clone());
                match field {
                    ProfileField::FrameLimit => limit(p.fps_limit),
                    ProfileField::Scaler => scaler(&p.scaler),
                    ProfileField::Borderless => onoff(p.borderless),
                    ProfileField::InstantResume => onoff(p.instant_resume),
                    ProfileField::Hud => onoff(p.hud),
                }
            }
            Bind::Setting(key) => match key {
                SettingKey::Haptics => onoff(settings.haptics),
                SettingKey::Hud => onoff(settings.hud),
                SettingKey::Motion => match settings.motion {
                    MotionPref::System => {
                        let mode = t(if motion.reduced {
                            "value.reduced"
                        } else {
                            "value.full"
                        });
                        tf("value.system", &[("mode", &mode)])
                    }
                    MotionPref::Reduced => t("value.reduced"),
                    MotionPref::Full => t("value.full"),
                },
                SettingKey::Rescan => tf("library.count", &[("count", &shell.library.games.len())]),
                SettingKey::Session => {
                    #[cfg(windows)]
                    {
                        t(if crate::system::session_entry().is_some() {
                            "value.registered"
                        } else {
                            "value.not-registered"
                        })
                    }
                    #[cfg(not(windows))]
                    {
                        String::new()
                    }
                }
                SettingKey::Desktop => String::new(),
            },
            Bind::QuickValue(action) => match action {
                QuickAction::Hud => onoff(settings.hud),
                QuickAction::FrameLimit => limit(profile.fps_limit),
                QuickAction::Scaling => scaler(&profile.scaler),
                QuickAction::Record => {
                    if running.recorder.is_some() {
                        t("value.recording")
                    } else {
                        t("value.off")
                    }
                }
                QuickAction::VolumeDown | QuickAction::VolumeUp => shell
                    .volume
                    .map(|v| format!("{:.0}%", v * 100.0))
                    .unwrap_or_default(),
                _ => String::new(),
            },
            Bind::NvidiaPanel => nvidia_panel(&gpu),
            Bind::DisplayPanel => format!(
                "{}\n{}",
                shell.display.summary(),
                shell
                    .encoders
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "No hardware video encoder".into())
            ),
            Bind::SessionPanel => match (&info, &running.external) {
                (Some(i), _) => format!(
                    "{} · {:.1} fps{}{}",
                    i.name,
                    i.fps,
                    if i.paused { " · suspended" } else { "" },
                    if i.resumed_from_disk {
                        " · resumed from disk"
                    } else {
                        ""
                    }
                ),
                (None, Some(ext)) => format!(
                    "{} · {:.0} s",
                    ext.title,
                    ext.started.elapsed().as_secs_f32()
                ),
                _ => format!("{} {}", t("app.name"), env!("CARGO_PKG_VERSION")),
            },
            Bind::HubState => shell
                .library
                .games
                .get(shell.hub)
                .map(|g| {
                    if running.machine_key() == Some(g.key.as_str()) {
                        t("hub.suspended-memory")
                    } else if Suspended::of(&shell.paths.states(), &g.key).exists() {
                        t("hub.suspended-disk")
                    } else {
                        hero_meta(&shell, g)
                    }
                })
                .unwrap_or_default(),
        };
        if text.0 != value {
            text.0 = value;
        }
    }
}

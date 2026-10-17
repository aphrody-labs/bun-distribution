//! The screens: Home (hero art, game rail, activity cards), Library (all games, filters), Game
//! hub (profile), Downloads, Settings and the in-game view, plus the always-on toast and
//! performance HUD. Views are Bevy UI trees built on `OnEnter` and despawned on exit; live values
//! go through `Bind` text bindings and springs.

use std::path::PathBuf;

use bevy::ecs::hierarchy::ChildSpawnerCommands;
use bevy::prelude::*;
use bevy::ui::{BackgroundGradient, ColorStop, LinearGradient};

use crate::app::{Action, MotionPref, Overlay, ProfileField, Screen, SettingKey, Settings, Shell};
use crate::assets::Art;
use crate::library::{Game, Kind, Source};
use crate::machine::Suspended;
use crate::runtime::Running;
use crate::theme::{shape, space, typescale as ts};
use crate::ui::{Cover, DefaultFocus, FocusFx, Focusable, Kit, Layer, Motion, Spring, radius};

pub const RAIL_TILE: (f32, f32) = (300.0, 140.0);
pub const RAIL_GAP: f32 = 20.0;
pub const RAIL_COUNT: usize = 18;

/// Text whose content follows shell state.
#[derive(Component, Clone, Copy, PartialEq)]
pub enum Bind {
    Clock,
    Gpu,
    HeroTitle,
    HeroMeta,
    HeroPlay,
    Toast,
    Hud,
    Profile(ProfileField),
    Setting(SettingKey),
    QuickValue(crate::app::QuickAction),
    NvidiaPanel,
    DisplayPanel,
    SessionPanel,
    HubState,
}

/// A slot that shows an artwork file once the loader decoded it.
#[derive(Component)]
pub struct ArtSlot(pub PathBuf);

#[derive(Component)]
pub struct GameTile {
    pub game: usize,
    pub slot: usize,
}

#[derive(Component)]
pub struct HeroBg {
    pub fade: Spring,
    pub shown: Option<PathBuf>,
}

#[derive(Component)]
pub struct HeroButton;

#[derive(Component)]
pub struct HeroHubButton;

#[derive(Component)]
pub struct RailTrack(pub Spring);

#[derive(Component)]
pub struct LibraryScroll(pub Spring);

#[derive(Component)]
pub struct ToastBox(pub Spring);

#[derive(Component)]
pub struct MachineView;

pub fn short_system(game: &Game) -> &'static str {
    match &game.kind {
        Kind::Steam { .. } => "STEAM",
        Kind::Web { .. } => "WASM",
        Kind::Native { system, .. } | Kind::Route { system, .. } => match system.as_str() {
            "nes" => "NES",
            "gba" => "GBA",
            "nds" => "DS",
            "psx" => "PS1",
            "gc" => "GC",
            "wii" => "WII",
            "3ds" => "3DS",
            _ => "EMU",
        },
    }
}

/// Artwork for a game: Steam art, else its suspend thumbnail.
pub fn art_for(shell: &Shell, game: &Game, hero: bool) -> Option<PathBuf> {
    let steam = if hero {
        game.hero.clone().or_else(|| game.tile.clone())
    } else {
        game.tile.clone().or_else(|| game.hero.clone())
    };
    steam.or_else(|| {
        let thumb = Suspended::of(&shell.paths.states(), &game.key).thumb;
        thumb.is_file().then_some(thumb)
    })
}

fn root(screen: Screen, color: Color) -> impl Bundle {
    (
        Node {
            width: percent(100),
            height: percent(100),
            position_type: PositionType::Absolute,
            ..default()
        },
        BackgroundColor(color),
        DespawnOnExit(screen),
    )
}

fn focusable(action: Action, grow: f32) -> impl Bundle {
    (
        Focusable(action),
        FocusFx::new(grow),
        UiTransform::IDENTITY,
        Outline {
            width: px(3),
            offset: px(4),
            color: Color::NONE,
        },
        Layer::Screen,
    )
}

/// Filled (primary) or tonal button with a leading icon.
pub fn button(
    p: &mut ChildSpawnerCommands,
    kit: &Kit,
    icon: &str,
    label: &str,
    filled: bool,
    action: Action,
    extra: impl Bundle,
) {
    let t = &kit.theme;
    let (bg, fg) = if filled {
        (t.primary, t.on_primary)
    } else {
        (t.secondary_container, t.on_secondary_container)
    };
    p.spawn((
        Node {
            height: px(64),
            padding: UiRect::horizontal(px(space::LG + 4.0)),
            column_gap: px(space::SM + 4.0),
            align_items: AlignItems::Center,
            border_radius: radius(shape::FULL),
            ..default()
        },
        BackgroundColor(bg),
        focusable(action, 0.06),
        extra,
    ))
    .with_children(|b| {
        b.spawn(kit.icon(icon, 30.0, fg));
        b.spawn(kit.text(label, ts::TITLE_MEDIUM, fg));
    });
}

fn icon_button(p: &mut ChildSpawnerCommands, kit: &Kit, icon: &str, action: Action) {
    p.spawn((
        Node {
            width: px(56),
            height: px(56),
            justify_content: JustifyContent::Center,
            align_items: AlignItems::Center,
            border_radius: radius(shape::FULL),
            ..default()
        },
        BackgroundColor(kit.theme.surface_container_high.with_alpha(0.85)),
        focusable(action, 0.1),
    ))
    .with_children(|b| {
        b.spawn(kit.icon(icon, 30.0, kit.theme.on_surface));
    });
}

fn chip(p: &mut ChildSpawnerCommands, kit: &Kit, label: &str, selected: bool, action: Action) {
    let t = &kit.theme;
    let (bg, fg) = if selected {
        (t.secondary_container, t.on_secondary_container)
    } else {
        (Color::NONE, t.on_surface_variant)
    };
    p.spawn((
        Node {
            height: px(44),
            padding: UiRect::horizontal(px(space::MD + 4.0)),
            align_items: AlignItems::Center,
            border: UiRect::all(px(if selected { 0 } else { 1 })),
            border_radius: radius(shape::SMALL),
            ..default()
        },
        BackgroundColor(bg),
        BorderColor::all(t.outline_variant),
        focusable(action, 0.05),
    ))
    .with_children(|b| {
        b.spawn(kit.text(label, ts::LABEL, fg));
    });
}

/// A game tile: artwork (cover-cropped) or a tonal placeholder with the platform mark.
fn tile(
    p: &mut ChildSpawnerCommands,
    kit: &Kit,
    shell: &Shell,
    index: usize,
    slot: usize,
    size: (f32, f32),
    initial: bool,
) {
    let game = &shell.library.games[index];
    let t = &kit.theme;
    let art = art_for(shell, game, false);
    let mut entity = p.spawn((
        Node {
            width: px(size.0),
            height: px(size.1),
            flex_shrink: 0.0,
            overflow: Overflow::clip(),
            border_radius: radius(shape::LARGE),
            ..default()
        },
        BackgroundColor(t.surface_container_high),
        BoxShadow::new(Color::BLACK.with_alpha(0.45), px(0), px(8), px(0), px(18)),
        focusable(Action::Play(index), 0.08),
        GameTile { game: index, slot },
    ));
    if initial {
        entity.insert(DefaultFocus);
    }
    entity.with_children(|c| {
        if let Some(path) = art {
            c.spawn((
                Node {
                    width: percent(100),
                    height: percent(100),
                    position_type: PositionType::Absolute,
                    ..default()
                },
                ImageNode::default(),
                Cover,
                ArtSlot(path),
            ));
        } else {
            c.spawn((
                Node {
                    width: percent(100),
                    height: percent(100),
                    padding: UiRect::all(px(space::MD)),
                    flex_direction: FlexDirection::Column,
                    justify_content: JustifyContent::SpaceBetween,
                    ..default()
                },
                BackgroundGradient::from(LinearGradient::to_bottom_right(vec![
                    ColorStop::auto(t.primary_container),
                    ColorStop::auto(t.tertiary_container),
                ])),
            ))
            .with_children(|c| {
                c.spawn(kit.text(
                    short_system(game),
                    ts::HEADLINE_SMALL,
                    t.on_primary_container,
                ));
                c.spawn((
                    kit.text(&game.title, ts::LABEL, t.on_primary_container),
                    TextLayout {
                        linebreak: LineBreak::WordBoundary,
                        ..default()
                    },
                ));
            });
        }
    });
}

fn top_bar(p: &mut ChildSpawnerCommands, kit: &Kit, shell: &Shell, current: Screen) {
    let t = &kit.theme;
    p.spawn(Node {
        width: percent(100),
        height: px(64),
        align_items: AlignItems::Center,
        column_gap: px(space::MD),
        ..default()
    })
    .with_children(|bar| {
        bar.spawn(kit.icon("sports_esports", 40.0, t.primary));
        bar.spawn(kit.text("Bun OS", ts::TITLE, t.on_surface));
        bar.spawn(Node {
            width: px(space::LG),
            ..default()
        });
        chip(
            bar,
            kit,
            "Games",
            current == Screen::Home,
            Action::Go(Screen::Home),
        );
        chip(
            bar,
            kit,
            "Library",
            current == Screen::Library,
            Action::Filter(shell.filter),
        );
        chip(
            bar,
            kit,
            "Downloads",
            current == Screen::Downloads,
            Action::Go(Screen::Downloads),
        );
        chip(
            bar,
            kit,
            "Settings",
            current == Screen::Settings,
            Action::Go(Screen::Settings),
        );
        bar.spawn(Node {
            flex_grow: 1.0,
            ..default()
        });
        bar.spawn((
            Node {
                padding: UiRect::axes(px(space::MD), px(space::SM)),
                border_radius: radius(shape::FULL),
                column_gap: px(space::SM),
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(t.surface_container_high.with_alpha(0.8)),
        ))
        .with_children(|pill| {
            pill.spawn(kit.icon("memory", 24.0, t.tertiary));
            pill.spawn((
                kit.text("NVIDIA", ts::LABEL, t.on_surface_variant),
                Bind::Gpu,
            ));
        });
        icon_button(
            bar,
            kit,
            "power_settings_new",
            Action::Quick(crate::app::QuickAction::Power),
        );
        bar.spawn((
            kit.text(crate::app::clock(), ts::TITLE, t.on_surface),
            Bind::Clock,
        ));
    });
}

pub fn spawn_home(mut commands: Commands, kit: Res<Kit>, shell: Res<Shell>, running: Res<Running>) {
    let t = &kit.theme;
    let visible: Vec<usize> = (0..shell.library.games.len()).take(RAIL_COUNT).collect();
    let focus_slot = visible
        .iter()
        .position(|&i| i == shell.selected)
        .unwrap_or(0);
    commands
        .spawn(root(Screen::Home, t.surface_dim))
        .with_children(|r| {
            r.spawn((
                Node {
                    width: percent(100),
                    height: percent(100),
                    position_type: PositionType::Absolute,
                    ..default()
                },
                ImageNode::default().with_color(Color::WHITE.with_alpha(0.0)),
                Cover,
                HeroBg {
                    fade: Spring::effects(0.0),
                    shown: None,
                },
            ));
            r.spawn((
                Node {
                    width: percent(100),
                    height: percent(100),
                    position_type: PositionType::Absolute,
                    ..default()
                },
                BackgroundGradient(vec![
                    LinearGradient::new(
                        LinearGradient::TO_RIGHT,
                        vec![
                            ColorStop::new(t.surface_dim.with_alpha(0.96), percent(0)),
                            ColorStop::new(t.surface_dim.with_alpha(0.72), percent(38)),
                            ColorStop::new(t.surface_dim.with_alpha(0.0), percent(78)),
                        ],
                    )
                    .into(),
                    LinearGradient::new(
                        LinearGradient::TO_TOP,
                        vec![
                            ColorStop::new(t.surface_dim, percent(0)),
                            ColorStop::new(t.surface_dim.with_alpha(0.0), percent(48)),
                        ],
                    )
                    .into(),
                ]),
            ));
            r.spawn(Node {
                width: percent(100),
                height: percent(100),
                position_type: PositionType::Absolute,
                flex_direction: FlexDirection::Column,
                padding: UiRect::axes(px(space::XXXL), px(space::XL + 8.0)),
                ..default()
            })
            .with_children(|col| {
                top_bar(col, &kit, &shell, Screen::Home);
                // Game rail (the focused tile scrolls to the left edge, PS5-style).
                col.spawn(Node {
                    width: percent(100),
                    height: px(RAIL_TILE.1 + 40.0),
                    margin: UiRect::top(px(space::XL)),
                    padding: UiRect::axes(px(8), px(20)),
                    overflow: Overflow::visible(),
                    ..default()
                })
                .with_children(|rail| {
                    rail.spawn((
                        Node {
                            column_gap: px(RAIL_GAP),
                            left: px(0),
                            ..default()
                        },
                        RailTrack(Spring::spatial(0.0)),
                    ))
                    .with_children(|track| {
                        for (slot, &index) in visible.iter().enumerate() {
                            tile(
                                track,
                                &kit,
                                &shell,
                                index,
                                slot,
                                RAIL_TILE,
                                slot == focus_slot,
                            );
                        }
                        track
                            .spawn((
                                Node {
                                    width: px(RAIL_TILE.0 * 0.7),
                                    height: px(RAIL_TILE.1),
                                    flex_direction: FlexDirection::Column,
                                    justify_content: JustifyContent::Center,
                                    align_items: AlignItems::Center,
                                    row_gap: px(space::SM),
                                    border_radius: radius(shape::LARGE),
                                    ..default()
                                },
                                BackgroundColor(t.surface_container_high.with_alpha(0.9)),
                                focusable(Action::Filter(None), 0.08),
                                GameTile {
                                    game: usize::MAX,
                                    slot: visible.len(),
                                },
                            ))
                            .with_children(|c| {
                                c.spawn(kit.icon("grid_view", 40.0, t.on_surface));
                                c.spawn(kit.text(
                                    format!("Library · {}", shell.library.games.len()),
                                    ts::LABEL,
                                    t.on_surface,
                                ));
                            });
                    });
                });
                // Hero information and actions.
                col.spawn(Node {
                    flex_direction: FlexDirection::Column,
                    row_gap: px(space::MD),
                    margin: UiRect::top(px(space::XL)),
                    max_width: px(1100),
                    ..default()
                })
                .with_children(|hero| {
                    hero.spawn((kit.text("", ts::DISPLAY, t.on_surface), Bind::HeroTitle));
                    hero.spawn((kit.text("", ts::BODY, t.on_surface_variant), Bind::HeroMeta));
                    hero.spawn(Node {
                        column_gap: px(space::MD),
                        margin: UiRect::top(px(space::SM)),
                        ..default()
                    })
                    .with_children(|row| {
                        button(
                            row,
                            &kit,
                            "play_arrow",
                            "Play",
                            true,
                            Action::Play(shell.selected),
                            HeroButton,
                        );
                        row.spawn((
                            Node {
                                width: px(64),
                                height: px(64),
                                justify_content: JustifyContent::Center,
                                align_items: AlignItems::Center,
                                border_radius: radius(shape::FULL),
                                ..default()
                            },
                            BackgroundColor(t.secondary_container),
                            focusable(Action::Hub(shell.selected), 0.1),
                            HeroHubButton,
                        ))
                        .with_children(|b| {
                            b.spawn(kit.icon("tune", 30.0, t.on_secondary_container));
                        });
                    });
                });
                col.spawn(Node {
                    flex_grow: 1.0,
                    ..default()
                });
                activity(col, &kit, &shell, &running);
            });
        });
}

/// Activity cards: resume points, the running external game, transfers, NVIDIA, last session.
fn activity(col: &mut ChildSpawnerCommands, kit: &Kit, shell: &Shell, running: &Running) {
    let t = &kit.theme;
    let mut cards: Vec<(String, String, &str, Action, Option<PathBuf>)> = Vec::new();
    if let Some(ext) = &running.external {
        cards.push((
            "Running".into(),
            ext.title.clone(),
            "sports_esports",
            Action::ReturnToGame,
            None,
        ));
    }
    for (i, game) in shell.library.games.iter().enumerate() {
        let suspended = Suspended::of(&shell.paths.states(), &game.key);
        if suspended.exists() && cards.len() < 2 {
            let label = if running.machine_key() == Some(game.key.as_str()) {
                "Suspended · instant"
            } else {
                "Resume"
            };
            cards.push((
                label.into(),
                game.title.clone(),
                "history",
                Action::Play(i),
                suspended.thumb.is_file().then_some(suspended.thumb),
            ));
        }
    }
    let transfers = shell.library.downloads.len();
    cards.push((
        "Downloads".into(),
        if transfers == 0 {
            format!("{} packages installed", shell.library.packages.len())
        } else {
            format!("{transfers} Steam transfers")
        },
        "download",
        Action::Go(Screen::Downloads),
        None,
    ));
    cards.push((
        "NVIDIA".into(),
        String::new(),
        "monitoring",
        Action::Quick(crate::app::QuickAction::Hud),
        None,
    ));
    let recent = shell.store.lock().unwrap().recent(1);
    if let Some((key, _, at, seconds)) = recent.first()
        && let Some((i, game)) = shell
            .library
            .games
            .iter()
            .enumerate()
            .find(|(_, g)| &g.key == key)
    {
        cards.push((
            format!("Last played · {:.0} min", seconds / 60.0),
            format!("{} · {}", game.title, at.get(..16).unwrap_or(at)),
            "videogame_asset",
            Action::Hub(i),
            None,
        ));
    }
    col.spawn(kit.text("Activity", ts::TITLE_MEDIUM, t.on_surface_variant));
    col.spawn(Node {
        column_gap: px(space::LG),
        margin: UiRect::top(px(space::MD)),
        ..default()
    })
    .with_children(|row| {
        for (title, body, icon, action, image) in cards.into_iter().take(4) {
            let gpu = title == "NVIDIA";
            row.spawn((
                Node {
                    width: px(400),
                    height: px(150),
                    padding: UiRect::all(px(space::LG)),
                    column_gap: px(space::MD),
                    align_items: AlignItems::Center,
                    overflow: Overflow::clip(),
                    border_radius: radius(shape::EXTRA_LARGE),
                    ..default()
                },
                BackgroundColor(t.surface_container.with_alpha(0.92)),
                BoxShadow::new(Color::BLACK.with_alpha(0.35), px(0), px(6), px(0), px(16)),
                focusable(action, 0.05),
            ))
            .with_children(|card| {
                if let Some(path) = image {
                    card.spawn((
                        Node {
                            width: px(150),
                            height: px(102),
                            flex_shrink: 0.0,
                            border_radius: radius(shape::MEDIUM),
                            ..default()
                        },
                        ImageNode::default(),
                        Cover,
                        ArtSlot(path),
                    ));
                } else {
                    card.spawn((
                        Node {
                            width: px(64),
                            height: px(64),
                            flex_shrink: 0.0,
                            justify_content: JustifyContent::Center,
                            align_items: AlignItems::Center,
                            border_radius: radius(shape::FULL),
                            ..default()
                        },
                        BackgroundColor(t.primary_container),
                    ))
                    .with_children(|c| {
                        c.spawn(kit.icon(icon, 34.0, t.on_primary_container));
                    });
                }
                card.spawn(Node {
                    flex_direction: FlexDirection::Column,
                    row_gap: px(space::XS),
                    ..default()
                })
                .with_children(|c| {
                    c.spawn(kit.text(title, ts::LABEL, t.primary));
                    if gpu {
                        c.spawn((kit.text("", ts::BODY_MEDIUM, t.on_surface), Bind::Gpu));
                    } else {
                        c.spawn(kit.text(body, ts::BODY_MEDIUM, t.on_surface));
                    }
                });
            });
        }
    });
}

pub fn spawn_library(mut commands: Commands, kit: Res<Kit>, shell: Res<Shell>) {
    let t = &kit.theme;
    let games = shell.visible_games();
    let focus = games.iter().position(|&i| i == shell.selected).unwrap_or(0);
    commands
        .spawn(root(Screen::Library, t.surface_dim))
        .with_children(|r| {
            r.spawn(Node {
                width: percent(100),
                height: percent(100),
                flex_direction: FlexDirection::Column,
                padding: UiRect::axes(px(space::XXXL), px(space::XL + 8.0)),
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
                    row.spawn(kit.text(
                        format!("{} games", games.len()),
                        ts::HEADLINE_SMALL,
                        t.on_surface,
                    ));
                    row.spawn(Node {
                        width: px(space::LG),
                        ..default()
                    });
                    for (label, filter) in [
                        ("All", None),
                        ("Steam", Some(Source::Steam)),
                        ("Emulators", Some(Source::Emulators)),
                        ("Web", Some(Source::Web)),
                    ] {
                        chip(
                            row,
                            &kit,
                            label,
                            shell.filter == filter,
                            Action::Filter(filter),
                        );
                    }
                });
                col.spawn((Node {
                    width: percent(100),
                    flex_grow: 1.0,
                    overflow: Overflow::clip(),
                    padding: UiRect::all(px(12)),
                    ..default()
                },))
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
                                    tile(
                                        grid,
                                        &kit,
                                        &shell,
                                        index,
                                        slot,
                                        (262.0, 122.0),
                                        slot == focus,
                                    );
                                }
                            });
                    });
            });
        });
}

pub fn spawn_hub(mut commands: Commands, kit: Res<Kit>, shell: Res<Shell>, running: Res<Running>) {
    let t = &kit.theme;
    let index = shell.hub;
    let Some(game) = shell.library.games.get(index) else {
        return;
    };
    let suspended = Suspended::of(&shell.paths.states(), &game.key);
    let active = running.machine_key() == Some(game.key.as_str());
    let hero = art_for(&shell, game, true);
    commands
        .spawn(root(Screen::Hub, t.surface_dim))
        .with_children(|r| {
            if let Some(path) = hero {
                r.spawn((
                    Node {
                        width: percent(100),
                        height: percent(100),
                        position_type: PositionType::Absolute,
                        ..default()
                    },
                    ImageNode::default().with_color(Color::WHITE.with_alpha(0.55)),
                    Cover,
                    ArtSlot(path),
                ));
            }
            r.spawn((
                Node {
                    width: percent(100),
                    height: percent(100),
                    position_type: PositionType::Absolute,
                    ..default()
                },
                BackgroundGradient::from(LinearGradient::new(
                    LinearGradient::TO_RIGHT,
                    vec![
                        ColorStop::new(t.surface_dim, percent(0)),
                        ColorStop::new(t.surface_dim.with_alpha(0.55), percent(70)),
                    ],
                )),
            ));
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
                    width: px(980),
                    ..default()
                })
                .with_children(|col| {
                    col.spawn(kit.text(&game.platform, ts::TITLE_MEDIUM, t.primary));
                    col.spawn(kit.text(&game.title, ts::DISPLAY, t.on_surface));
                    col.spawn((kit.text("", ts::BODY, t.on_surface_variant), Bind::HubState));
                    col.spawn(Node {
                        column_gap: px(space::MD),
                        margin: UiRect::vertical(px(space::LG)),
                        ..default()
                    })
                    .with_children(|actions| {
                        let label = if active || (game.is_native() && suspended.exists()) {
                            "Resume"
                        } else {
                            "Play"
                        };
                        button(
                            actions,
                            &kit,
                            "play_arrow",
                            label,
                            true,
                            Action::Play(index),
                            DefaultFocus,
                        );
                        if game.is_native() && (suspended.exists() || active) {
                            button(
                                actions,
                                &kit,
                                "replay",
                                "Start fresh",
                                false,
                                Action::Fresh(index),
                                (),
                            );
                        }
                        button(
                            actions,
                            &kit,
                            "arrow_back",
                            "Home",
                            false,
                            Action::Go(Screen::Home),
                            (),
                        );
                    });
                    col.spawn(kit.text("Game profile", ts::TITLE, t.on_surface));
                    let mut rows = vec![
                        ("speed", "Frame limit", ProfileField::FrameLimit),
                        ("aspect_ratio", "Scaling", ProfileField::Scaler),
                        ("history", "Instant resume", ProfileField::InstantResume),
                        ("monitoring", "Performance overlay", ProfileField::Hud),
                    ];
                    if !game.is_native() {
                        rows.insert(
                            0,
                            (
                                "fullscreen",
                                "Borderless full screen",
                                ProfileField::Borderless,
                            ),
                        );
                    }
                    for (icon, label, field) in rows {
                        setting_row(
                            col,
                            &kit,
                            icon,
                            label,
                            Action::Profile(index, field),
                            Bind::Profile(field),
                        );
                    }
                });
                row.spawn((
                    Node {
                        flex_direction: FlexDirection::Column,
                        row_gap: px(space::SM),
                        padding: UiRect::all(px(space::LG)),
                        width: px(560),
                        align_self: AlignSelf::FlexEnd,
                        border_radius: radius(shape::EXTRA_LARGE),
                        ..default()
                    },
                    BackgroundColor(t.surface_container.with_alpha(0.9)),
                ))
                .with_children(|panel| {
                    panel.spawn(kit.text("Details", ts::TITLE_MEDIUM, t.on_surface));
                    for line in details(game) {
                        panel.spawn(kit.text(line, ts::BODY_MEDIUM, t.on_surface_variant));
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
                "Launch: steam://rungameid".into()
            } else {
                "Not installed on this PC".into()
            });
        }
        Kind::Native { system, path, .. } => {
            lines.push(format!("Runs in Bun Engine ({system}), in-process"));
            lines.push(
                path.file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default(),
            );
        }
        Kind::Route { route, system, .. } => {
            lines.push(format!(
                "Route: {}",
                route.clone().unwrap_or_else(|| format!("{system} default"))
            ));
            lines.push("Release emulator from usr/ (bep)".into());
        }
        Kind::Web { core, systems } => {
            lines.push(format!("Browser core {core} ({})", systems.join(", ")));
        }
    }
    if game.size > 0 {
        lines.push(format!("Size: {:.1} MB", game.size as f64 / 1_048_576.0));
    }
    if let Some(d) = &game.developer {
        lines.push(format!("Developer: {d}"));
    }
    if let Some(y) = &game.year {
        lines.push(format!("Year: {y}"));
    }
    lines.push(format!("Played {} times", game.play_count));
    if let Some(last) = &game.last_played {
        lines.push(format!("Last played: {}", last.get(..16).unwrap_or(last)));
    }
    lines
}

/// A list row: icon, label, value (bound text) and a chevron.
pub fn setting_row(
    p: &mut ChildSpawnerCommands,
    kit: &Kit,
    icon: &str,
    label: &str,
    action: Action,
    bind: Bind,
) {
    let t = &kit.theme;
    p.spawn((
        Node {
            width: px(820),
            height: px(68),
            padding: UiRect::horizontal(px(space::LG)),
            column_gap: px(space::MD),
            align_items: AlignItems::Center,
            border_radius: radius(shape::LARGE),
            ..default()
        },
        BackgroundColor(t.surface_container_high.with_alpha(0.85)),
        focusable(action, 0.02),
    ))
    .with_children(|row| {
        row.spawn(kit.icon(icon, 28.0, t.on_surface_variant));
        row.spawn(kit.text(label, ts::BODY, t.on_surface));
        row.spawn(Node {
            flex_grow: 1.0,
            ..default()
        });
        row.spawn((kit.text("", ts::BODY, t.primary), bind));
        row.spawn(kit.icon("chevron_right", 26.0, t.on_surface_variant));
    });
}

pub fn spawn_downloads(mut commands: Commands, kit: Res<Kit>, shell: Res<Shell>) {
    let t = &kit.theme;
    commands
        .spawn(root(Screen::Downloads, t.surface_dim))
        .with_children(|r| {
            r.spawn(Node {
                width: percent(100),
                height: percent(100),
                flex_direction: FlexDirection::Column,
                padding: UiRect::axes(px(space::XXXL), px(space::XL + 8.0)),
                row_gap: px(space::LG),
                ..default()
            })
            .with_children(|col| {
                top_bar(col, &kit, &shell, Screen::Downloads);
                col.spawn(kit.text("Steam transfers", ts::HEADLINE_SMALL, t.on_surface));
                if shell.library.downloads.is_empty() {
                    col.spawn(kit.text(
                        "No download or update in progress.",
                        ts::BODY,
                        t.on_surface_variant,
                    ));
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
                        BackgroundColor(t.surface_container_high),
                        focusable(Action::Noop, 0.02),
                    ))
                    .insert_if(DefaultFocus, || i == 0)
                    .with_children(|c| {
                        c.spawn(kit.text(
                            format!("{} · {}", d.title, d.state),
                            ts::TITLE_MEDIUM,
                            t.on_surface,
                        ));
                        c.spawn((
                            Node {
                                width: percent(100),
                                height: px(8),
                                border_radius: radius(4.0),
                                ..default()
                            },
                            BackgroundColor(t.surface_container_highest),
                        ))
                        .with_children(|bar| {
                            bar.spawn((
                                Node {
                                    width: percent(progress * 100.0),
                                    height: percent(100),
                                    border_radius: radius(4.0),
                                    ..default()
                                },
                                BackgroundColor(t.primary),
                            ));
                        });
                        c.spawn(kit.text(
                            format!(
                                "{:.1} / {:.1} GB",
                                d.done as f64 / 1e9,
                                d.total as f64 / 1e9
                            ),
                            ts::BODY_MEDIUM,
                            t.on_surface_variant,
                        ));
                    });
                }
                col.spawn(kit.text(
                    "Emulators and cores installed by bep (usr/)",
                    ts::HEADLINE_SMALL,
                    t.on_surface,
                ));
                col.spawn(Node {
                    flex_wrap: FlexWrap::Wrap,
                    column_gap: px(space::MD),
                    row_gap: px(space::MD),
                    width: percent(100),
                    ..default()
                })
                .with_children(|grid| {
                    for (i, package) in shell.library.packages.iter().enumerate() {
                        grid.spawn((
                            Node {
                                width: px(330),
                                padding: UiRect::all(px(space::MD)),
                                flex_direction: FlexDirection::Column,
                                border_radius: radius(shape::LARGE),
                                ..default()
                            },
                            BackgroundColor(t.surface_container),
                            focusable(Action::Noop, 0.03),
                        ))
                        .insert_if(DefaultFocus, || {
                            i == 0 && shell.library.downloads.is_empty()
                        })
                        .with_children(|c| {
                            c.spawn(kit.text(&package.id, ts::TITLE_MEDIUM, t.on_surface));
                            c.spawn(kit.text(
                                format!(
                                    "{} · {}",
                                    package.version,
                                    package.installed_at.get(..10).unwrap_or("")
                                ),
                                ts::BODY_MEDIUM,
                                t.on_surface_variant,
                            ));
                        });
                    }
                });
            });
        });
}

pub fn spawn_settings(mut commands: Commands, kit: Res<Kit>, shell: Res<Shell>) {
    let t = &kit.theme;
    commands
        .spawn(root(Screen::Settings, t.surface_dim))
        .with_children(|r| {
            r.spawn(Node {
                width: percent(100),
                height: percent(100),
                flex_direction: FlexDirection::Column,
                padding: UiRect::axes(px(space::XXXL), px(space::XL + 8.0)),
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
                        row_gap: px(space::MD),
                        ..default()
                    })
                    .with_children(|list| {
                        list.spawn(kit.text("Console", ts::TITLE, t.on_surface));
                        let rows = [
                            ("music_note", "UI sounds", SettingKey::Sounds),
                            ("vibration", "Controller haptics", SettingKey::Haptics),
                            ("motion_photos_off", "Reduced motion", SettingKey::Motion),
                            ("monitoring", "Performance overlay", SettingKey::Hud),
                            ("library_books", "Reload library", SettingKey::Rescan),
                            (
                                "desktop_windows",
                                "Start at sign-in (opt-in)",
                                SettingKey::Session,
                            ),
                            ("logout", "Return to the desktop", SettingKey::Desktop),
                        ];
                        for (i, (icon, label, key)) in rows.into_iter().enumerate() {
                            list.spawn(Node::default()).with_children(|slot| {
                                setting_row(
                                    slot,
                                    &kit,
                                    icon,
                                    label,
                                    Action::Setting(key),
                                    Bind::Setting(key),
                                );
                            });
                            let _ = i;
                        }
                    });
                    row.spawn((
                        Node {
                            flex_direction: FlexDirection::Column,
                            row_gap: px(space::SM),
                            padding: UiRect::all(px(space::LG)),
                            width: px(700),
                            border_radius: radius(shape::EXTRA_LARGE),
                            ..default()
                        },
                        BackgroundColor(t.surface_container),
                    ))
                    .with_children(|about| {
                        about.spawn(kit.text("System", ts::TITLE, t.on_surface));
                        about.spawn((
                            kit.text("", ts::BODY_MEDIUM, t.on_surface_variant),
                            Bind::NvidiaPanel,
                        ));
                        about.spawn((
                            kit.text("", ts::BODY_MEDIUM, t.on_surface_variant),
                            Bind::DisplayPanel,
                        ));
                        about.spawn((
                            kit.text("", ts::BODY_MEDIUM, t.on_surface_variant),
                            Bind::SessionPanel,
                        ));
                    });
                });
            });
        });
}

pub fn spawn_playing(mut commands: Commands, kit: Res<Kit>, running: Res<Running>) {
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
            let _ = &kit;
        });
}

/// Keeps the machine image node on the latest handle and aspect ratio.
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
    let t = &kit.theme;
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
                BackgroundColor(t.surface_container_highest),
                BoxShadow::new(Color::BLACK.with_alpha(0.5), px(0), px(6), px(0), px(20)),
                UiTransform::IDENTITY,
                ToastBox(Spring::spatial(0.0)),
                Visibility::Hidden,
            ))
            .with_children(|b| {
                b.spawn((kit.text("", ts::BODY, t.on_surface), Bind::Toast));
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
            BackgroundColor(Color::BLACK.with_alpha(0.62)),
            GlobalZIndex(40),
            Visibility::Hidden,
            Bind::Hud,
        ))
        .with_children(|b| {
            b.spawn((kit.text("", ts::LABEL, Color::WHITE), Bind::Hud));
        });
}

/// Fill `ArtSlot` images once decoded.
pub fn fill_art(mut art: ResMut<Art>, mut slots: Query<(&ArtSlot, &mut ImageNode)>) {
    for (slot, mut image) in &mut slots {
        if image.image == Handle::default()
            && let Some(handle) = art.get(&slot.0)
        {
            image.image = handle;
        }
    }
}

/// Follow focus on game tiles: selected game, rail scroll and library scroll.
#[allow(clippy::type_complexity)]
pub fn follow_focus(
    focus: Res<bevy::input_focus::InputFocus>,
    tiles: Query<&GameTile>,
    mut shell: ResMut<Shell>,
    mut rails: Query<&mut RailTrack>,
    mut grids: Query<(&mut LibraryScroll, &ComputedNode)>,
) {
    if !focus.is_changed() {
        return;
    }
    let Some(tile) = focus.get().and_then(|e| tiles.get(e).ok()) else {
        return;
    };
    if tile.game != usize::MAX {
        shell.selected = tile.game;
    }
    for mut rail in &mut rails {
        rail.0.target = -((tile.slot as f32) * (RAIL_TILE.0 + RAIL_GAP));
    }
    for (mut grid, _) in &mut grids {
        let per_row = 6.0;
        let row = (tile.slot as f32 / per_row).floor();
        grid.0.target = -(row - 1.0).max(0.0) * (122.0 + space::LG);
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

/// Hero art crossfade and hero texts/actions for the selected game.
#[allow(clippy::too_many_arguments)]
pub fn update_hero(
    time: Res<Time>,
    motion: Res<Motion>,
    shell: Res<Shell>,
    running: Res<Running>,
    mut art: ResMut<Art>,
    mut bg: Query<(&mut HeroBg, &mut ImageNode)>,
    mut play: Query<&mut Focusable, (With<HeroButton>, Without<HeroHubButton>)>,
    mut hub: Query<&mut Focusable, (With<HeroHubButton>, Without<HeroButton>)>,
    children: Query<&Children>,
    mut texts: Query<(&mut Text, Option<&Bind>)>,
    buttons: Query<Entity, With<HeroButton>>,
) {
    let Some(game) = shell.library.games.get(shell.selected) else {
        return;
    };
    let wanted = art_for(&shell, game, true);
    for (mut hero, mut image) in &mut bg {
        if hero.shown != wanted {
            if let Some(path) = &wanted {
                if let Some(handle) = art.get(path) {
                    image.image = handle;
                    hero.shown = wanted.clone();
                    hero.fade.state.value = 0.0;
                    hero.fade.target = 0.85;
                }
            } else {
                hero.shown = None;
                hero.fade.target = 0.0;
            }
        }
        hero.fade.step(time.delta_secs(), motion.reduced);
        image.color = Color::WHITE.with_alpha(hero.fade.value().clamp(0.0, 1.0));
    }
    for mut f in &mut play {
        if f.0 != crate::app::Action::Play(shell.selected) {
            f.0 = crate::app::Action::Play(shell.selected);
        }
    }
    for mut f in &mut hub {
        if f.0 != crate::app::Action::Hub(shell.selected) {
            f.0 = crate::app::Action::Hub(shell.selected);
        }
    }
    let label = play_label(&shell, &running, shell.selected);
    for button in &buttons {
        for child in children.iter_descendants(button) {
            if let Ok((mut text, None)) = texts.get_mut(child)
                && text.0 != label
            {
                text.0 = label.clone();
            }
        }
    }
}

pub fn play_label(shell: &Shell, running: &Running, index: usize) -> String {
    let Some(game) = shell.library.games.get(index) else {
        return "Play".into();
    };
    if running.external.as_ref().is_some_and(|e| e.key == game.key) {
        return "Return to game".into();
    }
    if running.machine_key() == Some(game.key.as_str())
        || (game.is_native() && Suspended::of(&shell.paths.states(), &game.key).exists())
    {
        return "Resume".into();
    }
    match game.kind {
        Kind::Steam {
            installed: false, ..
        } => "View in Steam".into(),
        Kind::Web { .. } => "Open".into(),
        _ => "Play".into(),
    }
}

fn hero_meta(shell: &Shell, game: &Game) -> String {
    let mut parts = vec![game.platform.clone()];
    if let Some(y) = &game.year {
        parts.push(y.clone());
    }
    if let Some(d) = &game.developer {
        parts.push(d.clone());
    }
    if game.is_native() {
        parts.push(
            if Suspended::of(&shell.paths.states(), &game.key).exists() {
                "Instant resume ready".into()
            } else {
                "Bun Engine".into()
            },
        );
    }
    if let Some(last) = &game.last_played {
        parts.push(format!("Last played {}", last.get(..10).unwrap_or(last)));
    }
    parts.join("  ·  ")
}

/// Every `Bind` text, refreshed at 4 Hz (the clock, NVIDIA and values) or on change.
#[allow(clippy::too_many_arguments)]
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
    mut texts: Query<(&mut Text, &Bind)>,
    mut huds: Query<&mut Visibility, (With<Bind>, Without<Text>, Without<ToastBox>)>,
    mut toasts: Query<(&mut Visibility, &mut ToastBox, &mut UiTransform), Without<Bind>>,
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
        transform.translation = Val2::px(0.0, (1.0 - v) * 40.0);
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
            shell.library.games.get(shell.hub).map_or_else(
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
    let onoff = |b: bool| if b { "On" } else { "Off" }.to_string();
    let limit = |fps: u32| {
        if fps == 0 {
            "Display rate".to_string()
        } else {
            format!("{fps} fps")
        }
    };
    let scaler = |s: &str| match s {
        "smooth" => "Smooth (bilinear)".to_string(),
        "fsr1" => "FSR 1 (EASU + RCAS)".to_string(),
        _ => "Sharp (nearest)".to_string(),
    };
    for (mut text, bind) in &mut texts {
        let value = match bind {
            Bind::Clock => crate::app::clock(),
            Bind::Gpu => gpu.summary(),
            Bind::HeroTitle => shell
                .library
                .games
                .get(shell.selected)
                .map(|g| g.title.clone())
                .unwrap_or_default(),
            Bind::HeroMeta => shell
                .library
                .games
                .get(shell.selected)
                .map(|g| hero_meta(&shell, g))
                .unwrap_or_default(),
            Bind::HeroPlay => play_label(&shell, &running, shell.selected),
            Bind::Toast => shell
                .toast
                .as_ref()
                .map(|(m, _)| m.clone())
                .unwrap_or_default(),
            Bind::Hud => {
                let mut lines = vec![format!(
                    "UI {:.0} fps · {:.2} ms (p99 {:.2})",
                    stats.fps(),
                    stats.mean_ms(),
                    stats.p99_ms()
                )];
                if let Some(i) = &info {
                    lines.push(format!(
                        "{} {:.1} fps · {:.2} ms/frame",
                        i.name, i.fps, i.frame_ms
                    ));
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
                SettingKey::Sounds => onoff(settings.sounds),
                SettingKey::Haptics => onoff(settings.haptics),
                SettingKey::Hud => onoff(settings.hud),
                SettingKey::Motion => match settings.motion {
                    MotionPref::System => format!(
                        "System ({})",
                        if motion.reduced { "reduced" } else { "full" }
                    ),
                    MotionPref::Reduced => "Reduced".into(),
                    MotionPref::Full => "Full".into(),
                },
                SettingKey::Rescan => format!("{} games", shell.library.games.len()),
                SettingKey::Session => {
                    #[cfg(windows)]
                    {
                        if crate::system::session_entry().is_some() {
                            "Registered".into()
                        } else {
                            "Not registered".into()
                        }
                    }
                    #[cfg(not(windows))]
                    {
                        String::new()
                    }
                }
                SettingKey::Desktop => {
                    if shell.session {
                        "Session".into()
                    } else {
                        "Window".into()
                    }
                }
            },
            Bind::QuickValue(action) => {
                use crate::app::QuickAction as Q;
                match action {
                    Q::Hud => onoff(settings.hud),
                    Q::FrameLimit => limit(profile.fps_limit),
                    Q::Scaling => scaler(&profile.scaler),
                    Q::Record => {
                        if running.recorder.is_some() {
                            "Recording".into()
                        } else {
                            "Off".into()
                        }
                    }
                    Q::VolumeDown | Q::VolumeUp => shell
                        .volume
                        .map(|v| format!("{:.0}%", v * 100.0))
                        .unwrap_or_default(),
                    _ => String::new(),
                }
            }
            Bind::NvidiaPanel => {
                if gpu.available {
                    let vrr = gpu.vrr.map_or("unknown".into(), |(on, possible, active)| {
                        format!(
                            "{} ({}{})",
                            if on { "enabled" } else { "disabled" },
                            if possible { "capable" } else { "not capable" },
                            if active { ", active" } else { "" }
                        )
                    });
                    format!(
                        "{}\nDriver {}\n{}°C · core {} MHz · memory {} MHz · load {}%\nPower {:.0} W of {:.0} W · VRAM {} / {} MB\nG-SYNC/VRR: {vrr}\nReflex low latency: {}",
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
                            "driver API present (games enable it)"
                        } else {
                            "not exposed"
                        },
                    )
                } else {
                    gpu.summary()
                }
            }
            Bind::DisplayPanel => format!(
                "Display: {}\nCapture: {}",
                shell.display.summary(),
                shell
                    .encoders
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "no hardware encoder found".into())
            ),
            Bind::SessionPanel => match (&info, &running.external) {
                (Some(i), _) => format!(
                    "{}: {:.1} fps, {:.2} ms per frame{}{}",
                    i.name,
                    i.fps,
                    i.frame_ms,
                    if i.paused { ", suspended" } else { "" },
                    if i.resumed_from_disk {
                        ", resumed from disk"
                    } else {
                        ""
                    }
                ),
                (None, Some(ext)) => format!(
                    "{} running ({:.0} s)",
                    ext.title,
                    ext.started.elapsed().as_secs_f32()
                ),
                _ => format!(
                    "Shell {} · {}",
                    if shell.session { "session" } else { "window" },
                    env!("CARGO_PKG_VERSION")
                ),
            },
            Bind::HubState => shell
                .library
                .games
                .get(shell.hub)
                .map(|g| {
                    let s = Suspended::of(&shell.paths.states(), &g.key);
                    if running.machine_key() == Some(g.key.as_str()) {
                        "Suspended in memory: resumes instantly".to_string()
                    } else if s.exists() {
                        "Suspend state on disk: resumes where you left".to_string()
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

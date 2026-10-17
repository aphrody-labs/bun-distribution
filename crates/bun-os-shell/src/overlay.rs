//! The quick menu (Guide button) and the power dialog, drawn over any screen or game.

use bevy::prelude::*;

use crate::app::{Action, Overlay, PowerAction, QuickAction, Shell};
use crate::runtime::Running;
use crate::screens::Bind;
use crate::theme::{shape, space, typescale as ts};
use crate::ui::{DefaultFocus, FocusFx, Focusable, Kit, Layer, Motion, Spring, radius};

#[derive(Component)]
pub struct Sheet(pub Spring);

fn overlay_focusable(action: Action) -> impl Bundle {
    (
        Focusable(action),
        FocusFx::new(0.07),
        UiTransform::IDENTITY,
        Outline {
            width: px(3),
            offset: px(4),
            color: Color::NONE,
        },
        Layer::Overlay,
    )
}

fn card(
    p: &mut bevy::ecs::hierarchy::ChildSpawnerCommands,
    kit: &Kit,
    icon: &str,
    label: &str,
    action: QuickAction,
    initial: bool,
) {
    let t = &kit.theme;
    let mut e = p.spawn((
        Node {
            width: px(150),
            height: px(132),
            flex_direction: FlexDirection::Column,
            justify_content: JustifyContent::Center,
            align_items: AlignItems::Center,
            row_gap: px(space::XS),
            border_radius: radius(shape::LARGE),
            ..default()
        },
        BackgroundColor(t.surface_container_highest),
        overlay_focusable(Action::Quick(action)),
    ));
    if initial {
        e.insert(DefaultFocus);
    }
    e.with_children(|c| {
        c.spawn(kit.icon(icon, 36.0, t.on_surface));
        c.spawn(kit.text(label, ts::LABEL, t.on_surface));
        c.spawn((
            kit.text("", ts::LABEL_SMALL, t.primary),
            Bind::QuickValue(action),
        ));
    });
}

pub fn spawn_quick(
    mut commands: Commands,
    kit: Res<Kit>,
    running: Res<Running>,
    shell: Res<Shell>,
) {
    let t = &kit.theme;
    let in_game = running.machine.is_some() || running.external.is_some();
    commands
        .spawn((
            Node {
                width: percent(100),
                height: percent(100),
                position_type: PositionType::Absolute,
                ..default()
            },
            BackgroundColor(t.scrim.with_alpha(0.55)),
            GlobalZIndex(20),
            DespawnOnExit(Overlay::Quick),
        ))
        .with_children(|r| {
            r.spawn((
                Node {
                    position_type: PositionType::Absolute,
                    bottom: px(0),
                    width: percent(100),
                    flex_direction: FlexDirection::Column,
                    row_gap: px(space::LG),
                    padding: UiRect::axes(px(space::XXXL), px(space::XL)),
                    border_radius: BorderRadius::top(px(shape::EXTRA_LARGE)),
                    ..default()
                },
                BackgroundColor(t.surface_container),
                BoxShadow::new(Color::BLACK.with_alpha(0.5), px(0), px(-8), px(0), px(32)),
                UiTransform::from_translation(Val2::px(0.0, 480.0)),
                Sheet(Spring::spatial(1.0)),
            ))
            .with_children(|sheet| {
                sheet
                    .spawn(Node {
                        align_items: AlignItems::Center,
                        column_gap: px(space::MD),
                        ..default()
                    })
                    .with_children(|row| {
                        row.spawn(kit.icon("sports_esports", 34.0, t.primary));
                        let title = running
                            .machine_game
                            .or_else(|| {
                                running.external.as_ref().and_then(|e| {
                                    shell.library.games.iter().position(|g| g.key == e.key)
                                })
                            })
                            .and_then(|i| shell.library.games.get(i))
                            .map_or_else(|| "Quick menu".to_string(), |g| g.title.clone());
                        row.spawn(kit.text(title, ts::HEADLINE_SMALL, t.on_surface));
                        row.spawn(Node {
                            flex_grow: 1.0,
                            ..default()
                        });
                        row.spawn((
                            kit.text(crate::app::clock(), ts::TITLE, t.on_surface),
                            Bind::Clock,
                        ));
                    });
                sheet
                    .spawn(Node {
                        column_gap: px(space::MD),
                        flex_wrap: FlexWrap::Wrap,
                        row_gap: px(space::MD),
                        ..default()
                    })
                    .with_children(|row| {
                        card(row, &kit, "home", "Home", QuickAction::Home, !in_game);
                        if in_game {
                            card(row, &kit, "play_arrow", "Resume", QuickAction::Resume, true);
                            card(
                                row,
                                &kit,
                                "close",
                                "Close game",
                                QuickAction::CloseGame,
                                false,
                            );
                        }
                        card(
                            row,
                            &kit,
                            "photo_camera",
                            "Screenshot",
                            QuickAction::Screenshot,
                            false,
                        );
                        card(
                            row,
                            &kit,
                            "radio_button_checked",
                            "Record",
                            QuickAction::Record,
                            false,
                        );
                        card(
                            row,
                            &kit,
                            "monitoring",
                            "Performance",
                            QuickAction::Hud,
                            false,
                        );
                        card(
                            row,
                            &kit,
                            "speed",
                            "Frame limit",
                            QuickAction::FrameLimit,
                            false,
                        );
                        card(
                            row,
                            &kit,
                            "aspect_ratio",
                            "Scaling",
                            QuickAction::Scaling,
                            false,
                        );
                        card(
                            row,
                            &kit,
                            "volume_down",
                            "Volume",
                            QuickAction::VolumeDown,
                            false,
                        );
                        card(
                            row,
                            &kit,
                            "volume_up",
                            "Volume",
                            QuickAction::VolumeUp,
                            false,
                        );
                        card(
                            row,
                            &kit,
                            "power_settings_new",
                            "Power",
                            QuickAction::Power,
                            false,
                        );
                    });
                sheet
                    .spawn(Node {
                        column_gap: px(space::LG),
                        ..default()
                    })
                    .with_children(|row| {
                        for (icon, title, bind) in [
                            ("memory", "NVIDIA", Bind::NvidiaPanel),
                            ("hdr_on", "Display and capture", Bind::DisplayPanel),
                            ("graphic_eq", "Session", Bind::SessionPanel),
                        ] {
                            row.spawn((
                                Node {
                                    flex_direction: FlexDirection::Column,
                                    row_gap: px(space::SM),
                                    padding: UiRect::all(px(space::LG)),
                                    width: px(580),
                                    border_radius: radius(shape::LARGE),
                                    ..default()
                                },
                                BackgroundColor(t.surface_container_high),
                            ))
                            .with_children(|panel| {
                                panel
                                    .spawn(Node {
                                        column_gap: px(space::SM),
                                        align_items: AlignItems::Center,
                                        ..default()
                                    })
                                    .with_children(|h| {
                                        h.spawn(kit.icon(icon, 28.0, t.tertiary));
                                        h.spawn(kit.text(title, ts::TITLE_MEDIUM, t.on_surface));
                                    });
                                panel.spawn((
                                    kit.text("", ts::BODY_MEDIUM, t.on_surface_variant),
                                    bind,
                                ));
                            });
                        }
                    });
            });
        });
}

pub fn spawn_power(mut commands: Commands, kit: Res<Kit>, shell: Res<Shell>) {
    let t = &kit.theme;
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
            BackgroundColor(t.scrim.with_alpha(0.65)),
            GlobalZIndex(25),
            DespawnOnExit(Overlay::Power),
        ))
        .with_children(|r| {
            r.spawn((
                Node {
                    flex_direction: FlexDirection::Column,
                    row_gap: px(space::MD),
                    padding: UiRect::all(px(space::XL)),
                    width: px(620),
                    border_radius: radius(shape::EXTRA_LARGE),
                    ..default()
                },
                BackgroundColor(t.surface_container_high),
            ))
            .with_children(|d| {
                d.spawn(kit.text("Power", ts::HEADLINE_SMALL, t.on_surface));
                let desktop = if shell.session {
                    "Return to the desktop"
                } else {
                    "Close Bun OS"
                };
                for (icon, label, action) in [
                    ("arrow_back", "Cancel", PowerAction::Cancel),
                    ("logout", desktop, PowerAction::Desktop),
                    ("bedtime", "Sleep", PowerAction::Sleep),
                    ("restart_alt", "Restart", PowerAction::Restart),
                    ("power_settings_new", "Shut down", PowerAction::Shutdown),
                ] {
                    let mut e = d.spawn((
                        Node {
                            height: px(64),
                            padding: UiRect::horizontal(px(space::LG)),
                            column_gap: px(space::MD),
                            align_items: AlignItems::Center,
                            border_radius: radius(shape::LARGE),
                            ..default()
                        },
                        BackgroundColor(t.surface_container_highest),
                        overlay_focusable(Action::Power(action)),
                    ));
                    if action == PowerAction::Cancel {
                        e.insert(DefaultFocus);
                    }
                    e.with_children(|b| {
                        b.spawn(kit.icon(icon, 30.0, t.on_surface));
                        b.spawn(kit.text(label, ts::TITLE_MEDIUM, t.on_surface));
                    });
                }
            });
        });
}

/// Quick-menu sheet slides up on the M3 spatial spring.
pub fn animate_sheet(
    time: Res<Time>,
    motion: Res<Motion>,
    mut sheets: Query<(&mut Sheet, &mut UiTransform)>,
) {
    for (mut sheet, mut transform) in &mut sheets {
        sheet.0.target = 0.0;
        sheet.0.step(time.delta_secs(), motion.reduced);
        transform.translation = Val2::px(0.0, sheet.0.value() * 480.0);
    }
}

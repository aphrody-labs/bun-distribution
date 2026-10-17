//! The quick menu (Guide button), a side sheet that slides in over a scrim (DIRECTION.md), and
//! the power dialog. Both sit above any screen or game.

use bevy::ecs::hierarchy::ChildSpawnerCommands;
use bevy::prelude::*;

use crate::app::{Action, Overlay, PowerAction, QuickAction, Shell};
use crate::runtime::Running;
use crate::screens::Bind;
use crate::text::t;
use crate::theme::{R, icon, shape, size, space, typescale as ts};
use crate::ui::{
    DefaultFocus, FocusFx, Focusable, Kit, Layer, Motion, Spring, a11y_button, bg, bg_alpha,
    radius, ring,
};

/// The quick menu sheet: slides from the right edge.
#[derive(Component)]
pub struct Sheet(pub Spring);

fn overlay_focusable(action: Action, label: &str) -> impl Bundle {
    (
        Focusable(action),
        FocusFx::new(0.02),
        UiTransform::IDENTITY,
        ring(),
        Layer::Overlay,
        a11y_button(label),
    )
}

/// One quick-menu row: icon, label, live value.
fn row(
    p: &mut ChildSpawnerCommands,
    kit: &Kit,
    glyph: &str,
    key: &str,
    action: QuickAction,
    initial: bool,
) {
    let label = t(key);
    let mut e = p.spawn((
        Node {
            height: px(size::TARGET),
            padding: UiRect::horizontal(px(space::MD)),
            column_gap: px(space::MD),
            align_items: AlignItems::Center,
            border_radius: radius(shape::FULL),
            ..default()
        },
        bg_alpha(R::ContainerHighest, 0.0),
        overlay_focusable(Action::Quick(action), &label),
    ));
    if initial {
        e.insert(DefaultFocus);
    }
    e.with_children(|c| {
        c.spawn(kit.icon(glyph, icon::MD, R::OnSurfaceVariant));
        c.spawn(kit.text(label, ts::BODY, R::OnSurface));
        c.spawn(Node {
            flex_grow: 1.0,
            ..default()
        });
        c.spawn((
            kit.text("", ts::BODY_MEDIUM, R::Primary),
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
    let in_game = running.machine.is_some() || running.external.is_some();
    let title = running
        .machine_game
        .or_else(|| {
            running
                .external
                .as_ref()
                .and_then(|e| shell.library.games.iter().position(|g| g.key == e.key))
        })
        .and_then(|i| shell.library.games.get(i))
        .map_or_else(|| t("quick.title"), |g| g.title.clone());
    commands
        .spawn((
            Node {
                width: percent(100),
                height: percent(100),
                position_type: PositionType::Absolute,
                justify_content: JustifyContent::FlexEnd,
                ..default()
            },
            bg_alpha(R::Scrim, 0.5),
            GlobalZIndex(20),
            DespawnOnExit(Overlay::Quick),
        ))
        .with_children(|r| {
            r.spawn((
                Node {
                    width: px(size::QUICK_WIDTH),
                    height: percent(100),
                    flex_direction: FlexDirection::Column,
                    row_gap: px(space::XS),
                    padding: UiRect::axes(px(space::LG), px(space::XL)),
                    border_radius: BorderRadius::left(px(shape::LARGE)),
                    ..default()
                },
                bg(R::Container),
                UiTransform::from_translation(Val2::px(size::QUICK_WIDTH, 0.0)),
                Sheet(Spring::spatial(1.0)),
            ))
            .with_children(|sheet| {
                sheet
                    .spawn(Node {
                        align_items: AlignItems::Center,
                        column_gap: px(space::MD),
                        margin: UiRect::bottom(px(space::MD)),
                        ..default()
                    })
                    .with_children(|head| {
                        head.spawn(kit.text(title, ts::HEADLINE_SMALL, R::OnSurface));
                        head.spawn(Node {
                            flex_grow: 1.0,
                            ..default()
                        });
                        head.spawn((
                            kit.text(crate::app::clock(), ts::TITLE, R::OnSurface),
                            Bind::Clock,
                        ));
                    });
                if in_game {
                    row(
                        sheet,
                        &kit,
                        "play_arrow",
                        "action.resume",
                        QuickAction::Resume,
                        true,
                    );
                }
                row(
                    sheet,
                    &kit,
                    "home",
                    "action.home",
                    QuickAction::Home,
                    !in_game,
                );
                if in_game {
                    row(
                        sheet,
                        &kit,
                        "close",
                        "action.close-game",
                        QuickAction::CloseGame,
                        false,
                    );
                }
                for (glyph, key, action) in [
                    ("photo_camera", "action.screenshot", QuickAction::Screenshot),
                    ("radio_button_checked", "action.record", QuickAction::Record),
                    ("monitoring", "action.performance", QuickAction::Hud),
                    ("speed", "action.frame-limit", QuickAction::FrameLimit),
                    ("aspect_ratio", "action.scaling", QuickAction::Scaling),
                    ("volume_down", "action.volume-down", QuickAction::VolumeDown),
                    ("volume_up", "action.volume-up", QuickAction::VolumeUp),
                    ("power_settings_new", "nav.power", QuickAction::Power),
                ] {
                    row(sheet, &kit, glyph, key, action, false);
                }
                for (glyph, key, bind) in [
                    ("memory", "quick.nvidia", Bind::NvidiaPanel),
                    ("hdr_on", "quick.display", Bind::DisplayPanel),
                ] {
                    sheet
                        .spawn(Node {
                            flex_direction: FlexDirection::Column,
                            row_gap: px(space::XS),
                            margin: UiRect::top(px(space::MD)),
                            ..default()
                        })
                        .with_children(|panel| {
                            panel
                                .spawn(Node {
                                    column_gap: px(space::SM),
                                    align_items: AlignItems::Center,
                                    ..default()
                                })
                                .with_children(|h| {
                                    h.spawn(kit.icon(glyph, icon::SM, R::Primary));
                                    h.spawn(kit.text(t(key), ts::LABEL, R::Primary));
                                });
                            panel.spawn((kit.text("", ts::BODY_MEDIUM, R::OnSurfaceVariant), bind));
                        });
                }
            });
        });
}

pub fn spawn_power(mut commands: Commands, kit: Res<Kit>, shell: Res<Shell>) {
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
            bg_alpha(R::Scrim, 0.65),
            GlobalZIndex(25),
            DespawnOnExit(Overlay::Power),
        ))
        .with_children(|r| {
            r.spawn((
                Node {
                    flex_direction: FlexDirection::Column,
                    row_gap: px(space::SM),
                    padding: UiRect::all(px(space::XL)),
                    width: px(size::QUICK_WIDTH),
                    border_radius: radius(shape::EXTRA_LARGE),
                    ..default()
                },
                bg(R::ContainerHigh),
            ))
            .with_children(|d| {
                d.spawn(kit.text(t("power.title"), ts::HEADLINE_SMALL, R::OnSurface));
                let desktop = if shell.session {
                    "action.desktop"
                } else {
                    "action.close-shell"
                };
                for (glyph, key, action) in [
                    ("arrow_back", "action.cancel", PowerAction::Cancel),
                    ("logout", desktop, PowerAction::Desktop),
                    ("bedtime", "action.sleep", PowerAction::Sleep),
                    ("restart_alt", "action.restart-pc", PowerAction::Restart),
                    (
                        "power_settings_new",
                        "action.shutdown",
                        PowerAction::Shutdown,
                    ),
                ] {
                    let label = t(key);
                    let mut e = d.spawn((
                        Node {
                            height: px(size::TARGET),
                            padding: UiRect::horizontal(px(space::LG)),
                            column_gap: px(space::MD),
                            align_items: AlignItems::Center,
                            border_radius: radius(shape::FULL),
                            ..default()
                        },
                        bg(R::ContainerHighest),
                        overlay_focusable(Action::Power(action), &label),
                    ));
                    if action == PowerAction::Cancel {
                        e.insert(DefaultFocus);
                    }
                    e.with_children(|b| {
                        b.spawn(kit.icon(glyph, icon::MD, R::OnSurface));
                        b.spawn(kit.text(label, ts::TITLE_MEDIUM, R::OnSurface));
                    });
                }
            });
        });
}

/// The quick-menu sheet slides in from the right on the M3 spatial spring (input response).
pub fn animate_sheet(
    time: Res<Time>,
    motion: Res<Motion>,
    mut sheets: Query<(&mut Sheet, &mut UiTransform)>,
) {
    for (mut sheet, mut transform) in &mut sheets {
        sheet.0.target = 0.0;
        sheet.0.step(time.delta_secs(), motion.reduced);
        transform.translation = Val2::px(sheet.0.value() * size::QUICK_WIDTH, 0.0);
    }
}

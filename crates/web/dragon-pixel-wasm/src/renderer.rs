// SPDX-License-Identifier: Apache-2.0
//! Bevy scene adapter for the browser combat snapshot.
use std::cell::RefCell;

use aphrody_dragon_pixel_core::{Game, Shot};
use bevy::{prelude::*, window::WindowPlugin};
use serde::Deserialize;
use wasm_bindgen::JsValue;

const ENEMIES: usize = 6;
const REMOTES: usize = 4;
const SHOTS: usize = 24;

thread_local! {
    static SNAPSHOT: RefCell<Snapshot> = RefCell::new(Snapshot::default());
    static READY: RefCell<bool> = const { RefCell::new(false) };
}

#[derive(Clone, Deserialize)]
struct Avatar {
    #[serde(default = "default_skin")]
    skin: String,
    #[serde(default = "default_hair")]
    hair: String,
    #[serde(default = "default_outfit")]
    outfit: String,
}

#[derive(Clone, Deserialize)]
struct Remote {
    x: f32,
    y: f32,
    avatar: Avatar,
}

#[derive(Clone)]
struct Snapshot {
    game: Game,
    avatar: Avatar,
    remotes: Vec<Remote>,
}

impl Default for Snapshot {
    fn default() -> Self {
        Self { game: Game::new("balanced"), avatar: Avatar::default(), remotes: Vec::new() }
    }
}

impl Default for Avatar {
    fn default() -> Self {
        Self { skin: default_skin(), hair: default_hair(), outfit: default_outfit() }
    }
}

fn default_skin() -> String {
    "#f0c19a".into()
}
fn default_hair() -> String {
    "#242b46".into()
}
fn default_outfit() -> String {
    "#63e6ff".into()
}

#[derive(Component)]
struct Actor(ActorKind, usize);

#[derive(Clone, Copy)]
enum ActorKind {
    Player,
    Skin,
    Hair,
    Enemy,
    Remote,
    Shot,
}

pub(super) fn update(json: &str) -> Result<(), JsValue> {
    #[derive(Deserialize)]
    struct InputSnapshot {
        game: Game,
        avatar: Avatar,
        #[serde(default)]
        remotes: Vec<Remote>,
    }
    let input: InputSnapshot = serde_json::from_str(json)
        .map_err(|error| JsValue::from_str(&format!("invalid Bevy scene snapshot: {error}")))?;
    SNAPSHOT.with(|snapshot| {
        *snapshot.borrow_mut() = Snapshot {
            game: input.game,
            avatar: input.avatar,
            remotes: input.remotes.into_iter().take(REMOTES).collect(),
        };
    });
    Ok(())
}

pub(super) fn is_ready() -> bool {
    READY.with(|ready| *ready.borrow())
}

pub(super) fn start() -> Result<(), JsValue> {
    let mut app = App::new();
    app.add_plugins(DefaultPlugins.set(WindowPlugin {
        primary_window: Some(Window {
            canvas: Some("#arena-bevy".into()),
            fit_canvas_to_parent: true,
            prevent_default_event_handling: true,
            ..default()
        }),
        ..default()
    }))
    .add_systems(Startup, setup)
    .add_systems(Update, sync_scene);
    app.run();
    Ok(())
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    commands.spawn((
        Mesh3d(meshes.add(Plane3d::default().mesh().size(16.0, 8.0))),
        MeshMaterial3d(materials.add(Color::srgb(0.12, 0.19, 0.28))),
        Transform::from_xyz(0.0, 0.0, 0.0),
    ));
    commands.spawn((
        PointLight { intensity: 2_400_000.0, shadow_maps_enabled: true, ..default() },
        Transform::from_xyz(2.0, 8.0, 5.0),
    ));
    commands.spawn((
        Camera3d::default(),
        Transform::from_xyz(0.0, 7.0, 12.0).looking_at(Vec3::new(0.0, 1.0, 0.0), Vec3::Y),
    ));

    for (kind, count) in [
        (ActorKind::Player, 1),
        (ActorKind::Skin, 1),
        (ActorKind::Hair, 1),
        (ActorKind::Enemy, ENEMIES),
        (ActorKind::Remote, REMOTES),
        (ActorKind::Shot, SHOTS),
    ] {
        for index in 0..count {
            let color = match kind {
                ActorKind::Player => Color::srgb(0.39, 0.9, 1.0),
                ActorKind::Skin => Color::srgb(0.94, 0.76, 0.6),
                ActorKind::Hair => Color::srgb(0.1, 0.1, 0.16),
                ActorKind::Enemy => Color::srgb(0.98, 0.35, 0.48),
                ActorKind::Remote => Color::srgb(0.85, 0.75, 1.0),
                ActorKind::Shot => Color::srgb(0.48, 1.0, 0.94),
            };
            let mesh = match kind {
                ActorKind::Shot => meshes.add(Sphere::new(0.14).mesh().uv(12, 8)),
                ActorKind::Skin | ActorKind::Hair => meshes.add(Sphere::new(0.25).mesh().uv(12, 8)),
                _ => meshes.add(Capsule3d::new(0.3, 0.8)),
            };
            commands.spawn((
                Mesh3d(mesh),
                MeshMaterial3d(materials.add(StandardMaterial { base_color: color, ..default() })),
                Transform::from_xyz(0.0, -50.0, 0.0),
                Visibility::Hidden,
                Actor(kind, index),
            ));
        }
    }
}

fn sync_scene(
    mut query: Query<(&Actor, &mut Transform, &mut Visibility, &MeshMaterial3d<StandardMaterial>)>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    READY.with(|ready| *ready.borrow_mut() = true);
    let snapshot = SNAPSHOT.with(|state| state.borrow().clone());
    for (actor, mut transform, mut visibility, material) in &mut query {
        let (position, color, facing, active) = match actor.0 {
            ActorKind::Player => (
                actor_position(snapshot.game.player.x, snapshot.game.player.y),
                if snapshot.game.player.transformed > 0.0 {
                    Color::srgb(1.0, 0.72, 0.22)
                } else {
                    parse_color(&snapshot.avatar.outfit, Color::srgb(0.39, 0.9, 1.0))
                },
                snapshot.game.player.facing,
                true,
            ),
            ActorKind::Skin => (
                actor_position(snapshot.game.player.x, snapshot.game.player.y) + Vec3::Y * 0.55,
                parse_color(&snapshot.avatar.skin, Color::srgb(0.94, 0.76, 0.6)),
                snapshot.game.player.facing,
                true,
            ),
            ActorKind::Hair => (
                actor_position(snapshot.game.player.x, snapshot.game.player.y) + Vec3::Y * 0.82,
                parse_color(&snapshot.avatar.hair, Color::srgb(0.1, 0.1, 0.16)),
                snapshot.game.player.facing,
                true,
            ),
            ActorKind::Enemy => match snapshot.game.enemies.get(actor.1) {
                Some(enemy) => {
                    (actor_position(enemy.x, enemy.y), Color::srgb(0.98, 0.35, 0.48), 1.0, true)
                },
                None => (Vec3::ZERO, Color::srgb(0.98, 0.35, 0.48), 1.0, false),
            },
            ActorKind::Remote => match snapshot.remotes.get(actor.1) {
                Some(remote) => (
                    actor_position(remote.x, remote.y),
                    parse_color(&remote.avatar.outfit, Color::srgb(0.85, 0.75, 1.0)),
                    1.0,
                    true,
                ),
                None => (Vec3::ZERO, Color::srgb(0.85, 0.75, 1.0), 1.0, false),
            },
            ActorKind::Shot => match snapshot.game.shots.get(actor.1) {
                Some(shot) => (shot_position(shot), Color::srgb(0.48, 1.0, 0.94), 1.0, true),
                None => (Vec3::ZERO, Color::srgb(0.48, 1.0, 0.94), 1.0, false),
            },
        };
        *visibility = if active { Visibility::Visible } else { Visibility::Hidden };
        transform.translation = position;
        transform.rotation =
            Quat::from_rotation_y(if facing < 0.0 { std::f32::consts::PI } else { 0.0 });
        if let Some(mut asset) = materials.get_mut(&material.0)
            && asset.base_color != color
        {
            asset.base_color = color;
        }
    }
}

fn actor_position(x: f32, y: f32) -> Vec3 {
    Vec3::new(
        (x.clamp(0.0, 960.0) - 480.0) / 90.0,
        0.55 + (320.0 - y.clamp(0.0, 360.0)) / 90.0,
        0.0,
    )
}

fn shot_position(shot: &Shot) -> Vec3 {
    Vec3::new((shot.x - 480.0) / 90.0, 0.55 + (320.0 - shot.y) / 90.0, 0.0)
}

fn parse_color(value: &str, fallback: Color) -> Color {
    let Some(hex) = value.strip_prefix('#') else { return fallback };
    if hex.len() != 6 {
        return fallback;
    }
    let Ok(rgb) = u32::from_str_radix(hex, 16) else { return fallback };
    Color::srgb(
        ((rgb >> 16) & 0xff) as f32 / 255.0,
        ((rgb >> 8) & 0xff) as f32 / 255.0,
        (rgb & 0xff) as f32 / 255.0,
    )
}

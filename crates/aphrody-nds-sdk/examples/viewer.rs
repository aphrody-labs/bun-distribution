//! Opens a DS or 3DS image given as the first argument and shows both screens.
//!
//! ```text
//! cargo run -p aphrody-nds-sdk --example viewer --features viewer -- game.nds
//! ```
//!
//! Keys: Z/X = A/B, A/S = Y/X, Q/W = L/R, Enter = Start, Right Shift = Select, arrows = D-pad,
//! left mouse on the bottom screen = touch, F5 / F9 = save / load state next to the image.

use std::path::PathBuf;

use aphrody_nds_sdk::{
    HandheldPlugin, HandheldScreens, Options,
    plugin::{HandheldEvent, HandheldInput, HandheldStatus, LoadHandheldState, SaveHandheldState},
};
use bevy::{
    camera::{Camera, OrthographicProjection, Projection, ScalingMode},
    input::{ButtonInput, keyboard::KeyCode, mouse::MouseButton},
    prelude::*,
    window::PrimaryWindow,
};

#[derive(Resource)]
struct Layout {
    state: PathBuf,
    width: f32,
    top_height: f32,
    bottom_size: Vec2,
}

fn main() {
    let Some(path) = std::env::args_os().nth(1).map(PathBuf::from) else {
        eprintln!("usage: viewer <image.nds|.cci|.cia|.cxi|.3dsx>");
        std::process::exit(2);
    };
    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugins(HandheldPlugin::from_path(&path, Options::default()))
        .insert_resource(Layout {
            state: path.with_extension("state"),
            width: 0.0,
            top_height: 0.0,
            bottom_size: Vec2::ZERO,
        })
        .add_systems(Startup, setup)
        .add_systems(PreUpdate, (touch, state_keys))
        .add_systems(Update, report)
        .run();
}

fn setup(mut commands: Commands, screens: Res<HandheldScreens>, mut layout: ResMut<Layout>) {
    let top = Vec2::new(screens.top_size.0 as f32, screens.top_size.1 as f32);
    let bottom = Vec2::new(screens.bottom_size.0 as f32, screens.bottom_size.1 as f32);
    let (width, height) = (top.x.max(bottom.x), top.y + bottom.y);
    layout.width = width;
    layout.top_height = top.y;
    layout.bottom_size = bottom;
    commands.spawn((
        Camera2d,
        Projection::Orthographic(OrthographicProjection {
            scaling_mode: ScalingMode::AutoMin {
                min_width: width,
                min_height: height,
            },
            ..OrthographicProjection::default_2d()
        }),
    ));
    commands.spawn((
        Sprite {
            image: screens.top.clone(),
            custom_size: Some(top),
            ..default()
        },
        Transform::from_xyz(0.0, height / 2.0 - top.y / 2.0, 0.0),
    ));
    commands.spawn((
        Sprite {
            image: screens.bottom.clone(),
            custom_size: Some(bottom),
            ..default()
        },
        Transform::from_xyz(0.0, -height / 2.0 + bottom.y / 2.0, 0.0),
    ));
}

/// Left mouse button on the bottom screen is the touch point.
fn touch(
    layout: Res<Layout>,
    mouse: Res<ButtonInput<MouseButton>>,
    windows: Query<&Window, With<PrimaryWindow>>,
    cameras: Query<(&Camera, &GlobalTransform)>,
    mut input: ResMut<HandheldInput>,
) {
    let touch = (|| {
        if !mouse.pressed(MouseButton::Left) {
            return None;
        }
        let cursor = windows.single().ok()?.cursor_position()?;
        let (camera, transform) = cameras.single().ok()?;
        let world = camera.viewport_to_world_2d(transform, cursor).ok()?;
        let height = layout.top_height + layout.bottom_size.y;
        let x = world.x + layout.bottom_size.x / 2.0;
        let y = height / 2.0 - world.y - layout.top_height;
        (x >= 0.0 && y >= 0.0 && x < layout.bottom_size.x && y < layout.bottom_size.y)
            .then_some((x as u16, y as u16))
    })();
    input.0.touch = touch;
}

fn state_keys(
    keys: Res<ButtonInput<KeyCode>>,
    layout: Res<Layout>,
    mut save: MessageWriter<SaveHandheldState>,
    mut load: MessageWriter<LoadHandheldState>,
) {
    if keys.just_pressed(KeyCode::F5) {
        save.write(SaveHandheldState(layout.state.clone()));
    }
    if keys.just_pressed(KeyCode::F9) {
        load.write(LoadHandheldState(layout.state.clone()));
    }
}

fn report(mut events: MessageReader<HandheldEvent>, status: Res<HandheldStatus>) {
    for event in events.read() {
        match event {
            HandheldEvent::Frame(n) if n % 600 == 0 => {
                info!("{n} frames at {:.2} Hz", status.refresh_rate)
            }
            HandheldEvent::Frame(_) => {}
            other => info!("{other:?}"),
        }
    }
}

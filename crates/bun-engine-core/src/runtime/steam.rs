//! Binds `crate::steam::SteamPlugin` to the runtime (added by it when `render` is on):
//! overlay pause -> [`MachineStatus::paused`], Steam Input keys -> [`ExternalPads`] (`"steam"`),
//! screenshot requests -> the [`MachineScreen`] picture, and the Steam Deck / gamescope layout on
//! the primary window (1280x800, borderless fullscreen, FIFO, hidden cursor).

use crate::{
    bevy::{
        app::{App, Plugin, PreUpdate, Startup, Update},
        ecs::prelude::*,
        window::{CursorOptions, MonitorSelection, PresentMode, PrimaryWindow, Window, WindowMode},
    },
    steam::plugin::{
        SteamFrame, SteamKeys, SteamLayout, SteamPaused, SteamScreenshotPending, SteamSystems,
    },
};

use super::{
    EngineSystems, ExternalPads, MachineScreen, MachineSlot, MachineStatus, view::capture_rgb,
};

pub struct SteamRuntimePlugin;

impl Plugin for SteamRuntimePlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, deck_layout)
            .add_systems(PreUpdate, steam_keys.before(EngineSystems::Input))
            .add_systems(
                Update,
                (overlay_pause, capture.in_set(SteamSystems::Capture)),
            );
    }
}

fn steam_keys(keys: Res<SteamKeys>, mut pads: ResMut<ExternalPads>) {
    if keys.is_changed() {
        pads.0.insert("steam", keys.0);
    }
}

fn overlay_pause(paused: Res<SteamPaused>, status: Option<ResMut<MachineStatus>>) {
    if let Some(mut status) = status
        && paused.is_changed()
        && status.paused != paused.0
    {
        status.paused = paused.0;
    }
}

fn capture(
    pending: Res<SteamScreenshotPending>,
    slot: Option<NonSend<MachineSlot>>,
    screen: Option<Res<MachineScreen>>,
    mut frame: ResMut<SteamFrame>,
) {
    if let (true, Some(slot), Some(screen)) = (pending.0, slot, screen) {
        frame.picture = Some(capture_rgb(&slot, &screen));
    }
}

fn deck_layout(
    layout: Res<SteamLayout>,
    mut windows: Query<(&mut Window, Option<&mut CursorOptions>), With<PrimaryWindow>>,
) {
    if !layout.controller_first {
        return;
    }
    for (mut window, cursor) in &mut windows {
        window
            .resolution
            .set(layout.size.0 as f32, layout.size.1 as f32);
        window.mode = WindowMode::BorderlessFullscreen(MonitorSelection::Current);
        // gamescope composites with its own vsync; FIFO avoids tearing and wasted frames.
        window.present_mode = PresentMode::Fifo;
        if let Some(mut cursor) = cursor {
            cursor.visible = false;
        }
    }
}

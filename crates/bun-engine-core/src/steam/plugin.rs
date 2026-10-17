//! `SteamPlugin`: the Steamworks integration as a Bevy plugin (the `steam` slot of
//! `crates/bun-engine-core/BEVY.md`) over the same framework-agnostic core the CLI uses. It wraps
//! steamworks-rs directly: bevy-steamworks 0.17 pins Bevy 0.19 while the engine runs on Bevy 0.20
//! (`crate::bevy`). Only the app and ECS crates are used, so it adds no system libraries.
//!
//! - Build: `SteamAPI_Init` (AppID from [`RunOptions`], 480 by default), Steam Cloud sync of the
//!   ROM's save directory, Rich Presence, Steam Input manifest. Failure inserts
//!   [`SteamUnavailable`] and every system becomes a no-op.
//! - `First`: callbacks pumped; overlay changes update [`SteamPaused`] and emit [`SteamOverlay`];
//!   Steam Input actions update [`SteamPads`] (XInput layout, one slot per controller),
//!   [`SteamKeys`] (machine key bits) and emit [`SteamKeyEvent`] messages.
//! - `Update`: [`SteamPresence`] republished when it changes; screenshot requests answered from
//!   [`SteamFrame`]; queued [`SteamCloudSync`] requests run on a background thread and report
//!   [`SteamCloudSynced`]; the qualification [`Script`] (overlay, screenshot, quit).
//! - `Last`: on `AppExit`, the save directory is pushed to Steam Cloud and presence is cleared.
//!
//! The runtime binds these to its own resources: `SteamPaused` -> `MachineStatus::paused`,
//! `SteamPads` -> `ExternalPads`, the `MachineScreen` picture -> `SteamFrame`, and
//! [`SteamLayout`] -> the primary window (1280x800 borderless, FIFO, hidden cursor).

use std::{
    path::PathBuf,
    sync::{
        Mutex,
        mpsc::{Receiver, channel},
    },
    time::{Duration, Instant},
};

use crate::bevy::{
    app::{App, AppExit, First, Last, Plugin, Update},
    ecs::prelude::*,
};

use super::{
    Presence, Steam, SteamOptions, cloud,
    input::SteamInput,
    options::{DECK_SIZE, RunOptions, Script},
};
use crate::window::Pad;

pub struct SteamPlugin {
    pub options: RunOptions,
    pub system: String,
    pub rom: Option<PathBuf>,
    /// Directory for the generated Steam Input manifest.
    pub input_dir: PathBuf,
    /// Started in the constructor: create the plugin before `DefaultPlugins` so `SteamAPI_Init`
    /// precedes the GPU device and the overlay hooks the swap chain (and sees the Vulkan layer
    /// variable before the instance exists).
    steam: Mutex<Option<Result<Steam, String>>>,
}

impl SteamPlugin {
    /// The machine host's plugin: `system` (`nes`, `gba`, ...) and the ROM whose saves sync.
    pub fn new(options: RunOptions, system: impl Into<String>, rom: impl Into<PathBuf>) -> Self {
        let steam = Mutex::new(Some(Steam::init(&steam_options(&options))));
        Self {
            options,
            system: system.into(),
            rom: Some(rom.into()),
            input_dir: super::input::default_dir(),
            steam,
        }
    }

    /// Steam without a machine (frontends, the stream client): no cloud saves, no presence.
    pub fn bare(options: RunOptions) -> Self {
        let steam = Mutex::new(Some(Steam::init(&steam_options(&options))));
        Self {
            options,
            system: String::new(),
            rom: None,
            input_dir: super::input::default_dir(),
            steam,
        }
    }
}

fn steam_options(options: &RunOptions) -> SteamOptions {
    options
        .app_id
        .map_or_else(SteamOptions::default, SteamOptions::with_app_id)
}

/// Machine key bits (`crate::machine::keys`) held on Steam Input controllers.
#[derive(Resource, Default, Clone, Copy, Debug, PartialEq, Eq)]
pub struct SteamKeys(pub u32);

/// Steam Input controllers as XInput-layout pads (slot = controller index).
#[derive(Resource, Default, Clone, Copy, Debug, PartialEq, Eq)]
pub struct SteamPads(pub [Option<Pad>; 4]);

/// A machine key changed on a Steam Input controller.
#[derive(Message, Clone, Copy, Debug, PartialEq, Eq)]
pub struct SteamKeyEvent {
    pub key: u32,
    pub pressed: bool,
}

/// The overlay opened or closed.
#[derive(Message, Clone, Copy, Debug)]
pub struct SteamOverlay {
    pub active: bool,
}

/// True while the overlay is open: pause simulation, clear input, keep presenting.
#[derive(Resource, Default, Clone, Copy, Debug, PartialEq, Eq)]
pub struct SteamPaused(pub bool);

/// Steam Deck / Big Picture / gamescope: the controller-first layout applies.
#[derive(Resource, Clone, Copy, Debug, PartialEq, Eq)]
pub struct SteamLayout {
    pub controller_first: bool,
    pub size: (u32, u32),
}

/// What to publish as Rich Presence.
#[derive(Resource, Default, Clone, Debug)]
pub struct SteamPresence(pub Option<Presence>);

/// Latest presented picture (RGB8) and its Steam screenshot location tag.
#[derive(Resource, Default)]
pub struct SteamFrame {
    pub picture: Option<(u32, u32, Vec<u8>)>,
    pub location: String,
}

/// One save directory to reconcile with Steam Cloud.
#[derive(Clone, Debug)]
pub struct CloudRequest {
    pub rom_sha256: String,
    pub title: String,
    pub system: String,
    pub dir: PathBuf,
    pub direction: cloud::Direction,
}

/// Queue cloud work here; it runs off the main thread.
#[derive(Resource, Default)]
pub struct SteamCloudSync {
    pub pending: Vec<CloudRequest>,
}

#[derive(Message, Debug)]
pub struct SteamCloudSynced(pub Result<cloud::SyncReport, String>);

/// Steam asked for a screenshot (F12 or `TriggerScreenshot`): the host fills
/// [`SteamFrame::picture`] in [`SteamSystems::Capture`]; the plugin writes it in
/// [`SteamSystems::Answer`].
#[derive(Resource, Default, Clone, Copy, Debug, PartialEq, Eq)]
pub struct SteamScreenshotPending(pub bool);

/// Ordering inside `Update`: hosts capture the picture between these sets.
#[derive(SystemSet, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SteamSystems {
    Capture,
    Answer,
}

/// Present when `SteamAPI_Init` failed; every Steam system is then a no-op.
#[derive(Resource, Debug)]
pub struct SteamUnavailable(pub String);

/// The ROM whose saves are synchronized at startup and exit.
#[derive(Resource, Clone, Debug)]
struct SaveTarget(CloudRequest);

#[derive(Resource)]
struct ScriptState {
    script: Script,
    started: Instant,
    overlay: bool,
    screenshot: bool,
}

struct CloudWorker(Option<Receiver<Result<cloud::SyncReport, String>>>);

impl Plugin for SteamPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<SteamKeys>()
            .init_resource::<SteamPads>()
            .init_resource::<SteamPaused>()
            .init_resource::<SteamPresence>()
            .init_resource::<SteamFrame>()
            .init_resource::<SteamScreenshotPending>()
            .init_resource::<SteamCloudSync>()
            .configure_sets(Update, SteamSystems::Capture.before(SteamSystems::Answer))
            .add_message::<SteamKeyEvent>()
            .add_message::<SteamOverlay>()
            .add_message::<SteamCloudSynced>();
        let started = self.steam.lock().ok().and_then(|mut slot| slot.take());
        let steam = match started.unwrap_or_else(|| Steam::init(&steam_options(&self.options))) {
            Ok(steam) => steam,
            Err(e) => {
                app.insert_resource(SteamLayout {
                    controller_first: super::gamescope(),
                    size: DECK_SIZE,
                });
                app.insert_resource(SteamUnavailable(e));
                return;
            }
        };
        app.insert_resource(SteamLayout {
            controller_first: steam.controller_first(),
            size: DECK_SIZE,
        });
        if let Some(rom) = &self.rom {
            let title = self.options.title.clone().unwrap_or_else(|| {
                rom.file_stem()
                    .map_or_else(|| "Unknown".into(), |s| s.to_string_lossy().into_owned())
            });
            app.insert_resource(SteamPresence(Some(Presence {
                system: self.system.clone(),
                game: title.clone(),
                state: None,
            })));
            app.insert_resource(SteamFrame {
                picture: None,
                location: format!("{title} ({})", self.system.to_uppercase()),
            });
            if self.options.cloud
                && let Ok(bytes) = std::fs::read(rom)
            {
                let hash = super::sha256_hex(&bytes);
                let target = CloudRequest {
                    dir: cloud::save_dir(&hash),
                    rom_sha256: hash,
                    title,
                    system: self.system.clone(),
                    direction: cloud::Direction::Sync,
                };
                // Saves must be local before the machine boots: synchronous at startup.
                let _ = cloud::sync(
                    &target.rom_sha256,
                    &target.title,
                    &target.system,
                    &target.dir,
                    target.direction,
                );
                app.insert_resource(SaveTarget(target));
            }
        }
        steam.hook_screenshots(true);
        if self.options.input
            && let Ok(input) = SteamInput::new(&steam.client, steam.app_id, &self.input_dir)
        {
            app.insert_non_send(input);
        }
        app.insert_resource(ScriptState {
            script: self.options.script.clone(),
            started: Instant::now(),
            overlay: false,
            screenshot: false,
        });
        app.insert_non_send(steam)
            .insert_non_send(CloudWorker(None))
            .add_systems(First, (pump, poll_input).chain())
            .add_systems(Update, (publish_presence, run_cloud, run_script))
            .add_systems(Update, answer_screenshots.in_set(SteamSystems::Answer))
            .add_systems(Last, on_exit);
        #[cfg(feature = "render")]
        app.add_plugins(crate::runtime::steam::SteamRuntimePlugin);
    }
}

fn pump(
    steam: Option<NonSend<Steam>>,
    mut paused: ResMut<SteamPaused>,
    mut pending: ResMut<SteamScreenshotPending>,
    mut overlay: MessageWriter<SteamOverlay>,
) {
    let Some(steam) = steam else { return };
    steam.pump();
    if steam.take_screenshot_request() {
        pending.0 = true;
    }
    if let Some(active) = steam.take_overlay_change() {
        eprintln!(
            "steam: overlay {}",
            if active { "activated" } else { "closed" }
        );
        paused.0 = active;
        overlay.write(SteamOverlay { active });
    }
}

fn poll_input(
    steam: Option<NonSend<Steam>>,
    input: Option<NonSendMut<SteamInput>>,
    mut keys: ResMut<SteamKeys>,
    mut pads: ResMut<SteamPads>,
    mut events: MessageWriter<SteamKeyEvent>,
) {
    let (Some(steam), Some(mut input)) = (steam, input) else {
        return;
    };
    let mut next = pads.0;
    let held = if steam.overlay_active() {
        next = [None; 4];
        0
    } else {
        input.poll(|slot, pad| next[usize::from(slot & 3)] = pad);
        input.keys()
    };
    if pads.0 != next {
        pads.0 = next;
    }
    let changed = held ^ keys.0;
    for bit in (0..32).map(|b| 1u32 << b).filter(|bit| changed & bit != 0) {
        events.write(SteamKeyEvent {
            key: bit,
            pressed: held & bit != 0,
        });
    }
    if keys.0 != held {
        keys.0 = held;
    }
}

fn publish_presence(steam: Option<NonSend<Steam>>, presence: Res<SteamPresence>) {
    let Some(steam) = steam else { return };
    if presence.is_changed() {
        match &presence.0 {
            Some(p) => {
                steam.set_presence(p);
            }
            None => steam.clear_presence(),
        }
    }
}

fn answer_screenshots(
    steam: Option<NonSend<Steam>>,
    mut pending: ResMut<SteamScreenshotPending>,
    mut frame: ResMut<SteamFrame>,
) {
    let Some(steam) = steam else { return };
    if !pending.0 {
        return;
    }
    pending.0 = false;
    if let Some((w, h, mut rgb)) = frame.picture.take() {
        let location = frame.location.clone();
        match steam.write_screenshot(w, h, &mut rgb, &location) {
            Some(handle) => eprintln!("steam: screenshot written ({w}x{h}, handle {handle})"),
            None => eprintln!("steam: WriteScreenshot failed"),
        }
    }
}

fn run_cloud(
    steam: Option<NonSend<Steam>>,
    mut worker: NonSendMut<CloudWorker>,
    mut queue: ResMut<SteamCloudSync>,
    mut done: MessageWriter<SteamCloudSynced>,
) {
    if steam.is_none() {
        return;
    }
    if let Some(rx) = &worker.0 {
        loop {
            match rx.try_recv() {
                Ok(result) => {
                    done.write(SteamCloudSynced(result));
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => return,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            }
        }
        worker.0 = None;
    }
    if queue.pending.is_empty() {
        return;
    }
    let requests = std::mem::take(&mut queue.pending);
    let (tx, rx) = channel();
    // ISteamRemoteStorage is thread-safe; the synchronous reads and writes stay off the frame.
    std::thread::spawn(move || {
        for r in requests {
            let _ = tx.send(cloud::sync(
                &r.rom_sha256,
                &r.title,
                &r.system,
                &r.dir,
                r.direction,
            ));
        }
    });
    worker.0 = Some(rx);
}

fn run_script(
    steam: Option<NonSend<Steam>>,
    mut state: ResMut<ScriptState>,
    mut exit: MessageWriter<AppExit>,
) {
    let Some(steam) = steam else { return };
    let elapsed = state.started.elapsed();
    if !state.overlay
        && let Some(dialog) = state.script.overlay.clone()
        && elapsed >= state.script.overlay_after
    {
        state.overlay = true;
        steam.open_overlay(&dialog);
    }
    if !state.screenshot
        && state
            .script
            .screenshot_after
            .is_some_and(|after| elapsed >= after)
    {
        state.screenshot = true;
        steam.trigger_screenshot();
    }
    if state
        .script
        .quit_after
        .is_some_and(|after| elapsed >= after + Duration::ZERO)
    {
        exit.write(AppExit::Success);
    }
}

fn on_exit(
    steam: Option<NonSend<Steam>>,
    target: Option<Res<SaveTarget>>,
    mut exits: MessageReader<AppExit>,
) {
    if exits.read().next().is_none() {
        return;
    }
    let Some(steam) = steam else { return };
    if let Some(target) = target {
        let t = &target.0;
        let _ = cloud::sync(
            &t.rom_sha256,
            &t.title,
            &t.system,
            &t.dir,
            cloud::Direction::Sync,
        );
    }
    steam.clear_presence();
    steam.pump();
}

//! Game sessions: Bun Engine machines through the engine's Bevy runtime (`InsertMachine`,
//! `MachineStatus.paused` for suspend, save states for instant resume, `MachineScreen` and the
//! engine FSR1 pass into an image), Steam games through `steam://rungameid`, release emulators
//! from `usr/` through the bep route resolver, focus and borderless orchestration, captures, the
//! quick-menu and profile actions.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use bevy::ecs::system::SystemParam;
use bevy::prelude::*;
use bevy::window::PrimaryWindow;

use crate::app::{
    Action, MotionPref, Overlay, PowerAction, ProfileField, QuickAction, Screen, SettingKey,
    Settings, Shell,
};
use crate::assets::Art;
use crate::library::{Kind, Library};
use crate::machine::{self, Suspended};
use bun_engine::runtime::fsr1::Fsr1Upscale;
use bun_engine::runtime::{
    InsertMachine, MachineEvent, MachineOptions, MachineScreen, MachineSlot, MachineStatus,
    RemoveMachine,
};
use crate::profiles::{FPS_LIMITS, Profile, SCALERS};
use crate::recorder::Recorder;
use crate::text::{t, tf};
use crate::ui::{Activate, Motion};

/// A game running outside the shell process.
pub struct External {
    pub key: String,
    pub title: String,
    pub steam_app: Option<u32>,
    pub child: Option<Child>,
    pub started: Instant,
    pub seen_running: bool,
    pub window: Option<isize>,
    pub arranged: bool,
}

/// The game whose machine runs in the engine runtime.
pub struct Active {
    pub key: String,
    pub started: Instant,
    pub info: machine::Info,
    fps_mark: (Instant, u64),
}

#[derive(Resource, Default)]
pub struct Running {
    pub machine: Option<Active>,
    pub machine_game: Option<usize>,
    pub suspended: bool,
    /// What the game view shows: the engine `MachineScreen` image or the FSR1 target.
    pub image: Handle<Image>,
    pub image_size: (u32, u32),
    pub fsr_target: Option<(Handle<Image>, (u32, u32))>,
    pub recorded_frames: u64,
    pub profile: Option<Profile>,
    pub recorder: Option<Recorder>,
    pub external: Option<External>,
}

impl Running {
    pub fn machine_key(&self) -> Option<&str> {
        self.machine.as_ref().map(|m| m.key.as_str())
    }
}

/// The engine's current machine picture as RGBA (thumbnails, recording).
fn machine_picture(images: &Assets<Image>, screen: &MachineScreen) -> Option<(u32, u32, Vec<u8>)> {
    let image = images.get(&screen.image)?;
    let data = image.data.clone()?;
    Some((screen.size.x, screen.size.y, data))
}

/// Save the running machine (`Machine::save_state`) and its picture under `shell/states`.
pub fn save_machine(
    shell: &Shell,
    running: &Running,
    slot: Option<&mut MachineSlot>,
    images: &Assets<Image>,
    screen: Option<&MachineScreen>,
) -> Option<PathBuf> {
    let active = running.machine.as_ref()?;
    let state = slot?.0.save_state()?;
    let target = Suspended::of(&shell.paths.states(), &active.key);
    let picture = screen.and_then(|s| machine_picture(images, s));
    target.write(&state, picture).ok()?;
    Some(target.state)
}

#[derive(SystemParam)]
pub struct Ctx<'w, 's> {
    pub commands: Commands<'w, 's>,
    pub shell: ResMut<'w, Shell>,
    pub running: ResMut<'w, Running>,
    pub settings: ResMut<'w, Settings>,
    pub motion: ResMut<'w, Motion>,
    pub screen: Res<'w, State<Screen>>,
    pub next_screen: ResMut<'w, NextState<Screen>>,
    pub next_overlay: ResMut<'w, NextState<Overlay>>,
    pub images: ResMut<'w, Assets<Image>>,
    pub art: ResMut<'w, Art>,
    pub slot: Option<NonSendMut<'w, MachineSlot>>,
    pub status: Option<ResMut<'w, MachineStatus>>,
    pub machine_screen: Option<Res<'w, MachineScreen>>,
    pub windows: Query<'w, 's, &'static mut Window, With<PrimaryWindow>>,
    pub exit: MessageWriter<'w, AppExit>,
}

fn now_tag() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn bun() -> Option<PathBuf> {
    let exe = if cfg!(windows) { "bun.exe" } else { "bun" };
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .map(|d| d.join(exe))
        .chain(
            std::env::var_os("USERPROFILE")
                .map(|h| PathBuf::from(h).join(".bun").join("bin").join(exe)),
        )
        .find(|p| p.is_file())
}

/// Save the running machine through `Ctx` (state file + thumbnail); `None` when the core cannot.
fn save_now(ctx: &mut Ctx) -> Option<PathBuf> {
    let slot = ctx.slot.as_deref_mut();
    let screen = ctx.machine_screen.as_deref();
    let saved = save_machine(&ctx.shell, &ctx.running, slot, &ctx.images, screen);
    if let Some(active) = &ctx.running.machine {
        let thumb = Suspended::of(&ctx.shell.paths.states(), &active.key).thumb;
        ctx.art.invalidate(&thumb.display().to_string());
    }
    saved
}

fn set_paused(ctx: &mut Ctx, paused: bool) {
    if let Some(status) = ctx.status.as_mut() {
        status.paused = paused;
    }
    if let Some(active) = ctx.running.machine.as_mut() {
        active.info.paused = paused;
    }
}

fn stop_machine(ctx: &mut Ctx, keep_state: bool) {
    if let Some(active) = ctx.running.machine.as_ref() {
        let key = active.key.clone();
        let seconds = active.started.elapsed().as_secs_f64();
        let instant = ctx.running.profile.as_ref().is_none_or(|p| p.instant_resume);
        if keep_state && instant {
            if save_now(ctx).is_none() {
                ctx.shell.toast(t("toast.cannot-save"));
            }
        } else {
            Suspended::of(&ctx.shell.paths.states(), &key).discard();
        }
        ctx.shell.store.lock().unwrap().record_session(&key, "machine", seconds);
    }
    if let Some(recorder) = ctx.running.recorder.take() {
        let _ = recorder.stop();
    }
    ctx.commands.queue(RemoveMachine);
    ctx.running.machine = None;
    ctx.running.machine_game = None;
    ctx.running.suspended = false;
}

pub fn play(ctx: &mut Ctx, index: usize, fresh: bool) {
    let Some(game) = ctx.shell.library.games.get(index).cloned() else {
        return;
    };
    ctx.shell.selected = index;
    match &game.kind {
        Kind::Native { system, path, .. } => {
            if ctx.running.machine_key() == Some(game.key.as_str()) && !fresh {
                set_paused(ctx, false);
                ctx.running.suspended = false;
                ctx.next_screen.set(Screen::Playing);
                ctx.shell.toast(tf("toast.resumed", &[("title", &game.title)]));
                return;
            }
            if ctx.running.machine.is_some() {
                stop_machine(ctx, true);
            }
            let profile = ctx.shell.store.lock().unwrap().profile(&game.key);
            let suspended = Suspended::of(&ctx.shell.paths.states(), &game.key);
            if fresh {
                suspended.discard();
            }
            let state = (profile.instant_resume && suspended.exists())
                .then(|| std::fs::read(&suspended.state).ok())
                .flatten();
            let resumed = state.is_some();
            let bios = (system == "psx")
                .then(|| crate::library::psx_bios(&ctx.shell.paths))
                .flatten();
            ctx.commands.queue(
                InsertMachine::new(machine::factory(system.clone(), path.clone(), bios, state))
                    .with_options(MachineOptions {
                        spawn_view: false,
                        exit_on_stop: false,
                        paused: false,
                    }),
            );
            let now = Instant::now();
            ctx.running.machine = Some(Active {
                key: game.key.clone(),
                started: now,
                info: machine::Info {
                    resumed_from_disk: resumed,
                    ..default()
                },
                fps_mark: (now, 0),
            });
            ctx.running.machine_game = Some(index);
            ctx.running.profile = Some(profile);
            ctx.running.suspended = false;
            ctx.running.recorded_frames = 0;
            ctx.next_screen.set(Screen::Playing);
            ctx.shell.toast(if resumed {
                tf("toast.resumed-disk", &[("title", &game.title)])
            } else {
                tf("toast.playing", &[("title", &game.title)])
            });
        }
        Kind::Steam { app_id, installed } => {
            if !installed {
                let uri = format!("steam://nav/games/details/{app_id}");
                if bun_steam::launch::is_safe_steam_uri(&uri) && open_uri(&uri) {
                    ctx.shell.toast(tf("toast.steam-page", &[("title", &game.title)]));
                }
                return;
            }
            if let Some(reason) = busy_reason() {
                ctx.shell
                    .toast(tf("toast.not-launched", &[("title", &game.title), ("reason", &reason)]));
                return;
            }
            let uri = bun_steam::launch::rungameid_uri(*app_id);
            if bun_steam::launch::is_safe_steam_uri(&uri) && open_uri(&uri) {
                ctx.running.external = Some(External {
                    key: game.key.clone(),
                    title: game.title.clone(),
                    steam_app: Some(*app_id),
                    child: None,
                    started: Instant::now(),
                    seen_running: false,
                    window: None,
                    arranged: false,
                });
                ctx.shell
                    .toast(tf("toast.starting-steam", &[("title", &game.title)]));
            }
        }
        Kind::Route { id, .. } => match route_command(&ctx.shell, *id) {
            Ok((command, cwd)) => {
                let mut process = Command::new(&command[0]);
                process
                    .args(&command[1..])
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null());
                if let Some(cwd) = cwd {
                    process.current_dir(cwd);
                }
                match process.spawn() {
                    Ok(child) => {
                        ctx.running.external = Some(External {
                            key: game.key.clone(),
                            title: game.title.clone(),
                            steam_app: None,
                            child: Some(child),
                            started: Instant::now(),
                            seen_running: true,
                            window: None,
                            arranged: false,
                        });
                        ctx.shell.toast(tf("toast.starting", &[("title", &game.title)]));
                    }
                    Err(e) => ctx.shell.toast(format!("{}: {e}", command[0])),
                }
            }
            Err(e) => ctx.shell.toast(e),
        },
        Kind::Web { core, .. } => {
            let serve = ctx
                .shell
                .paths
                .repo
                .join("packages/bun-engine/web-emulation/serve.ts");
            if let Some(bun) = bun() {
                let _ = Command::new(bun)
                    .arg(serve)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn();
            }
            let url = format!("http://localhost:8787/smoke/?core={core}");
            if open_uri(&url) {
                ctx.shell
                    .toast(tf("toast.starting", &[("title", &game.title)]));
            }
        }
    }
}

/// `bun-engine library command <id>`: the route command line resolved by the Bun frontend.
fn route_command(shell: &Shell, id: i64) -> Result<(Vec<String>, Option<PathBuf>), String> {
    let bun = bun().ok_or("bun is not on PATH")?;
    let cli = shell.paths.repo.join("packages/bun-engine/src/cli.ts");
    let output = Command::new(bun)
        .arg(cli)
        .args(["library", "command", &id.to_string()])
        .current_dir(&shell.paths.repo)
        .output()
        .map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| String::from_utf8_lossy(&output.stderr).trim().to_string())?;
    if let Some(error) = value.get("error").and_then(|e| e.as_str()) {
        return Err(error.to_string());
    }
    let command: Vec<String> = value
        .get("command")
        .and_then(|c| c.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    if command.is_empty() {
        return Err("the route resolver returned no command".into());
    }
    Ok((
        command,
        value.get("cwd").and_then(|c| c.as_str()).map(PathBuf::from),
    ))
}

fn open_uri(uri: &str) -> bool {
    #[cfg(windows)]
    {
        crate::system::open_uri(uri)
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open").arg(uri).spawn().is_ok()
    }
}

/// Why launching an external game now would disturb the user (a game or a stream already runs).
pub fn busy_reason() -> Option<String> {
    let running = crate::system::steam_running_app();
    if running != 0 {
        return Some(tf("busy.steam", &[("app", &running)]));
    }
    #[cfg(windows)]
    for (_, _, name) in crate::system::processes() {
        let lower = name.to_ascii_lowercase();
        if crate::system::STREAMING.contains(&lower.as_str()) {
            return Some(tf("busy.stream", &[("name", &name)]));
        }
    }
    None
}

fn set_shell_minimized(ctx: &mut Ctx, minimized: bool) {
    if let Ok(mut window) = ctx.windows.single_mut() {
        window.set_minimized(minimized);
    }
    #[cfg(windows)]
    if !minimized && let Some(hwnd) = ctx.shell.hwnd {
        crate::system::focus(hwnd);
    }
}

fn capture_path(shell: &Shell, key: &str, ext: &str) -> PathBuf {
    shell.paths.captures().join(format!(
        "{}-{}.{ext}",
        crate::paths::Paths::slug(key),
        now_tag()
    ))
}

pub fn screenshot(commands: &mut Commands, path: PathBuf) {
    use bevy::render::view::screenshot::{Screenshot, save_to_disk};
    commands
        .spawn(Screenshot::primary_window())
        .observe(save_to_disk(path));
}

fn cycle<T: PartialEq + Clone>(values: &[T], current: &T) -> T {
    let at = values
        .iter()
        .position(|v| v == current)
        .map_or(0, |i| (i + 1) % values.len());
    values[at].clone()
}

fn update_profile(ctx: &mut Ctx, index: usize, field: ProfileField) {
    let Some(game) = ctx.shell.library.games.get(index).cloned() else {
        return;
    };
    let store = ctx.shell.store.lock().unwrap();
    let mut profile = store.profile(&game.key);
    match field {
        ProfileField::FrameLimit => profile.fps_limit = cycle(&FPS_LIMITS, &profile.fps_limit),
        ProfileField::Scaler => profile.scaler = cycle(&SCALERS.map(String::from), &profile.scaler),
        ProfileField::Borderless => profile.borderless = !profile.borderless,
        ProfileField::InstantResume => profile.instant_resume = !profile.instant_resume,
        ProfileField::Hud => profile.hud = !profile.hud,
    }
    store.save(&profile, &game.title);
    drop(store);
    if ctx.running.machine_key() == Some(game.key.as_str()) {
        ctx.running.profile = Some(profile);
    }
}

fn quick(ctx: &mut Ctx, action: QuickAction) {
    match action {
        QuickAction::Home => {
            if ctx.running.machine.is_some() {
                set_paused(ctx, true);
                ctx.running.suspended = true;
                if ctx
                    .running
                    .profile
                    .as_ref()
                    .is_none_or(|p| p.instant_resume)
                {
                    let saved = save_now(ctx);
                    ctx.shell.toast(if saved.is_some() {
                        t("toast.suspended")
                    } else {
                        t("toast.paused")
                    });
                }
            }
            ctx.next_overlay.set(Overlay::Closed);
            ctx.next_screen.set(Screen::Home);
        }
        QuickAction::Resume => {
            ctx.next_overlay.set(Overlay::Closed);
            if ctx.running.machine.is_some() {
                set_paused(ctx, false);
                ctx.running.suspended = false;
                ctx.next_screen.set(Screen::Playing);
            } else if let Some(ext) = &ctx.running.external
                && let Some(window) = ext.window
            {
                #[cfg(windows)]
                crate::system::focus(window);
                let _ = window;
            }
        }
        QuickAction::Screenshot => {
            let key = ctx.running.machine_key().unwrap_or("shell").to_string();
            let path = capture_path(&ctx.shell, &key, "png");
            ctx.next_overlay.set(Overlay::Closed);
            screenshot(&mut ctx.commands, path.clone());
            ctx.shell
                .toast(tf("toast.screenshot", &[("path", &path.display())]));
        }
        QuickAction::Record => {
            if let Some(recorder) = ctx.running.recorder.take() {
                let path = recorder.path.clone();
                match recorder.stop() {
                    Ok(encoder) => ctx
                        .shell
                        .toast(tf("toast.recorded", &[("path", &path.display()), ("encoder", &encoder)])),
                    Err(e) => ctx.shell.toast(tf("toast.record-failed", &[("error", &e)])),
                }
            } else if let Some(active) = &ctx.running.machine {
                let fps = ctx
                    .status
                    .as_ref()
                    .map_or(60.0, |s| s.refresh_rate)
                    .round()
                    .max(1.0) as u32;
                let path = capture_path(&ctx.shell, &active.key, "mp4");
                ctx.running.recorder = Some(Recorder::start(path, fps));
                let encoder = ctx
                    .shell
                    .encoders
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "software H.264".into());
                ctx.shell.toast(tf("toast.recording", &[("encoder", &encoder)]));
            } else {
                ctx.shell.toast(t("toast.record-unavailable"));
            }
        }
        QuickAction::Hud => {
            ctx.settings.hud = !ctx.settings.hud;
            crate::app::save_settings(&ctx.shell.store.lock().unwrap(), &ctx.settings);
        }
        QuickAction::FrameLimit | QuickAction::Scaling => {
            let index = ctx.running.machine_game.unwrap_or(ctx.shell.selected);
            let field = if action == QuickAction::FrameLimit {
                ProfileField::FrameLimit
            } else {
                ProfileField::Scaler
            };
            update_profile(ctx, index, field);
        }
        QuickAction::VolumeDown | QuickAction::VolumeUp => {
            #[cfg(windows)]
            {
                let step = if action == QuickAction::VolumeUp {
                    0.05
                } else {
                    -0.05
                };
                let current = crate::system::volume().unwrap_or(0.5);
                ctx.shell.volume = crate::system::set_volume(current + step);
            }
        }
        QuickAction::CloseGame => {
            if ctx.running.machine.is_some() {
                stop_machine(ctx, false);
                ctx.next_overlay.set(Overlay::Closed);
                ctx.next_screen.set(Screen::Home);
                ctx.shell.toast(t("action.close-game"));
            } else if let Some(ext) = &ctx.running.external {
                if ext.child.is_some() {
                    #[cfg(windows)]
                    if let Some(window) = ext.window {
                        crate::system::close(window);
                    }
                    ctx.shell.toast(tf("toast.asked-close", &[("title", &ext.title)]));
                } else {
                    ctx.shell.toast(t("toast.close-steam"));
                }
            }
        }
        QuickAction::Power => ctx.next_overlay.set(Overlay::Power),
    }
}

fn power(ctx: &mut Ctx, action: PowerAction) {
    match action {
        PowerAction::Cancel => ctx.next_overlay.set(Overlay::Quick),
        PowerAction::Desktop => {
            ctx.exit.write(AppExit::Success);
        }
        PowerAction::Sleep => {
            if ctx.running.machine.is_some() {
                let _ = save_now(ctx);
            }
            ctx.next_overlay.set(Overlay::Closed);
            #[cfg(windows)]
            crate::system::sleep();
        }
        PowerAction::Restart | PowerAction::Shutdown => {
            if ctx.running.machine.is_some() {
                let _ = save_now(ctx);
            }
            let flag = if action == PowerAction::Restart {
                "/r"
            } else {
                "/s"
            };
            let _ = Command::new("shutdown.exe").args([flag, "/t", "0"]).spawn();
            ctx.exit.write(AppExit::Success);
        }
    }
}

fn setting(ctx: &mut Ctx, key: SettingKey) {
    match key {
        SettingKey::Haptics => ctx.settings.haptics = !ctx.settings.haptics,
        SettingKey::Hud => ctx.settings.hud = !ctx.settings.hud,
        SettingKey::Motion => {
            ctx.settings.motion = match ctx.settings.motion {
                MotionPref::System => MotionPref::Reduced,
                MotionPref::Reduced => MotionPref::Full,
                MotionPref::Full => MotionPref::System,
            };
            ctx.motion.reduced = reduced_motion(ctx.settings.motion);
        }
        SettingKey::Rescan => {
            ctx.shell.library = Library::load(&ctx.shell.paths);
            let count = ctx.shell.library.games.len();
            ctx.shell.toast(tf("toast.reloaded", &[("count", &count)]));
        }
        SettingKey::Session => {
            let command = crate::system::session_install_command();
            ctx.shell
                .toast(tf("toast.session", &[("command", &command)]));
        }
        SettingKey::Desktop => {
            ctx.exit.write(AppExit::Success);
        }
    }
    crate::app::save_settings(&ctx.shell.store.lock().unwrap(), &ctx.settings);
}

pub fn reduced_motion(pref: MotionPref) -> bool {
    match pref {
        MotionPref::Reduced => true,
        MotionPref::Full => false,
        MotionPref::System => {
            #[cfg(windows)]
            {
                crate::system::reduced_motion()
            }
            #[cfg(not(windows))]
            {
                false
            }
        }
    }
}

pub fn dispatch(mut events: MessageReader<Activate>, mut ctx: Ctx) {
    let actions: Vec<Action> = events.read().map(|a| a.0.clone()).collect();
    for action in actions {
        match action {
            Action::Play(i) => play(&mut ctx, i, false),
            Action::Fresh(i) => play(&mut ctx, i, true),
            Action::Hub(i) => {
                ctx.shell.hub = i;
                ctx.shell.selected = i;
                ctx.next_screen.set(Screen::Hub);
            }
            Action::Go(screen) => ctx.next_screen.set(screen),
            Action::Filter(filter) => {
                ctx.shell.filter = filter;
                ctx.next_screen.set(Screen::Library);
            }
            Action::ReturnToGame => quick(&mut ctx, QuickAction::Resume),
            Action::Profile(i, field) => update_profile(&mut ctx, i, field),
            Action::Setting(key) => setting(&mut ctx, key),
            Action::Quick(q) => quick(&mut ctx, q),
            Action::Power(p) => power(&mut ctx, p),
            Action::Noop => {}
        }
    }
}

/// Follows the engine machine: picture handle and size for the game view (or the FSR1 target),
/// sampler for the Smooth scaler, recording, measured rate, failures and shutdowns.
#[allow(clippy::too_many_arguments)]
pub fn sync_machine(
    mut commands: Commands,
    mut running: ResMut<Running>,
    mut shell: ResMut<Shell>,
    mut images: ResMut<Assets<Image>>,
    status: Option<Res<MachineStatus>>,
    screen: Option<Res<MachineScreen>>,
    fsr: Option<Res<Fsr1Upscale>>,
    windows: Query<&Window, With<PrimaryWindow>>,
    mut events: MessageReader<MachineEvent>,
    mut next_screen: ResMut<NextState<Screen>>,
) {
    for event in events.read() {
        match event {
            MachineEvent::Failed(why) => {
                shell.toast(tf("toast.start-failed", &[("error", &why)]));
                running.machine = None;
                running.machine_game = None;
                next_screen.set(Screen::Home);
            }
            MachineEvent::Shutdown(name) => shell.toast(tf("toast.stopped", &[("name", &name)])),
            _ => {}
        }
    }
    let (Some(status), Some(screen)) = (status, screen) else {
        if fsr.is_some() {
            commands.remove_resource::<Fsr1Upscale>();
        }
        return;
    };
    let size = (screen.size.x, screen.size.y);
    let scaler = running
        .profile
        .as_ref()
        .map_or("sharp", |p| p.scaler.as_str())
        .to_string();
    if let Some(mut image) = images.get_mut(&screen.image) {
        let wanted = if scaler == "smooth" {
            bevy::image::ImageSampler::linear()
        } else {
            bevy::image::ImageSampler::nearest()
        };
        if image.sampler != wanted {
            image.sampler = wanted;
        }
    }
    if scaler == "fsr1" {
        // FSR1 renders into an image of the window's size; the game view shows it.
        let target_size = windows
            .single()
            .map(|w| (w.physical_width().max(1), w.physical_height().max(1)))
            .unwrap_or((1920, 1080));
        let target = match &running.fsr_target {
            Some((handle, s)) if *s == target_size && images.get(handle).is_some() => {
                handle.clone()
            }
            _ => {
                let handle = images.add(Fsr1Upscale::target_image(target_size.0, target_size.1));
                running.fsr_target = Some((handle.clone(), target_size));
                handle
            }
        };
        if fsr
            .as_ref()
            .is_none_or(|f| f.image != screen.image || f.target.as_ref() != Some(&target))
        {
            commands.insert_resource(Fsr1Upscale {
                image: screen.image.clone(),
                sharpness_stops: 0.25,
                target: Some(target.clone()),
            });
        }
        if running.image != target {
            running.image = target;
        }
        running.image_size = target_size;
    } else {
        if fsr.is_some() {
            commands.remove_resource::<Fsr1Upscale>();
        }
        if running.image != screen.image {
            running.image = screen.image.clone();
        }
        running.image_size = size;
    }
    if running.recorder.is_some() && status.frames != running.recorded_frames {
        running.recorded_frames = status.frames;
        if let Some((w, h, rgba)) = machine_picture(&images, &screen)
            && let Some(recorder) = &running.recorder
        {
            recorder.push(w, h, rgba);
        }
    }
    if let Some(active) = running.machine.as_mut() {
        let (mark, frames) = active.fps_mark;
        let elapsed = mark.elapsed().as_secs_f32();
        if elapsed >= 1.0 {
            active.info.fps = status.frames.saturating_sub(frames) as f32 / elapsed;
            active.fps_mark = (Instant::now(), status.frames);
        }
        active.info.name = status.name.to_string();
        active.info.refresh = status.refresh_rate;
        active.info.frames = status.frames;
        active.info.paused = status.paused;
    }
}

/// Pauses the machine while an overlay covers the game, resumes when it closes.
pub fn pause_for_overlay(
    overlay: Res<State<Overlay>>,
    screen: Res<State<Screen>>,
    status: Option<ResMut<MachineStatus>>,
) {
    if !overlay.is_changed() || *screen.get() != Screen::Playing {
        return;
    }
    if let Some(mut status) = status {
        status.paused = *overlay.get() != Overlay::Closed;
    }
}

/// Leaving the game screen for anything but an overlay suspends the machine.
pub fn suspend_on_leave(
    shell: Res<Shell>,
    mut running: ResMut<Running>,
    mut art: ResMut<Art>,
    mut slot: Option<NonSendMut<MachineSlot>>,
    status: Option<ResMut<MachineStatus>>,
    screen: Option<Res<MachineScreen>>,
    images: Res<Assets<Image>>,
) {
    if running.suspended || running.machine.is_none() {
        return;
    }
    if let Some(mut status) = status {
        status.paused = true;
    }
    if running.profile.as_ref().is_none_or(|p| p.instant_resume) {
        let _ = save_machine(
            &shell,
            &running,
            slot.as_deref_mut(),
            &images,
            screen.as_deref(),
        );
        if let Some(active) = &running.machine {
            let thumb = Suspended::of(&shell.paths.states(), &active.key).thumb;
            art.invalidate(&thumb.display().to_string());
        }
    }
    running.suspended = true;
}

/// Watches external games: arranges and focuses their window, minimizes the shell while they run
/// and brings the shell back when they exit.
pub fn track_external(mut ctx: Ctx, time: Res<Time>, mut since: Local<f32>) {
    *since += time.delta_secs();
    if *since < 0.5 {
        return;
    }
    *since = 0.0;
    let Some(mut ext) = ctx.running.external.take() else {
        return;
    };
    let mut finished = false;
    if let Some(app) = ext.steam_app {
        let current = crate::system::steam_running_app();
        if current == app {
            ext.seen_running = true;
        } else if ext.seen_running && current == 0 {
            finished = true;
        } else if !ext.seen_running && ext.started.elapsed() > Duration::from_secs(120) {
            finished = true;
            ctx.shell.toast(tf("toast.not-started", &[("title", &ext.title)]));
        }
    }
    if let Some(child) = ext.child.as_mut()
        && !matches!(child.try_wait(), Ok(None))
    {
        finished = true;
    }
    #[cfg(windows)]
    if !finished && !ext.arranged {
        let candidates = if let Some(child) = &ext.child {
            crate::system::windows_of(&crate::system::process_tree(child.id()))
        } else if ext.seen_running {
            let fg = crate::system::foreground();
            let pid = crate::system::window_pid(fg);
            let own = std::process::id();
            let names: Vec<_> = crate::system::processes()
                .into_iter()
                .filter(|(p, _, _)| *p == pid)
                .map(|(_, _, n)| n.to_ascii_lowercase())
                .collect();
            let steam = names.iter().any(|n| n.starts_with("steam"));
            if fg != 0 && pid != own && !steam && !names.is_empty() {
                vec![fg]
            } else {
                Vec::new()
            }
        } else {
            Vec::new()
        };
        if let Some(&window) = candidates.first() {
            let profile = ctx.shell.store.lock().unwrap().profile(&ext.key);
            if profile.borderless && ext.child.is_some() {
                crate::system::make_borderless(window);
            }
            crate::system::focus(window);
            ext.window = Some(window);
            ext.arranged = true;
            set_shell_minimized(&mut ctx, true);
        }
    }
    if finished {
        let seconds = ext.started.elapsed().as_secs_f64();
        ctx.shell
            .store
            .lock()
            .unwrap()
            .record_session(&ext.key, "external", seconds);
        set_shell_minimized(&mut ctx, false);
        ctx.shell.toast(tf("toast.back-from", &[("title", &ext.title)]));
    } else {
        ctx.running.external = Some(ext);
    }
}

/// Suspend the running machine to disk when the shell exits.
pub fn save_on_exit(
    mut exits: MessageReader<AppExit>,
    shell: Res<Shell>,
    mut running: ResMut<Running>,
    mut slot: Option<NonSendMut<MachineSlot>>,
    screen: Option<Res<MachineScreen>>,
    images: Res<Assets<Image>>,
) {
    if exits.read().next().is_none() {
        return;
    }
    if running.machine.is_some() && running.profile.as_ref().is_none_or(|p| p.instant_resume) {
        let _ = save_machine(
            &shell,
            &running,
            slot.as_deref_mut(),
            &images,
            screen.as_deref(),
        );
    }
    if let Some(recorder) = running.recorder.take() {
        let _ = recorder.stop();
    }
}

pub fn machine_info(running: &Running) -> Option<machine::Info> {
    running.machine.as_ref().map(|a| a.info.clone())
}

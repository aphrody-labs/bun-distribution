//! Game sessions: Bun Engine machines in-process (suspend/resume through save states, frame
//! upload into a Bevy image, input), Steam games through `steam://rungameid`, release emulators
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
use crate::assets::{Art, rgba_image};
use crate::library::{Kind, Library};
use crate::machine::{self, Host, Launch, Suspended, keys};
use crate::profiles::{FPS_LIMITS, Profile, SCALERS};
use crate::recorder::Recorder;
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

#[derive(Resource, Default)]
pub struct Running {
    pub machine: Option<Host>,
    pub machine_game: Option<usize>,
    pub suspended: bool,
    pub image: Handle<Image>,
    pub image_size: (u32, u32),
    pub last_seq: u64,
    pub last_upload: Option<Instant>,
    pub profile: Option<Profile>,
    pub recorder: Option<Recorder>,
    pub external: Option<External>,
    /// Frames presented by the shell while a machine is shown (for the HUD).
    pub presented: u64,
}

impl Running {
    pub fn machine_key(&self) -> Option<&str> {
        self.machine.as_ref().map(|m| m.key.as_str())
    }
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

/// Save the running machine's state and thumbnail under `shell/states`.
pub fn suspend_to_disk(shell: &Shell, running: &Running) -> Option<String> {
    let host = running.machine.as_ref()?;
    let state = host.save_state()?;
    let target = Suspended::of(&shell.paths.states(), &host.key);
    target.write(&state, host.snapshot()).ok()?;
    Some(target.state.display().to_string())
}

fn stop_machine(ctx: &mut Ctx, keep_state: bool) {
    if let Some(host) = ctx.running.machine.as_ref() {
        let instant = ctx
            .running
            .profile
            .as_ref()
            .is_none_or(|p| p.instant_resume);
        if keep_state && instant {
            match suspend_to_disk(&ctx.shell, &ctx.running) {
                Some(_) => {}
                None => ctx
                    .shell
                    .toast("This machine cannot save its state; it was closed"),
            }
        } else {
            Suspended::of(&ctx.shell.paths.states(), &host.key).discard();
        }
        let seconds = host.started.elapsed().as_secs_f64();
        ctx.shell
            .store
            .lock()
            .unwrap()
            .record_session(&host.key, "machine", seconds);
        let thumb = Suspended::of(&ctx.shell.paths.states(), &host.key).thumb;
        ctx.art.invalidate(&thumb);
    }
    if let Some(recorder) = ctx.running.recorder.take() {
        let _ = recorder.stop();
    }
    ctx.running.machine = None;
    ctx.running.machine_game = None;
    ctx.running.suspended = false;
}

fn ensure_image(ctx: &mut Ctx) {
    if ctx.running.image == Handle::default() || ctx.images.get(&ctx.running.image).is_none() {
        ctx.running.image = ctx.images.add(rgba_image(1, 1, vec![0, 0, 0, 255], true));
        ctx.running.image_size = (1, 1);
    }
}

pub fn play(ctx: &mut Ctx, index: usize, fresh: bool) {
    let Some(game) = ctx.shell.library.games.get(index).cloned() else {
        return;
    };
    ctx.shell.selected = index;
    match &game.kind {
        Kind::Native { system, path, .. } => {
            if ctx.running.machine_key() == Some(game.key.as_str()) && !fresh {
                if let Some(host) = &ctx.running.machine {
                    host.pause(false);
                }
                ctx.running.suspended = false;
                ctx.next_screen.set(Screen::Playing);
                ctx.shell.toast(format!("Resumed {} instantly", game.title));
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
            ensure_image(ctx);
            ctx.running.machine = Some(Host::spawn(Launch {
                key: game.key.clone(),
                system: system.clone(),
                image: path.clone(),
                bios,
                state,
            }));
            ctx.running.machine_game = Some(index);
            ctx.running.profile = Some(profile);
            ctx.running.suspended = false;
            ctx.running.last_seq = 0;
            ctx.next_screen.set(Screen::Playing);
            ctx.shell.toast(if resumed {
                format!("{}: resumed from its suspend state", game.title)
            } else {
                format!("{} on Bun Engine", game.title)
            });
        }
        Kind::Steam { app_id, installed } => {
            if !installed {
                let uri = format!("steam://nav/games/details/{app_id}");
                if bun_steam::launch::is_safe_steam_uri(&uri) && open_uri(&uri) {
                    ctx.shell.toast(format!(
                        "{} is not installed here: opened its Steam page",
                        game.title
                    ));
                }
                return;
            }
            if let Some(reason) = busy_reason() {
                ctx.shell
                    .toast(format!("Not launching {}: {reason}", game.title));
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
                    .toast(format!("Starting {} through Steam", game.title));
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
                        ctx.shell.toast(format!("Starting {}", game.title));
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
                    .toast(format!("{} opened in the browser (WebGPU)", game.title));
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
        return Some(format!("Steam app {running} is already running"));
    }
    #[cfg(windows)]
    for (_, _, name) in crate::system::processes() {
        let lower = name.to_ascii_lowercase();
        if crate::system::STREAMING.contains(&lower.as_str()) {
            return Some(format!("{name} (game streaming) is running"));
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
        ctx.running.image_size = (0, 0);
    }
}

fn quick(ctx: &mut Ctx, action: QuickAction) {
    match action {
        QuickAction::Home => {
            if let Some(key) = ctx.running.machine.as_ref().map(|host| {
                host.pause(true);
                host.key.clone()
            }) {
                ctx.running.suspended = true;
                if ctx
                    .running
                    .profile
                    .as_ref()
                    .is_none_or(|p| p.instant_resume)
                {
                    let saved = suspend_to_disk(&ctx.shell, &ctx.running);
                    ctx.art
                        .invalidate(&Suspended::of(&ctx.shell.paths.states(), &key).thumb);
                    ctx.shell.toast(if saved.is_some() {
                        "Suspended: instant resume ready"
                    } else {
                        "Paused (this core has no save states)"
                    });
                }
            }
            ctx.next_overlay.set(Overlay::Closed);
            ctx.next_screen.set(Screen::Home);
        }
        QuickAction::Resume => {
            ctx.next_overlay.set(Overlay::Closed);
            if ctx.running.machine.is_some() {
                if let Some(host) = &ctx.running.machine {
                    host.pause(false);
                }
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
                .toast(format!("Screenshot saved to {}", path.display()));
        }
        QuickAction::Record => {
            if let Some(recorder) = ctx.running.recorder.take() {
                let path = recorder.path.clone();
                match recorder.stop() {
                    Ok(encoder) => ctx
                        .shell
                        .toast(format!("Recorded {} with {encoder}", path.display())),
                    Err(e) => ctx.shell.toast(format!("Recording failed: {e}")),
                }
            } else if let Some(host) = &ctx.running.machine {
                let fps = host.info().refresh.round().max(1.0) as u32;
                let path = capture_path(&ctx.shell, &host.key, "mp4");
                ctx.running.recorder = Some(Recorder::start(path, fps));
                let encoder = ctx
                    .shell
                    .encoders
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "software H.264".into());
                ctx.shell.toast(format!("Recording ({encoder})"));
            } else {
                ctx.shell.toast(
                    "Recording captures Bun Engine games; use Steam or Windows capture for others",
                );
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
                ctx.shell.toast("Game closed");
            } else if let Some(ext) = &ctx.running.external {
                if ext.child.is_some() {
                    #[cfg(windows)]
                    if let Some(window) = ext.window {
                        crate::system::close(window);
                    }
                    ctx.shell.toast(format!("Asked {} to close", ext.title));
                } else {
                    ctx.shell.toast("Close Steam games from the game itself");
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
                let _ = suspend_to_disk(&ctx.shell, &ctx.running);
            }
            ctx.next_overlay.set(Overlay::Closed);
            #[cfg(windows)]
            crate::system::sleep();
        }
        PowerAction::Restart | PowerAction::Shutdown => {
            if ctx.running.machine.is_some() {
                let _ = suspend_to_disk(&ctx.shell, &ctx.running);
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
        SettingKey::Sounds => ctx.settings.sounds = !ctx.settings.sounds,
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
            ctx.shell.toast(format!("Library reloaded: {count} games"));
        }
        SettingKey::Session => {
            let command = crate::system::session_install_command();
            ctx.shell
                .toast(format!("Opt in from a terminal: {command}"));
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

/// Copies new machine frames into the shell image (and the recorder), honoring the frame limit.
pub fn upload_frames(mut running: ResMut<Running>, mut images: ResMut<Assets<Image>>) {
    let Some(host) = running.machine.as_ref() else {
        return;
    };
    let (seq, width, height, rgba) = {
        let frame = host.frame.lock().unwrap();
        if frame.seq == running.last_seq || frame.width == 0 {
            return;
        }
        (frame.seq, frame.width, frame.height, frame.rgba.clone())
    };
    let limit = running.profile.as_ref().map_or(0, |p| p.fps_limit);
    if limit > 0
        && running
            .last_upload
            .is_some_and(|t| t.elapsed() < Duration::from_secs_f64(1.0 / f64::from(limit)))
    {
        return;
    }
    running.last_seq = seq;
    running.last_upload = Some(Instant::now());
    if let Some(recorder) = &running.recorder {
        recorder.push(width, height, rgba.clone());
    }
    let nearest = running
        .profile
        .as_ref()
        .is_none_or(|p| p.scaler != "smooth");
    if running.image_size != (width, height) || images.get(&running.image).is_none() {
        running.image = images.add(rgba_image(width, height, rgba, nearest));
        running.image_size = (width, height);
    } else if let Some(mut image) = images.get_mut(&running.image) {
        image.data = Some(rgba);
    }
    running.presented += 1;
}

/// Keyboard and gamepads to machine buttons while a machine is shown without an overlay.
pub fn machine_input(
    keys_in: Res<ButtonInput<KeyCode>>,
    pads: Query<&Gamepad>,
    running: Res<Running>,
    overlay: Res<State<Overlay>>,
    mut last: Local<u32>,
) {
    let Some(host) = running.machine.as_ref() else {
        return;
    };
    let mut bits = 0;
    if *overlay.get() == Overlay::Closed {
        const KEYS: [(KeyCode, u32); 13] = [
            (KeyCode::KeyZ, keys::A),
            (KeyCode::KeyX, keys::B),
            (KeyCode::KeyA, keys::Y),
            (KeyCode::KeyS, keys::X),
            (KeyCode::KeyQ, keys::L),
            (KeyCode::KeyW, keys::R),
            (KeyCode::Enter, keys::START),
            (KeyCode::ShiftRight, keys::SELECT),
            (KeyCode::Backspace, keys::SELECT),
            (KeyCode::ArrowUp, keys::UP),
            (KeyCode::ArrowDown, keys::DOWN),
            (KeyCode::ArrowLeft, keys::LEFT),
            (KeyCode::ArrowRight, keys::RIGHT),
        ];
        for (key, bit) in KEYS {
            if keys_in.pressed(key) {
                bits |= bit;
            }
        }
        const PAD: [(GamepadButton, u32); 12] = [
            (GamepadButton::East, keys::A),
            (GamepadButton::South, keys::B),
            (GamepadButton::North, keys::X),
            (GamepadButton::West, keys::Y),
            (GamepadButton::LeftTrigger, keys::L),
            (GamepadButton::RightTrigger, keys::R),
            (GamepadButton::Start, keys::START),
            (GamepadButton::Select, keys::SELECT),
            (GamepadButton::DPadUp, keys::UP),
            (GamepadButton::DPadDown, keys::DOWN),
            (GamepadButton::DPadLeft, keys::LEFT),
            (GamepadButton::DPadRight, keys::RIGHT),
        ];
        for pad in &pads {
            if pad.pressed(GamepadButton::Select) && pad.pressed(GamepadButton::Start) {
                continue;
            }
            for (button, bit) in PAD {
                if pad.pressed(button) {
                    bits |= bit;
                }
            }
            let stick = pad.left_stick();
            if stick.x < -0.5 {
                bits |= keys::LEFT;
            } else if stick.x > 0.5 {
                bits |= keys::RIGHT;
            }
            if stick.y > 0.5 {
                bits |= keys::UP;
            } else if stick.y < -0.5 {
                bits |= keys::DOWN;
            }
        }
    }
    if bits != *last {
        *last = bits;
        host.set_input(bits);
    }
}

/// Pauses the machine while an overlay covers it, resumes when it closes.
pub fn pause_for_overlay(
    overlay: Res<State<Overlay>>,
    screen: Res<State<Screen>>,
    running: Res<Running>,
) {
    if !overlay.is_changed() {
        return;
    }
    if let Some(host) = &running.machine
        && *screen.get() == Screen::Playing
    {
        host.pause(*overlay.get() != Overlay::Closed);
    }
}

/// Leaving the game screen for anything but an overlay suspends the machine.
pub fn suspend_on_leave(shell: Res<Shell>, mut running: ResMut<Running>, mut art: ResMut<Art>) {
    if running.suspended {
        return;
    }
    if let Some(host) = &running.machine {
        host.pause(true);
        let key = host.key.clone();
        if running.profile.as_ref().is_none_or(|p| p.instant_resume) {
            let _ = suspend_to_disk(&shell, &running);
            art.invalidate(&Suspended::of(&shell.paths.states(), &key).thumb);
        }
        running.suspended = true;
    }
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
            ctx.shell.toast(format!("{} did not start", ext.title));
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
        ctx.shell.toast(format!("Back from {}", ext.title));
    } else {
        ctx.running.external = Some(ext);
    }
}

/// Suspend the running machine to disk when the shell exits.
pub fn save_on_exit(
    mut exits: MessageReader<AppExit>,
    shell: Res<Shell>,
    mut running: ResMut<Running>,
) {
    if exits.read().next().is_none() {
        return;
    }
    if running.machine.is_some() && running.profile.as_ref().is_none_or(|p| p.instant_resume) {
        let _ = suspend_to_disk(&shell, &running);
    }
    if let Some(recorder) = running.recorder.take() {
        let _ = recorder.stop();
    }
    running.machine = None;
}

pub fn machine_info(running: &Running) -> Option<machine::Info> {
    running.machine.as_ref().map(Host::info)
}

/// FSR 1 (EASU + RCAS) from the engine's post-process for machines whose profile selects it.
/// The pass replaces the camera output, so it is active only while no overlay covers the game.
pub fn fsr1_scaler(
    mut commands: Commands,
    running: Res<Running>,
    screen: Res<State<Screen>>,
    overlay: Res<State<Overlay>>,
    current: Option<Res<bun_engine::runtime::fsr1::Fsr1Upscale>>,
) {
    let wanted = *screen.get() == Screen::Playing
        && *overlay.get() == Overlay::Closed
        && running.machine.is_some()
        && running.image_size.0 > 1
        && running.profile.as_ref().is_some_and(|p| p.scaler == "fsr1");
    match (wanted, current) {
        (true, Some(c)) if c.image == running.image => {}
        (true, _) => commands.insert_resource(bun_engine::runtime::fsr1::Fsr1Upscale {
            image: running.image.clone(),
            sharpness_stops: 0.25,
        }),
        (false, Some(_)) => commands.remove_resource::<bun_engine::runtime::fsr1::Fsr1Upscale>(),
        (false, None) => {}
    }
}

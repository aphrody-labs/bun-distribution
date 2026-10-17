//! Bun OS console shell: a controller-first, full-screen Bevy 0.20 app with a Material 3 interface
//! over the Bun Engine machines, the Steam owner (`bun-steam`) and the bep emulator library.
//!
//! `bun-os-shell [--session] [--windowed WxH] [--script STEPS] [--shots DIR] [--stats FILE]`
//! `bun-os-shell status | install-session | uninstall-session | session-status`

pub mod app;
pub mod assets;
pub mod library;
pub mod machine;
pub mod nvidia;
pub mod overlay;
pub mod paths;
pub mod profiles;
pub mod recorder;
pub mod runtime;
pub mod screens;
pub mod script;
pub mod system;
pub mod text;
pub mod theme;
pub mod ui;

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Mutex;
use std::time::Duration;

use bevy::input_focus::InputFocusVisible;
use bevy::input_focus::directional_navigation::{
    AutoNavigationConfig, DirectionalNavigationPlugin,
};
use bevy::prelude::*;
use bevy::window::{
    CursorOptions, MonitorSelection, PresentMode, PrimaryWindow, RawHandleWrapper, WindowMode,
    WindowResolution,
};
use bevy::winit::{UpdateMode, WinitSettings};

use app::{Overlay, Screen, Shell};
use library::Library;
use paths::Paths;
use profiles::Store;

const USAGE: &str = "usage: bun-os-shell [--session|--fullscreen] [--windowed WxH] [--reduced-motion] [--script STEPS] [--shots DIR] [--stats FILE]\n       bun-os-shell status | install-session | uninstall-session | session-status";

struct Options {
    session: bool,
    fullscreen: bool,
    size: (u32, u32),
    reduced_motion: bool,
    script: Option<String>,
    shots: Option<PathBuf>,
    stats: Option<PathBuf>,
}

pub fn main(args: impl Iterator<Item = String>) -> ExitCode {
    let mut args = args.peekable();
    match args.peek().map(String::as_str) {
        Some("status") => return status(),
        Some("install-session") => return session(true),
        Some("uninstall-session") => return session(false),
        Some("session-status") => {
            #[cfg(windows)]
            println!(
                "{}",
                system::session_entry().unwrap_or_else(|| "not registered".into())
            );
            println!("opt in: {}", system::session_install_command());
            return ExitCode::SUCCESS;
        }
        Some("-h" | "--help") => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        _ => {}
    }
    let mut options = Options {
        session: false,
        fullscreen: false,
        size: (1600, 900),
        reduced_motion: false,
        script: None,
        shots: None,
        stats: None,
    };
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--session" => options.session = true,
            "--fullscreen" => options.fullscreen = true,
            "--reduced-motion" => options.reduced_motion = true,
            "--windowed" => {
                if let Some((w, h)) = args.next().as_deref().and_then(|s| s.split_once('x')) {
                    options.size = (w.parse().unwrap_or(1600), h.parse().unwrap_or(900));
                }
            }
            "--script" => options.script = args.next(),
            "--shots" => options.shots = args.next().map(PathBuf::from),
            "--stats" => options.stats = args.next().map(PathBuf::from),
            _ => {
                eprintln!("{USAGE}");
                return ExitCode::from(2);
            }
        }
    }
    run(options);
    ExitCode::SUCCESS
}

fn status() -> ExitCode {
    let paths = Paths::discover();
    let library = Library::load(&paths);
    let gpu = nvidia::read_once();
    #[cfg(windows)]
    let display = system::display_info(None);
    #[cfg(not(windows))]
    let display = system::DisplayInfo::default();
    let count = |s: library::Source| library.games.iter().filter(|g| g.source() == s).count();
    let report = serde_json::json!({
        "repo": paths.repo, "usr": paths.usr,
        "games": { "total": library.games.len(), "steam": count(library::Source::Steam), "emulators": count(library::Source::Emulators), "web": count(library::Source::Web) },
        "steamInstalled": library.games.iter().filter(|g| matches!(g.kind, library::Kind::Steam { installed: true, .. })).map(|g| &g.title).collect::<Vec<_>>(),
        "downloads": library.downloads.len(),
        "packages": library.packages.iter().map(|p| &p.id).collect::<Vec<_>>(),
        "steamRunningApp": system::steam_running_app(),
        "busy": runtime::busy_reason(),
        "gpu": {
            "available": gpu.available, "name": gpu.name, "driver": gpu.driver, "temperatureC": gpu.temperature_c,
            "coreMHz": gpu.core_mhz, "memoryMHz": gpu.memory_mhz, "loadPercent": gpu.load_percent,
            "powerW": gpu.power_w, "powerLimitW": gpu.power_limit_w, "vramUsedMB": gpu.vram_used_mb, "vramTotalMB": gpu.vram_total_mb,
            "vrr": gpu.vrr.map(|(on, possible, active)| serde_json::json!({"enabled": on, "possible": possible, "active": active})),
            "reflexApi": gpu.reflex_api, "error": gpu.error,
        },
        "display": { "name": display.name, "hdr": display.hdr, "bitsPerColor": display.bits_per_color, "maxNits": display.max_nits, "colorSpace": display.color_space },
        "hardwareEncoders": recorder::hardware_encoders(),
        "session": { "optIn": system::session_install_command() },
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&report).unwrap_or_default()
    );
    ExitCode::SUCCESS
}

fn session(install: bool) -> ExitCode {
    #[cfg(windows)]
    {
        let result = system::set_session_entry(install.then(system::session_command).as_deref());
        match result {
            Ok(()) => {
                println!(
                    "{} per-user startup entry HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\BunOSConsoleShell{}",
                    if install { "registered" } else { "removed" },
                    if install {
                        format!(" = {}", system::session_command())
                    } else {
                        String::new()
                    }
                );
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("bun-os-shell: {e}");
                ExitCode::FAILURE
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = install;
        eprintln!("bun-os-shell: use the Gamescope session on Linux");
        ExitCode::FAILURE
    }
}

fn run(options: Options) {
    let paths = Paths::discover();
    let store = Store::open(&paths.database());
    let settings = app::load_settings(&store);
    let library = Library::load(&paths);
    let gpu = nvidia::spawn_monitor();
    let encoders = recorder::hardware_encoders();
    let reduced = options.reduced_motion || runtime::reduced_motion(settings.motion);
    let selected = library
        .games
        .iter()
        .position(|g| g.title.to_ascii_lowercase().contains("alter ego"))
        .unwrap_or(0);
    let shots = options.shots.clone().unwrap_or_else(|| paths.captures());
    let _ = std::fs::create_dir_all(&shots);
    #[cfg(windows)]
    let volume = system::volume();
    #[cfg(not(windows))]
    let volume = None;
    let full = options.session || options.fullscreen;
    let shell = Shell {
        paths,
        library,
        store: Mutex::new(store),
        gpu,
        display: Default::default(),
        encoders,
        selected,
        hub: selected,
        filter: None,
        session: options.session,
        volume,
        toast: None,
        hwnd: None,
    };
    // Fluent catalogs (common + shell) for the negotiated locale, before any text is built.
    bun_os_platform::i18n::init(&["common", "shell"]);
    let theme = theme::Theme::default();
    let window = Window {
        title: text::t("app.name"),
        mode: if full {
            WindowMode::BorderlessFullscreen(MonitorSelection::Current)
        } else {
            WindowMode::Windowed
        },
        resolution: WindowResolution::new(options.size.0, options.size.1),
        present_mode: PresentMode::AutoVsync,
        ..default()
    };
    let mut script = script::Script {
        shots,
        stats_path: options.stats.clone(),
        ..default()
    };
    if let Some(text) = &options.script {
        script.steps = script::Script::parse(text);
    }
    App::new()
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(window),
            primary_cursor_options: Some(CursorOptions {
                visible: !options.session,
                ..default()
            }),
            ..default()
        }))
        .add_plugins(DirectionalNavigationPlugin)
        // Platform layer: locale/theme resources and messages, plugin menu entries, file types and
        // transfers through the Bun sidecar (docs/bun-os/PLATFORM.md).
        .add_plugins(bun_os_platform::bevy::PlatformPlugin {
            reduced_motion: reduced,
            ..bun_os_platform::bevy::PlatformPlugin::new(&["common", "shell"])
        })
        // The engine runtime on the shell's App: machine systems registered once
        // (InsertMachine/RemoveMachine), EngineInput from keyboard and pads, FSR1, machine audio.
        .add_plugins(bun_engine::runtime::BunEnginePlugin {
            default_plugins: false,
            escape_exits: false,
            camera: false,
            ..bun_engine::runtime::BunEnginePlugin::windowed(text::t("app.name"))
        })
        .insert_resource(WinitSettings {
            focused_mode: UpdateMode::Continuous,
            unfocused_mode: UpdateMode::reactive_low_power(Duration::from_millis(100)),
        })
        .insert_resource(ClearColor(theme.get(theme::R::SurfaceDim)))
        .insert_resource(InputFocusVisible(true))
        .insert_resource(AutoNavigationConfig {
            min_alignment_factor: 0.0,
            max_search_distance: None,
            prefer_aligned: true,
        })
        .insert_resource(theme)
        .insert_resource(shell)
        .insert_resource(settings)
        .insert_resource(ui::Motion { reduced })
        .insert_resource(script)
        .init_resource::<script::Stats>()
        .init_resource::<runtime::Running>()
        .init_resource::<ui::Repeat>()
        .init_resource::<assets::Art>()
        .init_state::<Screen>()
        .init_state::<Overlay>()
        .add_message::<ui::Intent>()
        .add_message::<ui::Activate>()
        .add_message::<ui::Feedback>()
        .add_systems(
            Startup,
            (assets::setup, make_kit, spawn_camera, screens::spawn_global).chain(),
        )
        .add_systems(OnEnter(Screen::Home), screens::spawn_home)
        .add_systems(OnEnter(Screen::Library), screens::spawn_library)
        .add_systems(OnEnter(Screen::Hub), screens::spawn_hub)
        .add_systems(OnEnter(Screen::Downloads), screens::spawn_downloads)
        .add_systems(OnEnter(Screen::Settings), screens::spawn_settings)
        .add_systems(OnEnter(Screen::Playing), screens::spawn_playing)
        .add_systems(OnExit(Screen::Playing), runtime::suspend_on_leave)
        .add_systems(OnEnter(Overlay::Quick), overlay::spawn_quick)
        .add_systems(OnEnter(Overlay::Power), overlay::spawn_power)
        .add_systems(
            Update,
            (
                script::record_frame,
                script::run_script,
                ui::gather,
                ui::sync_layers,
                ui::ensure_focus,
                ui::navigate,
                app::route_intents,
                runtime::dispatch,
                ui::feedback,
            )
                .chain(),
        )
        .add_systems(
            Update,
            (
                (assets::receive_art, screens::fill_art, ui::cover).chain(),
                ui::focus_fx,
                (screens::follow_focus, screens::animate_scroll).chain(),
                (screens::hero_and_tint, screens::tint_scrims, ui::apply_tint).chain(),
                screens::hero_actions.run_if(in_state(Screen::Home)),
                screens::update_bindings,
                overlay::animate_sheet,
                app::tick_toast,
                (runtime::sync_machine, screens::update_machine_view).chain(),
                runtime::pause_for_overlay,
                runtime::track_external,
                (ui_scale, capture_window, announce_pads),
            ),
        )
        .add_systems(Last, (runtime::save_on_exit, script::write_report))
        .add_observer(ui::on_pointer_over)
        .add_observer(ui::on_pointer_click)
        .add_observer(ui::on_pointer_scroll)
        .run();
}

fn make_kit(mut commands: Commands, fonts: Res<assets::Fonts>) {
    commands.insert_resource(ui::Kit::from_fonts(&fonts));
}

fn spawn_camera(mut commands: Commands) {
    commands.spawn(Camera2d);
}

/// Design units are 1080p: scale the whole UI with the window.
fn ui_scale(
    windows: Query<&Window, (With<PrimaryWindow>, Changed<Window>)>,
    mut scale: ResMut<UiScale>,
) {
    if let Ok(window) = windows.single() {
        let s = (window.height() / 1080.0)
            .min(window.width() / 1920.0)
            .max(0.3);
        if (scale.0 - s).abs() > 1e-3 {
            scale.0 = s;
        }
    }
}

/// Native window handle (focus management, HDR state of its monitor).
fn capture_window(
    mut shell: ResMut<Shell>,
    handles: Query<&RawHandleWrapper, With<PrimaryWindow>>,
) {
    if shell.hwnd.is_some() {
        return;
    }
    let Ok(handle) = handles.single() else { return };
    #[cfg(windows)]
    if let raw_window_handle::RawWindowHandle::Win32(h) = handle.get_window_handle() {
        let hwnd = h.hwnd.get();
        shell.hwnd = Some(hwnd);
        shell.display = system::display_info(Some(hwnd));
        info!("display: {}", shell.display.summary());
    }
    #[cfg(not(windows))]
    {
        let _ = handle;
        shell.hwnd = Some(0);
    }
}

fn announce_pads(pads: Query<(&Gamepad, Option<&Name>), Added<Gamepad>>, mut shell: ResMut<Shell>) {
    for (pad, name) in &pads {
        let name = name.map_or_else(|| "Controller".to_string(), |n| n.to_string());
        let vendor = pad
            .vendor_id()
            .map(|v| format!(" ({v:04x})"))
            .unwrap_or_default();
        shell.toast(text::tf("toast.controller", &[("name", &format!("{name}{vendor}"))]));
    }
}

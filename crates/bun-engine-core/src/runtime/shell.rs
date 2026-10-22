//! Shell UI over a running machine (feature `shell`): app states, the quick menu (Resume, Save,
//! Load, Screenshot, Stop) and a performance overlay, all in `bevy_ui`.
//!
//! - [`ShellState`] (`bevy_state`): `Home` (no machine), `Playing`, `QuickMenu`. Entering the menu
//!   pauses the machine ([`MachineStatus::paused`]) and leaving it restores the previous value.
//! - The menu opens with `F1` or the gamepad Mode button, moves with Up/Down or the D-pad,
//!   activates with Enter, Space or South, and closes with Backspace or East (Escape stays "exit").
//! - Save and Load go through the existing [`SaveState`] / [`LoadState`] messages
//!   (`<state_dir>/<machine>.state`); their [`MachineStateResult`] is shown as a toast.
//! - `F3` toggles the overlay: frames per second, frame time and the machine's frame count.
//!
//! Colours are the dark fallbacks of the Material 3 roles in `docs/bun-engine/design/tokens.json`;
//! the focus ring is a solid 3 px outline in the accent role.

use std::path::PathBuf;

use crate::bevy::{
    app::{App, AppExit, Plugin, Startup, Update},
    color::Color,
    diagnostic::{DiagnosticsStore, FrameTimeDiagnosticsPlugin},
    ecs::prelude::*,
    input::{
        ButtonInput,
        gamepad::{Gamepad, GamepadButton},
        keyboard::KeyCode,
    },
    state::prelude::*,
    text::{FontSize, TextColor, TextFont},
    time::Time,
    ui::{
        AlignItems, BackgroundColor, BorderRadius, FlexDirection, GlobalZIndex, JustifyContent,
        Node, Outline, PositionType, UiRect, Val, widget::Text,
    },
};

use super::{
    LoadState, MachineScreen, MachineSlot, MachineStateResult, MachineStatus, RemoveMachine,
    SaveState,
};

/// Where the shell is.
#[derive(States, Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum ShellState {
    /// No machine is installed (the library UI belongs here).
    Home,
    /// A machine is running.
    #[default]
    Playing,
    /// The quick menu is open and the machine is paused.
    QuickMenu,
}

/// Quick menu entries, in display order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuickAction {
    Resume,
    Save,
    Load,
    Screenshot,
    Stop,
}

impl QuickAction {
    pub const ALL: [QuickAction; 5] = [
        QuickAction::Resume,
        QuickAction::Save,
        QuickAction::Load,
        QuickAction::Screenshot,
        QuickAction::Stop,
    ];

    pub fn label(self) -> &'static str {
        match self {
            QuickAction::Resume => "Resume",
            QuickAction::Save => "Save state",
            QuickAction::Load => "Load state",
            QuickAction::Screenshot => "Screenshot",
            QuickAction::Stop => "Stop",
        }
    }
}

/// Shell settings.
#[derive(Resource, Clone, Debug)]
pub struct ShellConfig {
    /// Saved states and screenshots are written below this directory.
    pub state_dir: PathBuf,
    /// Opens and closes the quick menu (the gamepad Mode button does too).
    pub menu_key: KeyCode,
    /// Shows and hides the performance overlay.
    pub overlay_key: KeyCode,
    pub overlay: bool,
}

impl Default for ShellConfig {
    fn default() -> Self {
        Self {
            state_dir: PathBuf::from("saves"),
            menu_key: KeyCode::F1,
            overlay_key: KeyCode::F3,
            overlay: false,
        }
    }
}

/// Material 3 dark role fallbacks (docs/bun-engine/design/tokens.json).
mod role {
    use crate::bevy::color::Color;
    pub const SURFACE: Color = Color::srgba(0.059, 0.075, 0.114, 0.94);
    pub const SURFACE_HIGH: Color = Color::srgb(0.082, 0.102, 0.153);
    pub const TEXT: Color = Color::srgb(0.933, 0.949, 0.984);
    pub const TEXT_MUTED: Color = Color::srgb(0.553, 0.592, 0.690);
    pub const ACCENT: Color = Color::srgb(1.0, 0.827, 0.302);
}

/// Focus ring width in logical pixels.
const RING: f32 = 3.0;

#[derive(Resource, Default)]
struct MenuCursor(usize);

/// The `paused` value to restore when the menu closes.
#[derive(Resource, Default)]
struct WasPaused(bool);

#[derive(Resource, Default)]
struct Toast {
    text: String,
    until: f64,
}

#[derive(Component)]
struct MenuItem(usize);

#[derive(Component)]
struct PerfText;

#[derive(Component)]
struct ToastText;

/// Adds the states, the quick menu and the overlay. Added by `BunEnginePlugin`.
#[derive(Default)]
pub struct ShellPlugin;

impl Plugin for ShellPlugin {
    fn build(&self, app: &mut App) {
        if !app.is_plugin_added::<FrameTimeDiagnosticsPlugin>() {
            app.add_plugins(FrameTimeDiagnosticsPlugin::default());
        }
        app.init_state::<ShellState>()
            .init_resource::<ShellConfig>()
            .init_resource::<MenuCursor>()
            .init_resource::<WasPaused>()
            .init_resource::<Toast>()
            .add_systems(Startup, spawn_hud)
            .add_systems(OnEnter(ShellState::QuickMenu), open_menu)
            .add_systems(OnExit(ShellState::QuickMenu), close_menu)
            .add_systems(
                Update,
                (
                    sync_state,
                    toggle_menu,
                    navigate.run_if(in_state(ShellState::QuickMenu)),
                    highlight.run_if(in_state(ShellState::QuickMenu)),
                    collect_results,
                    update_hud,
                )
                    .chain(),
            );
    }
}

fn spawn_hud(mut commands: Commands) {
    commands.spawn((
        Node {
            position_type: PositionType::Absolute,
            left: Val::Px(12.0),
            top: Val::Px(8.0),
            ..Default::default()
        },
        GlobalZIndex(100),
        Text::new(""),
        TextFont {
            font_size: FontSize::Px(16.0),
            ..Default::default()
        },
        TextColor(role::ACCENT),
        PerfText,
    ));
    commands.spawn((
        Node {
            position_type: PositionType::Absolute,
            left: Val::Px(12.0),
            bottom: Val::Px(8.0),
            ..Default::default()
        },
        GlobalZIndex(100),
        Text::new(""),
        TextFont {
            font_size: FontSize::Px(18.0),
            ..Default::default()
        },
        TextColor(role::TEXT),
        ToastText,
    ));
}

/// `Home` without a machine, `Playing` with one.
fn sync_state(
    status: Option<Res<MachineStatus>>,
    state: Res<State<ShellState>>,
    mut next: ResMut<NextState<ShellState>>,
) {
    let want = match (status.is_some(), **state) {
        (false, _) => ShellState::Home,
        (true, ShellState::Home) => ShellState::Playing,
        (true, current) => current,
    };
    if want != **state {
        next.set(want);
    }
}

fn toggle_menu(
    keys: Option<Res<ButtonInput<KeyCode>>>,
    pads: Query<&Gamepad>,
    mut config: ResMut<ShellConfig>,
    state: Res<State<ShellState>>,
    mut next: ResMut<NextState<ShellState>>,
) {
    let key = |k: KeyCode| keys.as_ref().is_some_and(|keys| keys.just_pressed(k));
    if key(config.overlay_key) {
        config.overlay = !config.overlay;
    }
    if key(config.menu_key) || pads.iter().any(|p| p.just_pressed(GamepadButton::Mode)) {
        match **state {
            ShellState::Playing => next.set(ShellState::QuickMenu),
            ShellState::QuickMenu => next.set(ShellState::Playing),
            ShellState::Home => {}
        }
    }
}

fn open_menu(
    mut commands: Commands,
    mut cursor: ResMut<MenuCursor>,
    mut was: ResMut<WasPaused>,
    status: Option<ResMut<MachineStatus>>,
) {
    cursor.0 = 0;
    if let Some(mut status) = status {
        was.0 = status.paused;
        status.paused = true;
    }
    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..Default::default()
            },
            BackgroundColor(Color::srgba(0.027, 0.035, 0.059, 0.6)),
            GlobalZIndex(90),
            DespawnOnExit(ShellState::QuickMenu),
        ))
        .with_children(|root| {
            root.spawn((
                Node {
                    flex_direction: FlexDirection::Column,
                    padding: UiRect::all(Val::Px(20.0)),
                    row_gap: Val::Px(10.0),
                    min_width: Val::Px(320.0),
                    border_radius: BorderRadius::all(Val::Px(16.0)),
                    ..Default::default()
                },
                BackgroundColor(role::SURFACE),
            ))
            .with_children(|panel| {
                for (i, action) in QuickAction::ALL.into_iter().enumerate() {
                    panel.spawn((
                        Node {
                            padding: UiRect::axes(Val::Px(18.0), Val::Px(12.0)),
                            border_radius: BorderRadius::all(Val::Px(10.0)),
                            ..Default::default()
                        },
                        BackgroundColor(role::SURFACE_HIGH),
                        Outline::new(Val::Px(RING), Val::Px(2.0), Color::NONE),
                        MenuItem(i),
                        Text::new(action.label()),
                        TextFont {
                            font_size: FontSize::Px(22.0),
                            ..Default::default()
                        },
                        TextColor(role::TEXT),
                    ));
                }
                panel.spawn((
                    Text::new("Up/Down choose   Enter select   Backspace back"),
                    TextFont {
                        font_size: FontSize::Px(14.0),
                        ..Default::default()
                    },
                    TextColor(role::TEXT_MUTED),
                ));
            });
        });
}

fn close_menu(was: Res<WasPaused>, status: Option<ResMut<MachineStatus>>) {
    if let Some(mut status) = status {
        status.paused = was.0;
    }
}

#[allow(clippy::too_many_arguments)]
fn navigate(
    keys: Option<Res<ButtonInput<KeyCode>>>,
    pads: Query<&Gamepad>,
    mut cursor: ResMut<MenuCursor>,
    config: Res<ShellConfig>,
    status: Option<Res<MachineStatus>>,
    slot: Option<NonSend<MachineSlot>>,
    screen: Option<Res<MachineScreen>>,
    mut next: ResMut<NextState<ShellState>>,
    mut saves: MessageWriter<SaveState>,
    mut loads: MessageWriter<LoadState>,
    mut exit: MessageWriter<AppExit>,
    mut toast: ResMut<Toast>,
    time: Res<Time>,
    mut commands: Commands,
) {
    let key = |codes: &[KeyCode]| {
        keys.as_ref()
            .is_some_and(|keys| codes.iter().any(|c| keys.just_pressed(*c)))
    };
    let pad = |button: GamepadButton| pads.iter().any(|p| p.just_pressed(button));
    let len = QuickAction::ALL.len();
    if key(&[KeyCode::ArrowDown, KeyCode::KeyS]) || pad(GamepadButton::DPadDown) {
        cursor.0 = (cursor.0 + 1) % len;
    }
    if key(&[KeyCode::ArrowUp, KeyCode::KeyW]) || pad(GamepadButton::DPadUp) {
        cursor.0 = (cursor.0 + len - 1) % len;
    }
    if key(&[KeyCode::Backspace]) || pad(GamepadButton::East) {
        next.set(ShellState::Playing);
        return;
    }
    if !(key(&[KeyCode::Enter, KeyCode::Space]) || pad(GamepadButton::South)) {
        return;
    }
    let Some(status) = status else { return };
    let state_path = config.state_dir.join(format!("{}.state", status.name));
    let mut say = |text: String| {
        toast.text = text;
        toast.until = time.elapsed_secs_f64() + 3.0;
    };
    match QuickAction::ALL[cursor.0.min(len - 1)] {
        QuickAction::Resume => {
            next.set(ShellState::Playing);
        }
        QuickAction::Save => {
            saves.write(SaveState { path: state_path });
            next.set(ShellState::Playing);
        }
        QuickAction::Load => {
            loads.write(LoadState { path: state_path });
            next.set(ShellState::Playing);
        }
        QuickAction::Screenshot => {
            if let (Some(slot), Some(screen)) = (slot, screen) {
                let (w, h, rgb) = super::view::capture_rgb(&slot, &screen);
                let path = config
                    .state_dir
                    .join("screenshots")
                    .join(format!("{}-{}.ppm", status.name, status.frames));
                let mut ppm = format!("P6\n{w} {h}\n255\n").into_bytes();
                ppm.extend_from_slice(&rgb);
                let written = path
                    .parent()
                    .map_or(Ok(()), std::fs::create_dir_all)
                    .and_then(|()| std::fs::write(&path, ppm));
                say(match written {
                    Ok(()) => format!("Screenshot: {}", path.display()),
                    Err(e) => format!("Screenshot failed: {e}"),
                });
            }
            next.set(ShellState::Playing);
        }
        QuickAction::Stop => {
            if status.exit_on_stop {
                exit.write(AppExit::Success);
            }
            commands.queue(RemoveMachine);
            next.set(ShellState::Home);
        }
    }
}

fn highlight(
    cursor: Res<MenuCursor>,
    mut items: Query<(&MenuItem, &mut Outline, &mut BackgroundColor)>,
) {
    for (item, mut outline, mut background) in &mut items {
        let focused = item.0 == cursor.0;
        outline.color = if focused { role::ACCENT } else { Color::NONE };
        background.0 = if focused {
            Color::srgb(0.12, 0.14, 0.2)
        } else {
            role::SURFACE_HIGH
        };
    }
}

fn collect_results(mut results: MessageReader<MachineStateResult>, mut toast: ResMut<Toast>, time: Res<Time>) {
    for result in results.read() {
        toast.text = match result {
            MachineStateResult::Saved(Ok(p)) => format!("Saved: {}", p.display()),
            MachineStateResult::Saved(Err(e)) => format!("Save failed: {e}"),
            MachineStateResult::Loaded(Ok(p)) => format!("Loaded: {}", p.display()),
            MachineStateResult::Loaded(Err(e)) => format!("Load failed: {e}"),
        };
        toast.until = time.elapsed_secs_f64() + 3.0;
    }
}

fn update_hud(
    config: Res<ShellConfig>,
    toast: Res<Toast>,
    time: Res<Time>,
    diagnostics: Res<DiagnosticsStore>,
    status: Option<Res<MachineStatus>>,
    mut perf: Query<&mut Text, (With<PerfText>, Without<ToastText>)>,
    mut toasts: Query<&mut Text, (With<ToastText>, Without<PerfText>)>,
) {
    let measured = |path| {
        diagnostics
            .get(path)
            .and_then(|d| d.smoothed())
            .unwrap_or(0.0)
    };
    let line = if config.overlay {
        let machine = status.as_ref().map_or(String::new(), |s| {
            format!(
                "  {} frame {}{}",
                s.name,
                s.frames,
                if s.paused { " (paused)" } else { "" }
            )
        });
        format!(
            "{:.0} fps  {:.1} ms{machine}",
            measured(&FrameTimeDiagnosticsPlugin::FPS),
            measured(&FrameTimeDiagnosticsPlugin::FRAME_TIME),
        )
    } else {
        String::new()
    };
    for mut text in &mut perf {
        if text.0 != line {
            text.0 = line.clone();
        }
    }
    let shown = if time.elapsed_secs_f64() < toast.until {
        toast.text.as_str()
    } else {
        ""
    };
    for mut text in &mut toasts {
        if text.0 != shown {
            text.0 = shown.to_owned();
        }
    }
}

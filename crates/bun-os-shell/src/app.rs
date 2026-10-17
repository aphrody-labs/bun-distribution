//! The Bevy app: states (screens and overlays), shell resources, the action dispatcher and the
//! back/guide/tab handling shared by every screen.

use std::sync::{Arc, Mutex};

use bevy::prelude::*;

use crate::library::{Library, Source};
use crate::nvidia::GpuState;
use crate::paths::Paths;
use crate::profiles::Store;
use crate::system::DisplayInfo;
use crate::ui::{Feedback, Intent};

#[derive(States, Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Screen {
    #[default]
    Home,
    Library,
    Hub,
    Downloads,
    Settings,
    Playing,
}

#[derive(States, Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Overlay {
    #[default]
    Closed,
    Quick,
    Power,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProfileField {
    FrameLimit,
    Scaler,
    Borderless,
    InstantResume,
    Hud,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SettingKey {
    Haptics,
    Motion,
    Hud,
    Rescan,
    Session,
    Desktop,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuickAction {
    Home,
    Resume,
    Screenshot,
    Record,
    Hud,
    FrameLimit,
    Scaling,
    VolumeDown,
    VolumeUp,
    CloseGame,
    Power,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PowerAction {
    Sleep,
    Restart,
    Shutdown,
    Desktop,
    Cancel,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    /// Launch or resume library game `i`.
    Play(usize),
    Hub(usize),
    /// Discard the suspend state of game `i` and start it fresh.
    Fresh(usize),
    Go(Screen),
    Filter(Option<Source>),
    ReturnToGame,
    Profile(usize, ProfileField),
    Setting(SettingKey),
    Quick(QuickAction),
    Power(PowerAction),
    Noop,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MotionPref {
    System,
    Reduced,
    Full,
}

#[derive(Resource, Clone)]
pub struct Settings {
    pub haptics: bool,
    pub hud: bool,
    pub motion: MotionPref,
}

#[derive(Resource)]
pub struct Shell {
    pub paths: Paths,
    pub library: Library,
    pub store: Mutex<Store>,
    pub gpu: Arc<Mutex<GpuState>>,
    pub display: DisplayInfo,
    pub encoders: Vec<String>,
    /// Game shown in the home hero.
    pub selected: usize,
    /// Game of the hub page.
    pub hub: usize,
    pub filter: Option<Source>,
    pub session: bool,
    pub volume: Option<f32>,
    pub toast: Option<(String, f32)>,
    pub hwnd: Option<isize>,
}

impl Shell {
    pub fn toast(&mut self, message: impl Into<String>) {
        let message = message.into();
        info!("{message}");
        self.toast = Some((message, crate::theme::timing::TOAST));
    }

    pub fn visible_games(&self) -> Vec<usize> {
        self.library
            .games
            .iter()
            .enumerate()
            .filter(|(_, g)| self.filter.is_none_or(|f| g.source() == f))
            .map(|(i, _)| i)
            .collect()
    }
}

/// Back, Guide and tab intents.
#[allow(clippy::too_many_arguments)]
pub fn route_intents(
    mut intents: MessageReader<Intent>,
    screen: Res<State<Screen>>,
    overlay: Res<State<Overlay>>,
    mut next_screen: ResMut<NextState<Screen>>,
    mut next_overlay: ResMut<NextState<Overlay>>,
    mut feedback: MessageWriter<Feedback>,
    running: Res<crate::runtime::Running>,
) {
    for intent in intents.read() {
        match intent {
            Intent::Guide => {
                feedback.write(Feedback::Open);
                next_overlay.set(if *overlay.get() == Overlay::Closed {
                    Overlay::Quick
                } else {
                    Overlay::Closed
                });
            }
            Intent::Back => {
                feedback.write(Feedback::Back);
                match (*overlay.get(), *screen.get()) {
                    (Overlay::Power, _) => next_overlay.set(Overlay::Quick),
                    (Overlay::Quick, _) => next_overlay.set(Overlay::Closed),
                    (_, Screen::Hub | Screen::Library | Screen::Downloads | Screen::Settings) => {
                        next_screen.set(Screen::Home);
                    }
                    _ => {}
                }
            }
            Intent::PrevTab | Intent::NextTab if *overlay.get() == Overlay::Closed => {
                const TABS: [Screen; 4] = [
                    Screen::Home,
                    Screen::Library,
                    Screen::Downloads,
                    Screen::Settings,
                ];
                if let Some(at) = TABS.iter().position(|s| s == screen.get()) {
                    let step = if *intent == Intent::NextTab {
                        1
                    } else {
                        TABS.len() - 1
                    };
                    feedback.write(Feedback::Navigate);
                    next_screen.set(TABS[(at + step) % TABS.len()]);
                } else if *screen.get() == Screen::Hub {
                    next_screen.set(Screen::Home);
                }
            }
            _ => {}
        }
        let _ = &running;
    }
}

pub fn tick_toast(time: Res<Time>, mut shell: ResMut<Shell>) {
    if let Some((_, left)) = shell.toast.as_mut() {
        *left -= time.delta_secs();
        if *left <= 0.0 {
            shell.toast = None;
        }
    }
}

pub fn load_settings(store: &Store) -> Settings {
    let flag = |name: &str, default: bool| store.setting(name).map_or(default, |v| v == "1");
    Settings {
        haptics: flag("haptics", true),
        hud: flag("hud", false),
        motion: match store.setting("motion").as_deref() {
            Some("reduced") => MotionPref::Reduced,
            Some("full") => MotionPref::Full,
            _ => MotionPref::System,
        },
    }
}

pub fn save_settings(store: &Store, settings: &Settings) {
    store.set_setting("haptics", if settings.haptics { "1" } else { "0" });
    store.set_setting("hud", if settings.hud { "1" } else { "0" });
    store.set_setting(
        "motion",
        match settings.motion {
            MotionPref::System => "system",
            MotionPref::Reduced => "reduced",
            MotionPref::Full => "full",
        },
    );
}

/// Current local time as HH:MM.
pub fn clock() -> String {
    #[cfg(windows)]
    {
        // SAFETY: GetLocalTime fills a plain struct.
        let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
        format!("{:02}:{:02}", t.wHour, t.wMinute)
    }
    #[cfg(not(windows))]
    {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        format!("{:02}:{:02}", (secs / 3600) % 24, (secs / 60) % 60)
    }
}

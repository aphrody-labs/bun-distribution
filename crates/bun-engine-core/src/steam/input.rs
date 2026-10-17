//! Steam Input: two action sets (`emulator` for the machine keys bitmask, `menu` for the
//! controller-first frontend), the generated In-Game Actions file, the Input Action Manifest and
//! one default controller configuration per controller family, and a poller that turns digital
//! actions into the shared window's XInput-layout [`Pad`].

use std::{
    fmt::Write as _,
    path::{Path, PathBuf},
};

use steamworks::{Client, sys};

use crate::{
    machine::keys,
    window::{Pad, pad_buttons},
};

pub const EMULATOR_SET: &str = "emulator";
pub const MENU_SET: &str = "menu";

/// One digital action: name, localized title, machine key bit and XInput bit it drives.
pub struct Action {
    pub name: &'static str,
    pub title: &'static str,
    pub key: u32,
    pub pad: u16,
    /// Default physical source in the controller configuration.
    pub source: Source,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Diamond(&'static str),
    Dpad(&'static str),
    Switch(&'static str),
}

/// The `emulator` set: one action per bit of [`crate::machine::keys`].
pub const EMULATOR_ACTIONS: [Action; 12] = [
    Action {
        name: "a",
        title: "A",
        key: keys::A,
        pad: pad_buttons::A,
        source: Source::Diamond("button_a"),
    },
    Action {
        name: "b",
        title: "B",
        key: keys::B,
        pad: pad_buttons::B,
        source: Source::Diamond("button_b"),
    },
    Action {
        name: "x",
        title: "X",
        key: keys::X,
        pad: pad_buttons::X,
        source: Source::Diamond("button_x"),
    },
    Action {
        name: "y",
        title: "Y",
        key: keys::Y,
        pad: pad_buttons::Y,
        source: Source::Diamond("button_y"),
    },
    Action {
        name: "l",
        title: "L",
        key: keys::L,
        pad: pad_buttons::LEFT_SHOULDER,
        source: Source::Switch("left_bumper"),
    },
    Action {
        name: "r",
        title: "R",
        key: keys::R,
        pad: pad_buttons::RIGHT_SHOULDER,
        source: Source::Switch("right_bumper"),
    },
    Action {
        name: "start",
        title: "Start",
        key: keys::START,
        pad: pad_buttons::START,
        source: Source::Switch("button_escape"),
    },
    Action {
        name: "select",
        title: "Select",
        key: keys::SELECT,
        pad: pad_buttons::BACK,
        source: Source::Switch("button_menu"),
    },
    Action {
        name: "up",
        title: "Up",
        key: keys::UP,
        pad: pad_buttons::DPAD_UP,
        source: Source::Dpad("dpad_north"),
    },
    Action {
        name: "down",
        title: "Down",
        key: keys::DOWN,
        pad: pad_buttons::DPAD_DOWN,
        source: Source::Dpad("dpad_south"),
    },
    Action {
        name: "left",
        title: "Left",
        key: keys::LEFT,
        pad: pad_buttons::DPAD_LEFT,
        source: Source::Dpad("dpad_west"),
    },
    Action {
        name: "right",
        title: "Right",
        key: keys::RIGHT,
        pad: pad_buttons::DPAD_RIGHT,
        source: Source::Dpad("dpad_east"),
    },
];

/// The `menu` set used by the controller-first frontend (Steam Deck, Big Picture, gamescope).
pub const MENU_ACTIONS: [Action; 6] = [
    Action {
        name: "menu_up",
        title: "Menu up",
        key: keys::UP,
        pad: pad_buttons::DPAD_UP,
        source: Source::Dpad("dpad_north"),
    },
    Action {
        name: "menu_down",
        title: "Menu down",
        key: keys::DOWN,
        pad: pad_buttons::DPAD_DOWN,
        source: Source::Dpad("dpad_south"),
    },
    Action {
        name: "menu_left",
        title: "Menu left",
        key: keys::LEFT,
        pad: pad_buttons::DPAD_LEFT,
        source: Source::Dpad("dpad_west"),
    },
    Action {
        name: "menu_right",
        title: "Menu right",
        key: keys::RIGHT,
        pad: pad_buttons::DPAD_RIGHT,
        source: Source::Dpad("dpad_east"),
    },
    Action {
        name: "menu_select",
        title: "Select",
        key: keys::A,
        pad: pad_buttons::A,
        source: Source::Diamond("button_a"),
    },
    Action {
        name: "menu_cancel",
        title: "Back",
        key: keys::B,
        pad: pad_buttons::B,
        source: Source::Diamond("button_b"),
    },
];

/// Controller families with a generated default configuration (`controller_type` values).
pub const CONTROLLER_TYPES: [&str; 8] = [
    "controller_xboxone",
    "controller_xbox360",
    "controller_ps4",
    "controller_ps5",
    "controller_switch_pro",
    "controller_steamcontroller_gordon",
    "controller_neptune",
    "controller_generic",
];

pub const MANIFEST_FILE: &str = "bun_engine_actions.vdf";

/// Minimal text KeyValues writer (tabs, quoted keys and values).
struct Kv(String, usize);

impl Kv {
    fn new() -> Self {
        Self(String::new(), 0)
    }
    fn open(&mut self, key: &str) -> &mut Self {
        let pad = "\t".repeat(self.1);
        let _ = writeln!(self.0, "{pad}\"{key}\"\n{pad}{{");
        self.1 += 1;
        self
    }
    fn close(&mut self) -> &mut Self {
        self.1 -= 1;
        let pad = "\t".repeat(self.1);
        let _ = writeln!(self.0, "{pad}}}");
        self
    }
    fn kv(&mut self, key: &str, value: &str) -> &mut Self {
        let pad = "\t".repeat(self.1);
        let _ = writeln!(self.0, "{pad}\"{key}\"\t\t\"{value}\"");
        self
    }
}

fn set_title(set: &str) -> &'static str {
    if set == EMULATOR_SET {
        "Emulator"
    } else {
        "Menu"
    }
}

fn sets() -> [(&'static str, &'static [Action]); 2] {
    [(EMULATOR_SET, &EMULATOR_ACTIONS), (MENU_SET, &MENU_ACTIONS)]
}

fn write_actions(kv: &mut Kv) {
    kv.open("actions");
    for (set, actions) in sets() {
        kv.open(set).kv("title", &format!("#Set_{set}"));
        kv.open("Button");
        for action in actions {
            kv.kv(action.name, &format!("#Action_{}", action.name));
        }
        kv.close().close();
    }
    kv.close();
}

fn write_localization(kv: &mut Kv) {
    kv.open("localization").open("english");
    for (set, actions) in sets() {
        kv.kv(&format!("Set_{set}"), set_title(set));
        for action in actions {
            kv.kv(&format!("Action_{}", action.name), action.title);
        }
    }
    kv.close().close();
}

/// `game_actions_<appid>.vdf`: the In-Game Actions file Steam reads from `controller_config/`
/// during development, before a configuration is published.
pub fn in_game_actions() -> String {
    let mut kv = Kv::new();
    kv.open("In Game Actions");
    write_actions(&mut kv);
    write_localization(&mut kv);
    kv.close();
    kv.0
}

/// The Input Action Manifest passed to `SetInputActionManifestFilePath`: actions, localization
/// and the default configuration file of every controller family.
pub fn action_manifest(app_id: u32) -> String {
    let mut kv = Kv::new();
    kv.open("Action Manifest");
    kv.open("configurations").open(&app_id.to_string());
    for controller in CONTROLLER_TYPES {
        kv.open(controller)
            .open("0")
            .kv("path", &controller_file(controller))
            .close()
            .close();
    }
    kv.close().close();
    write_actions(&mut kv);
    write_localization(&mut kv);
    kv.close();
    kv.0
}

pub fn controller_file(controller: &str) -> String {
    format!("bun_engine_{controller}.vdf")
}

fn binding(kv: &mut Kv, input: &str, set: &str, action: &str) {
    kv.open(input)
        .open("activators")
        .open("Full_Press")
        .open("bindings");
    kv.kv("binding", &format!("game_action {set} {action}"));
    kv.close()
        .close()
        .close()
        .open("disabled_activators")
        .close()
        .close();
}

/// A default controller configuration: face buttons, d-pad, left stick as a d-pad, bumpers,
/// Start/Back, one preset per action set.
pub fn controller_config(controller: &str) -> String {
    let mut kv = Kv::new();
    kv.open("controller_mappings")
        .kv("version", "3")
        .kv("revision", "1")
        .kv("title", "Bun Engine")
        .kv(
            "description",
            "Bun Engine default layout: machine keys and the controller-first menu",
        )
        .kv("creator", "0")
        .kv("progenitor", "")
        .kv("url", "")
        .kv("export_type", "unknown")
        .kv("controller_type", controller)
        .kv("major_revision", "0")
        .kv("minor_revision", "0")
        .kv("Timestamp", "0");
    write_actions(&mut kv);
    kv.open("action_layers").close();
    write_localization(&mut kv);
    let mut group = 0;
    let mut presets = Vec::new();
    for (preset, (set, actions)) in sets().into_iter().enumerate() {
        let mut sources = Vec::new();
        for (mode, source_name, pick) in [
            ("four_buttons", "button_diamond", 0u8),
            ("dpad", "dpad", 1),
            ("dpad", "joystick", 1),
            ("switches", "switch", 2),
        ] {
            let inputs: Vec<(&str, &str)> = actions
                .iter()
                .filter_map(|a| match (a.source, pick) {
                    (Source::Diamond(i), 0) | (Source::Dpad(i), 1) | (Source::Switch(i), 2) => {
                        Some((i, a.name))
                    }
                    _ => None,
                })
                .collect();
            if inputs.is_empty() {
                continue;
            }
            kv.open("group")
                .kv("id", &group.to_string())
                .kv("mode", mode)
                .kv("name", "")
                .kv("description", "");
            kv.open("inputs");
            for (input, action) in inputs {
                binding(&mut kv, input, set, action);
            }
            kv.close().close();
            sources.push((group, source_name));
            group += 1;
        }
        presets.push((preset, set, sources));
    }
    for (id, set, sources) in presets {
        kv.open("preset").kv("id", &id.to_string()).kv("name", set);
        kv.open("group_source_bindings");
        for (group, source) in sources {
            kv.kv(&group.to_string(), &format!("{source} active"));
        }
        kv.close().close();
    }
    kv.open("settings").close();
    kv.close();
    kv.0
}

/// Writes the manifest, the In-Game Actions file and every controller configuration into `dir`;
/// returns the manifest path.
pub fn write_manifest(dir: &Path, app_id: u32) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let write = |name: &str, text: String| {
        let path = dir.join(name);
        std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))
    };
    write(MANIFEST_FILE, action_manifest(app_id))?;
    write(&format!("game_actions_{app_id}.vdf"), in_game_actions())?;
    for controller in CONTROLLER_TYPES {
        write(&controller_file(controller), controller_config(controller))?;
    }
    let manifest = dir.join(MANIFEST_FILE);
    Ok(std::path::absolute(&manifest).unwrap_or(manifest))
}

/// Default location of the generated files: `steam_input/` next to the binary.
pub fn default_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("steam_input")))
        .unwrap_or_else(|| PathBuf::from("steam_input"))
}

/// Live Steam Input state for the running engine.
pub struct SteamInput {
    input: steamworks::Input,
    sets: [sys::InputActionSetHandle_t; 2],
    emulator: Vec<(sys::InputDigitalActionHandle_t, u16)>,
    menu: Vec<(sys::InputDigitalActionHandle_t, u16)>,
    pub manifest: PathBuf,
    pub manifest_accepted: bool,
    menu_active: bool,
    last: [Option<Pad>; 4],
}

impl SteamInput {
    /// Initializes Steam Input, points it at the generated manifest and resolves the handles.
    pub fn new(client: &Client, app_id: u32, dir: &Path) -> Result<Self, String> {
        let manifest = write_manifest(dir, app_id)?;
        let input = client.input();
        if !input.init(false) {
            return Err("ISteamInput::Init failed".into());
        }
        let manifest_accepted =
            input.set_input_action_manifest_file_path(&manifest.to_string_lossy());
        input.run_frame();
        let mut this = Self {
            input,
            sets: [0; 2],
            emulator: Vec::new(),
            menu: Vec::new(),
            manifest,
            manifest_accepted,
            menu_active: false,
            last: [None; 4],
        };
        this.resolve();
        Ok(this)
    }

    /// Resolves set and action handles; Steam loads the manifest asynchronously, so this retries
    /// from [`Self::poll`] until the handles exist.
    fn resolve(&mut self) {
        let input = &self.input;
        self.sets = [
            input.get_action_set_handle(EMULATOR_SET),
            input.get_action_set_handle(MENU_SET),
        ];
        let resolve = |actions: &[Action]| {
            actions
                .iter()
                .map(|a| (input.get_digital_action_handle(a.name), a.pad))
                .collect::<Vec<_>>()
        };
        self.emulator = resolve(&EMULATOR_ACTIONS);
        self.menu = resolve(&MENU_ACTIONS);
    }

    pub fn set_handles(&self) -> [u64; 2] {
        self.sets
    }

    pub fn resolved_actions(&self) -> usize {
        self.emulator
            .iter()
            .chain(&self.menu)
            .filter(|(h, _)| *h != 0)
            .count()
    }

    /// Connected controller handles (steamworks-rs 0.13 `get_connected_controllers` returns the
    /// whole 16-slot buffer, so the slice form is used).
    pub fn controllers(&self) -> Vec<sys::InputHandle_t> {
        let mut handles = [0; sys::STEAM_INPUT_MAX_COUNT as usize];
        let count = self.input.get_connected_controllers_slice(&mut handles);
        handles[..count.min(handles.len())].to_vec()
    }

    /// Selects the `menu` set (controller-first UI) or the `emulator` set.
    pub fn use_menu(&mut self, menu: bool) {
        self.menu_active = menu;
    }

    /// Runs one Steam Input frame and reports per-controller pad changes (slot = controller index).
    pub fn poll(&mut self, mut changed: impl FnMut(u8, Option<Pad>)) {
        self.input.run_frame();
        if self.sets[0] == 0 || self.resolved_actions() == 0 {
            self.resolve();
        }
        let controllers = self.controllers();
        // With AppID 480 Steam keeps Spacewar's published manifest: only its `menu_*` actions
        // resolve, so the menu actions drive the machine until our own AppID ships the manifest.
        let emulator_ready = self.emulator.iter().any(|(h, _)| *h != 0);
        let (set, actions) = if self.menu_active || !emulator_ready {
            (self.sets[1], &self.menu)
        } else {
            (self.sets[0], &self.emulator)
        };
        for slot in 0..4u8 {
            let pad = controllers.get(usize::from(slot)).map(|&handle| {
                if set != 0 {
                    self.input.activate_action_set_handle(handle, set);
                }
                let mut buttons = 0u16;
                for &(action, bit) in actions {
                    if action == 0 {
                        continue;
                    }
                    let data = self.input.get_digital_action_data(handle, action);
                    if data.bActive && data.bState {
                        buttons |= bit;
                    }
                }
                Pad {
                    buttons,
                    ..Pad::default()
                }
            });
            if pad != self.last[usize::from(slot)] {
                self.last[usize::from(slot)] = pad;
                changed(slot, pad);
            }
        }
    }

    /// Key bits currently held across controllers (for headless consumers).
    pub fn keys(&self) -> u32 {
        let emulator_ready = self.emulator.iter().any(|(h, _)| *h != 0);
        let actions = if self.menu_active || !emulator_ready {
            &MENU_ACTIONS[..]
        } else {
            &EMULATOR_ACTIONS[..]
        };
        self.last.iter().flatten().fold(0, |acc, pad| {
            actions
                .iter()
                .filter(|a| pad.buttons & a.pad != 0)
                .fold(acc, |acc, a| acc | a.key)
        })
    }
}

impl Drop for SteamInput {
    fn drop(&mut self) {
        self.input.shutdown();
    }
}

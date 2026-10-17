// SPDX-License-Identifier: Apache-2.0
//! Applets: the COSMIC panel/applet model for the console quick menu.
//!
//! COSMIC hosts applets in panel wings (start, center, end); the console has two hosts instead:
//! the quick menu (a controller-navigable grid of tiles opened with Guide) and the top bar status
//! area. Built-in applets and plugin contributions (`ui.menu` entries of the platform plugins,
//! `location: "quick-menu" | "status"`) share one registry, ordered and deduplicated by id.

use serde::{Deserialize, Serialize};

/// Where an applet is shown.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Placement {
    /// A tile of the quick menu.
    QuickMenu,
    /// An indicator of the top bar (clock, controller, network, GPU).
    Status,
}

impl Placement {
    pub fn parse(location: &str) -> Option<Self> {
        match location {
            "quick-menu" | "quick" => Some(Self::QuickMenu),
            "status" | "panel" => Some(Self::Status),
            _ => None,
        }
    }
}

/// Tile footprint in the quick-menu grid (COSMIC applets are icon or icon+label sized).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TileSize {
    #[default]
    Small,
    Wide,
}

/// What a tile shows and does.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum TileKind {
    /// Runs `command` on accept.
    Action,
    /// On/off state; accept toggles and runs `command` with the new state.
    Toggle { on: bool },
    /// A value the left/right intents change by `step` within `min..=max`.
    Slider {
        value: f32,
        min: f32,
        max: f32,
        step: f32,
    },
    /// Read-only value (status bar indicators, quick-menu readouts).
    Status { value: String },
}

/// One applet.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Applet {
    pub id: String,
    /// Owner: `bun-os` for built-ins, else the plugin id.
    pub plugin: String,
    /// Material Symbols name.
    pub icon: String,
    /// Fluent message key, or an already localized label for plugin entries.
    pub label: String,
    #[serde(default)]
    pub localized: bool,
    pub placement: Placement,
    pub kind: TileKind,
    #[serde(default)]
    pub size: TileSize,
    /// Platform command run on activation (`shell.screenshot`, `plugin:<id>/<command>`).
    pub command: String,
    #[serde(default)]
    pub order: i32,
}

impl Applet {
    /// Adapt a plugin menu entry (`PluginMenu` of the Bevy integration).
    pub fn from_plugin_entry(
        plugin: &str,
        id: &str,
        label: &str,
        icon: Option<&str>,
        location: &str,
        command: &str,
    ) -> Option<Self> {
        Some(Self {
            id: format!("{plugin}/{id}"),
            plugin: plugin.to_string(),
            icon: icon.unwrap_or("extension").to_string(),
            label: label.to_string(),
            localized: true,
            placement: Placement::parse(location)?,
            kind: TileKind::Action,
            size: TileSize::Small,
            command: command.to_string(),
            order: 1000,
        })
    }

    /// Next state after accept (toggles flip; others unchanged).
    pub fn activate(&mut self) {
        if let TileKind::Toggle { on } = &mut self.kind {
            *on = !*on;
        }
    }

    /// Move a slider by `steps` (negative = left); returns the new value.
    pub fn nudge(&mut self, steps: i32) -> Option<f32> {
        if let TileKind::Slider {
            value,
            min,
            max,
            step,
        } = &mut self.kind
        {
            *value = (*value + *step * steps as f32).clamp(*min, *max);
            return Some(*value);
        }
        None
    }
}

/// All applets of the session.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "bevy", derive(bevy_ecs::resource::Resource))]
pub struct AppletRegistry {
    applets: Vec<Applet>,
}

impl AppletRegistry {
    /// The built-in quick menu of the console shell (the actions of `QuickAction`).
    pub fn bun_os_defaults() -> Self {
        let action = |id: &str, icon: &str, order: i32| Applet {
            id: id.to_string(),
            plugin: "bun-os".into(),
            icon: icon.into(),
            label: format!("action.{id}"),
            localized: false,
            placement: Placement::QuickMenu,
            kind: TileKind::Action,
            size: TileSize::Small,
            command: format!("shell.{id}"),
            order,
        };
        let mut registry = Self::default();
        for applet in [
            action("home", "home", 0),
            action("screenshot", "screenshot_monitor", 10),
            action("record", "radio_button_checked", 20),
            action("gallery", "photo_library", 30),
            action("performance", "monitoring", 40),
            action("frame-limit", "speed", 50),
            action("scaling", "aspect_ratio", 60),
            Applet {
                kind: TileKind::Slider {
                    value: 0.5,
                    min: 0.0,
                    max: 1.0,
                    step: 0.05,
                },
                size: TileSize::Wide,
                ..action("volume", "volume_up", 70)
            },
            Applet {
                kind: TileKind::Toggle { on: false },
                ..action("do-not-disturb", "do_not_disturb_on", 80)
            },
            action("close-game", "close", 90),
        ] {
            registry.register(applet);
        }
        registry
    }

    /// Add or replace (same id) an applet.
    pub fn register(&mut self, applet: Applet) {
        match self.applets.iter_mut().find(|a| a.id == applet.id) {
            Some(slot) => *slot = applet,
            None => self.applets.push(applet),
        }
    }

    /// Replace every applet of `plugin` (plugin reload).
    pub fn replace_plugin(&mut self, plugin: &str, applets: impl IntoIterator<Item = Applet>) {
        self.applets.retain(|a| a.plugin != plugin);
        for applet in applets {
            self.register(applet);
        }
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut Applet> {
        self.applets.iter_mut().find(|a| a.id == id)
    }

    /// Applets of one host, by order then id.
    pub fn placed(&self, placement: Placement) -> Vec<&Applet> {
        let mut out: Vec<&Applet> = self
            .applets
            .iter()
            .filter(|a| a.placement == placement)
            .collect();
        out.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
        out
    }
}

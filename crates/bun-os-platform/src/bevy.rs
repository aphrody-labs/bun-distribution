//! Bevy integration for the console shell and the Bun Engine runtime.
//!
//! `app.add_plugins(PlatformPlugin::new(&["common", "shell"]))` installs:
//! - [`I18nState`] (locale chain, [`crate::i18n::version`] for UI rebuilds) and the
//!   [`SetLocale`] / [`LocaleChanged`] messages;
//! - [`ThemeTokens`] (resolved M3 tokens of the theme file) and [`SetTheme`] / [`ThemeChanged`];
//! - [`PlatformService`] (the Bun sidecar: plugins, file types, transfers) with its events as
//!   [`PlatformEvent`] messages (`transfer.progress`, `plugins.changed`, ...) and the menu
//!   entries plugins contribute in [`PluginMenu`].

use bevy_app::{App, Plugin, PreUpdate, Update};
use bevy_ecs::prelude::*;
use serde_json::{Value, json};

use crate::paths::Paths;
use crate::sidecar::Sidecar;
use crate::theme::{self, Tokens};
use crate::{i18n, locale};

/// Locale state; `version` changes whenever the catalogs are reloaded.
#[derive(Resource, Clone, Debug)]
pub struct I18nState {
    pub chain: Vec<String>,
    pub version: u64,
    pub available: Vec<(String, String)>,
}

/// The resolved theme (`ThemeTokens.0.argb("primary")`, `.space("md")`, `.duration_secs("medium2")`).
#[derive(Resource, Clone, Debug)]
pub struct ThemeTokens(pub Tokens);

/// Requests a UI language (`None`: follow the OS). Persisted in `settings.json`.
#[derive(Message, Clone, Debug)]
pub struct SetLocale(pub Option<String>);

#[derive(Message, Clone, Debug)]
pub struct LocaleChanged(pub String);

/// Requests a theme by id or path (`None`: baseline), optionally re-seeded (dynamic color).
#[derive(Message, Clone, Debug, Default)]
pub struct SetTheme {
    pub theme: Option<String>,
    pub seed: Option<u32>,
}

#[derive(Message, Clone, Debug)]
pub struct ThemeChanged;

/// An event of the Bun platform service.
#[derive(Message, Clone, Debug)]
pub struct PlatformEvent {
    pub name: String,
    pub data: Value,
}

/// Menu entries contributed by plugins (`ui.menu` permission).
#[derive(Resource, Clone, Debug, Default)]
pub struct PluginMenu {
    pub entries: Vec<MenuEntry>,
}

#[derive(Clone, Debug)]
pub struct MenuEntry {
    pub plugin: String,
    pub id: String,
    /// Already localized label.
    pub label: String,
    pub icon: Option<String>,
    /// Where the entry goes (`quick-menu`, `settings`, `library`).
    pub location: String,
    pub command: String,
}

/// The Bun platform service (absent when Bun is not on PATH; the host keeps working).
#[derive(Resource)]
pub struct PlatformService(pub Option<Sidecar>);

impl PlatformService {
    /// Fire-and-forget call; replies of interest come back as [`PlatformEvent`]s.
    pub fn send(&self, method: &str, params: Value) {
        if let Some(s) = &self.0 {
            let _ = s.request(method, params);
        }
    }

    pub fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.0
            .as_ref()
            .ok_or_else(|| "platform service unavailable".to_string())?
            .call(method, params, std::time::Duration::from_secs(10))
    }
}

pub struct PlatformPlugin {
    pub domains: Vec<&'static str>,
    /// Start the Bun sidecar (plugins, file types, transfers).
    pub service: bool,
    pub reduced_motion: bool,
}

impl PlatformPlugin {
    pub fn new(domains: &[&'static str]) -> Self {
        Self {
            domains: domains.to_vec(),
            service: true,
            reduced_motion: false,
        }
    }
}

fn menu_from(value: &Value) -> Vec<MenuEntry> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .map(|e| {
            let s = |k: &str| {
                e.get(k)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            };
            MenuEntry {
                plugin: s("plugin"),
                id: s("id"),
                label: s("label"),
                icon: e.get("icon").and_then(Value::as_str).map(str::to_string),
                location: s("location"),
                command: s("command"),
            }
        })
        .collect()
}

impl Plugin for PlatformPlugin {
    fn build(&self, app: &mut App) {
        let paths = Paths::discover();
        let l10n = i18n::init(&self.domains);
        let (_, locales) = locale::available(&paths);
        let tokens = theme::current(&paths, None, self.reduced_motion).unwrap_or_else(|e| {
            eprintln!("bun-os-platform: theme: {e}");
            Tokens::resolve(
                &theme::ThemeFile::default(),
                theme::ResolveOptions::default(),
            )
        });
        let service = if self.service {
            match Sidecar::spawn(&paths.repo) {
                Ok(s) => Some(s),
                Err(e) => {
                    eprintln!("bun-os-platform: sidecar: {e}");
                    None
                }
            }
        } else {
            None
        };
        let menu = service
            .as_ref()
            .and_then(|s| {
                s.call(
                    "plugins.menu",
                    json!({ "locale": l10n.locale() }),
                    std::time::Duration::from_secs(20),
                )
                .ok()
            })
            .map(|v| menu_from(&v))
            .unwrap_or_default();
        app.insert_resource(I18nState {
            chain: l10n.chain.clone(),
            version: i18n::version(),
            available: locales.into_iter().map(|l| (l.tag, l.name)).collect(),
        })
        .insert_resource(ThemeTokens(tokens))
        .insert_resource(PluginMenu { entries: menu })
        .insert_resource(PlatformService(service))
        .add_message::<SetLocale>()
        .add_message::<LocaleChanged>()
        .add_message::<SetTheme>()
        .add_message::<ThemeChanged>()
        .add_message::<PlatformEvent>()
        .add_systems(PreUpdate, pump_service)
        .add_systems(Update, (apply_locale, apply_theme));
    }
}

fn pump_service(
    service: Res<PlatformService>,
    mut out: MessageWriter<PlatformEvent>,
    mut menu: ResMut<PluginMenu>,
) {
    let Some(sidecar) = &service.0 else { return };
    for event in sidecar.drain_events() {
        if event.name == "plugins.menu" {
            menu.entries = menu_from(&event.data);
        }
        out.write(PlatformEvent {
            name: event.name,
            data: event.data,
        });
    }
}

fn apply_locale(
    mut requests: MessageReader<SetLocale>,
    mut state: ResMut<I18nState>,
    mut changed: MessageWriter<LocaleChanged>,
    service: Res<PlatformService>,
) {
    let Some(request) = requests.read().last() else {
        return;
    };
    let l10n = i18n::set_locale(request.0.as_deref());
    state.chain = l10n.chain.clone();
    state.version = i18n::version();
    service.send(
        "plugins.menu",
        json!({ "locale": l10n.locale(), "push": true }),
    );
    changed.write(LocaleChanged(l10n.locale().to_string()));
}

fn apply_theme(
    mut requests: MessageReader<SetTheme>,
    mut tokens: ResMut<ThemeTokens>,
    mut changed: MessageWriter<ThemeChanged>,
) {
    let Some(request) = requests.read().last().cloned() else {
        return;
    };
    let paths = Paths::discover();
    if let Some(theme) = &request.theme {
        let mut settings = crate::paths::Settings::read(&paths);
        settings.theme = Some(theme.clone()).filter(|t| t != "baseline");
        let _ = settings.write(&paths);
    }
    match theme::current(&paths, request.seed, tokens.0.reduced_motion) {
        Ok(next) => {
            tokens.0 = next;
            changed.write(ThemeChanged);
        }
        Err(e) => eprintln!("bun-os-platform: theme: {e}"),
    }
}

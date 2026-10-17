// SPDX-License-Identifier: Apache-2.0
//! Settings pages: the cosmic-settings page/section/item model with typed controls, filled by
//! the shell's built-ins and by plugins (`location: "settings"`), and searchable from the launcher.
//!
//! Titles are Fluent message keys (`settings.<page>` for pages, resolved by the host); a control's
//! id is the persisted setting key of `shell.db` / `settings.json`.

use serde::{Deserialize, Serialize};

use super::launcher::{Provider, SearchItem};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Control {
    Toggle,
    /// `(value, label key)` pairs.
    Choice {
        options: Vec<(String, String)>,
    },
    Slider {
        min: f32,
        max: f32,
        step: f32,
    },
    /// Runs a platform command (rescan, install session).
    Action {
        command: String,
    },
    /// Read-only value provided by the host.
    Info,
    /// Opens another page.
    Page {
        page: String,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    pub control: Control,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSection {
    #[serde(default)]
    pub title: Option<String>,
    pub items: Vec<SettingItem>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPage {
    pub id: String,
    /// Material Symbols name.
    pub icon: String,
    pub title: String,
    pub sections: Vec<SettingsSection>,
    #[serde(default)]
    pub order: i32,
    /// `bun-os` or the contributing plugin.
    pub owner: String,
}

#[derive(Clone, Debug, Default)]
#[cfg_attr(feature = "bevy", derive(bevy_ecs::resource::Resource))]
pub struct SettingsRegistry {
    pages: Vec<SettingsPage>,
}

fn item(id: &str, title: &str, control: Control) -> SettingItem {
    SettingItem {
        id: id.to_string(),
        title: title.to_string(),
        description: None,
        control,
    }
}

fn page(id: &str, icon: &str, order: i32, items: Vec<SettingItem>) -> SettingsPage {
    SettingsPage {
        id: id.to_string(),
        icon: icon.to_string(),
        title: format!("settings.{id}"),
        sections: vec![SettingsSection { title: None, items }],
        order,
        owner: "bun-os".into(),
    }
}

impl SettingsRegistry {
    /// Built-in pages of the console shell (setting ids are the `shell.db` keys).
    pub fn bun_os_defaults() -> Self {
        let mut registry = Self::default();
        let action = |command: &str| Control::Action {
            command: command.into(),
        };
        for p in [
            page(
                "console",
                "sports_esports",
                0,
                vec![
                    item("haptics", "settings.haptics", Control::Toggle),
                    item("motion", "settings.motion", Control::Toggle),
                    item("hud", "settings.performance", Control::Toggle),
                    item("rescan", "settings.reload", action("library.rescan")),
                ],
            ),
            page(
                "appearance",
                "palette",
                10,
                vec![
                    item("dynamic-color", "settings.dynamic-color", Control::Toggle),
                    item(
                        "theme",
                        "settings.theme",
                        Control::Page {
                            page: "themes".into(),
                        },
                    ),
                    item(
                        "language",
                        "settings.language",
                        Control::Page {
                            page: "language".into(),
                        },
                    ),
                ],
            ),
            page(
                "notifications",
                "notifications",
                20,
                vec![item(
                    "do-not-disturb",
                    "action.do-not-disturb",
                    Control::Toggle,
                )],
            ),
            page(
                "media",
                "photo_library",
                30,
                vec![item("gallery", "media.title", action("shell.gallery"))],
            ),
            page(
                "system",
                "settings",
                40,
                vec![
                    item("session", "settings.session", action("shell.session")),
                    item("desktop", "settings.desktop", action("shell.desktop")),
                ],
            ),
        ] {
            registry.register(p);
        }
        registry
    }

    /// Add or replace (same id) a page.
    pub fn register(&mut self, page: SettingsPage) {
        match self.pages.iter_mut().find(|p| p.id == page.id) {
            Some(slot) => *slot = page,
            None => self.pages.push(page),
        }
    }

    /// Append a plugin section to an existing page (or a new plugin page when missing).
    pub fn contribute(&mut self, owner: &str, page_id: &str, section: SettingsSection) {
        match self.pages.iter_mut().find(|p| p.id == page_id) {
            Some(p) => p.sections.push(section),
            None => self.pages.push(SettingsPage {
                id: page_id.to_string(),
                icon: "extension".into(),
                title: format!("settings.{page_id}"),
                sections: vec![section],
                order: 1000,
                owner: owner.to_string(),
            }),
        }
    }

    pub fn pages(&self) -> Vec<&SettingsPage> {
        let mut out: Vec<&SettingsPage> = self.pages.iter().collect();
        out.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));
        out
    }

    pub fn page(&self, id: &str) -> Option<&SettingsPage> {
        self.pages.iter().find(|p| p.id == id)
    }

    /// Launcher entries for every page and item, titles resolved by `localize` (message key in,
    /// localized text out).
    pub fn search_items(&self, localize: impl Fn(&str) -> String) -> Vec<SearchItem> {
        let mut out = Vec::new();
        for page in &self.pages {
            let page_title = localize(&page.title);
            out.push(SearchItem {
                id: format!("settings:{}", page.id),
                provider: Provider::Settings,
                title: page_title.clone(),
                subtitle: String::new(),
                icon: page.icon.clone(),
                keywords: Vec::new(),
                command: format!("settings.open:{}", page.id),
            });
            for item in page.sections.iter().flat_map(|s| &s.items) {
                out.push(SearchItem {
                    id: format!("settings:{}/{}", page.id, item.id),
                    provider: Provider::Settings,
                    title: localize(&item.title),
                    subtitle: page_title.clone(),
                    icon: page.icon.clone(),
                    keywords: item.description.iter().map(|d| localize(d)).collect(),
                    command: format!("settings.open:{}#{}", page.id, item.id),
                });
            }
        }
        out
    }
}

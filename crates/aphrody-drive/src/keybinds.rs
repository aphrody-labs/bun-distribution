// SPDX-License-Identifier: FSL-1.1-ALv2
// Derived from Spacedrive (drive/apps/tauri/src-tauri/src/keybinds.rs), adopted as the Aphrody
// Drive file explorer.
//! Keybind registry. Key handling itself runs in the webview; the registry records each
//! keybind's accelerator (validated and normalized) so native menus and the backend can trigger
//! the same handlers through the `keybind-triggered` event.

use std::{collections::HashMap, fmt};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

/// A keyboard modifier, in canonical order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Modifier {
    /// Command on macOS, Control elsewhere (`CmdOrCtrl`).
    CommandOrControl,
    Command,
    Control,
    Alt,
    Shift,
    Super,
}

impl Modifier {
    fn parse(token: &str) -> Option<Self> {
        match token.to_ascii_lowercase().as_str() {
            "cmdorctrl" | "commandorcontrol" | "cmdorcontrol" | "commandorctrl" => {
                Some(Self::CommandOrControl)
            }
            "cmd" | "command" => Some(Self::Command),
            "ctrl" | "control" => Some(Self::Control),
            "alt" | "option" | "altgr" => Some(Self::Alt),
            "shift" => Some(Self::Shift),
            "super" | "meta" | "win" | "windows" => Some(Self::Super),
            _ => None,
        }
    }

    const fn name(self) -> &'static str {
        match self {
            Self::CommandOrControl => "CmdOrCtrl",
            Self::Command => "Command",
            Self::Control => "Control",
            Self::Alt => "Alt",
            Self::Shift => "Shift",
            Self::Super => "Super",
        }
    }
}

/// A parsed accelerator such as `Command+Shift+N`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Accelerator {
    /// Sorted, without duplicates.
    pub modifiers: Vec<Modifier>,
    pub key: String,
}

impl Accelerator {
    /// Parse `Modifier+...+Key`: modifiers are case-insensitive aliases, the key is the last
    /// token (`+` itself is written `Control++`), a single character key is upper-cased and the
    /// DOM arrow names map to `Up` / `Down` / `Left` / `Right`.
    ///
    /// # Errors
    /// On an empty key, an unknown modifier, or a modifier used as the key.
    pub fn parse(text: &str) -> Result<Self, String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("empty accelerator".to_string());
        }
        let (head, key) = if let Some(head) = text.strip_suffix("++") {
            (head, "+")
        } else if text == "+" {
            ("", "+")
        } else {
            match text.rsplit_once('+') {
                Some((head, key)) => (head, key),
                None => ("", text),
            }
        };
        let key = key.trim();
        if key.is_empty() {
            return Err(format!("accelerator `{text}` has no key"));
        }
        if Modifier::parse(key).is_some() {
            return Err(format!("accelerator `{text}` ends with a modifier"));
        }
        let mut modifiers = Vec::new();
        for token in head
            .split('+')
            .map(str::trim)
            .filter(|token| !token.is_empty())
        {
            let modifier = Modifier::parse(token)
                .ok_or_else(|| format!("unknown modifier `{token}` in `{text}`"))?;
            if !modifiers.contains(&modifier) {
                modifiers.push(modifier);
            }
        }
        modifiers.sort();
        let key = match key {
            "ArrowUp" => "Up".to_string(),
            "ArrowDown" => "Down".to_string(),
            "ArrowLeft" => "Left".to_string(),
            "ArrowRight" => "Right".to_string(),
            " " => "Space".to_string(),
            single if single.chars().count() == 1 => single.to_uppercase(),
            other => other.to_string(),
        };
        Ok(Self { modifiers, key })
    }
}

impl fmt::Display for Accelerator {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for modifier in &self.modifiers {
            write!(f, "{}+", modifier.name())?;
        }
        f.write_str(&self.key)
    }
}

/// Registered keybinds: id → normalized accelerator.
#[derive(Default)]
pub struct KeybindState {
    registered: Mutex<HashMap<String, String>>,
}

impl KeybindState {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Register (or replace) a keybind; returns the normalized accelerator.
    ///
    /// # Errors
    /// When the accelerator does not parse.
    pub fn register(&self, id: &str, accelerator: &str) -> Result<String, String> {
        let normalized = Accelerator::parse(accelerator)?.to_string();
        self.registered
            .lock()
            .insert(id.to_string(), normalized.clone());
        Ok(normalized)
    }

    /// Remove a keybind; returns whether it existed.
    pub fn unregister(&self, id: &str) -> bool {
        self.registered.lock().remove(id).is_some()
    }

    #[must_use]
    pub fn get_accelerator(&self, id: &str) -> Option<String> {
        self.registered.lock().get(id).cloned()
    }

    #[must_use]
    pub fn list_all(&self) -> HashMap<String, String> {
        self.registered.lock().clone()
    }
}

/// Payload of `keybind-triggered`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeybindEvent {
    pub id: String,
}

/// Record a keybind.
#[tauri::command]
pub async fn register_keybind(
    state: State<'_, KeybindState>,
    id: String,
    accelerator: String,
) -> Result<(), String> {
    let normalized = state.register(&id, &accelerator)?;
    log::debug!("keybind registered: {id} -> {normalized}");
    Ok(())
}

/// Forget a keybind.
#[tauri::command]
pub async fn unregister_keybind(state: State<'_, KeybindState>, id: String) -> Result<(), String> {
    state.unregister(&id);
    log::debug!("keybind unregistered: {id}");
    Ok(())
}

/// Every registered keybind.
#[tauri::command]
pub async fn get_registered_keybinds(
    state: State<'_, KeybindState>,
) -> Result<HashMap<String, String>, String> {
    Ok(state.list_all())
}

/// Trigger a keybind's webview handler from the backend (native menu actions).
pub fn emit_keybind_triggered(app: &AppHandle<tauri::DynRuntime>, id: &str) {
    if let Err(error) = app.emit("keybind-triggered", KeybindEvent { id: id.to_string() }) {
        log::error!("keybind-triggered: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn normalized(text: &str) -> String {
        Accelerator::parse(text).unwrap().to_string()
    }

    #[test]
    fn frontend_accelerators_round_trip() {
        // The shapes `toTauriAccelerator` (interface/src/util/keybinds/platform.ts) produces.
        assert_eq!(normalized("Command+Shift+n"), "Command+Shift+N");
        assert_eq!(normalized("Control+Alt+ArrowUp"), "Control+Alt+Up");
        assert_eq!(normalized("Delete"), "Delete");
        assert_eq!(normalized("Space"), "Space");
    }

    #[test]
    fn modifiers_are_aliased_sorted_and_deduplicated() {
        let accelerator = Accelerator::parse("shift+Cmd+cmd+Option+K").unwrap();
        assert_eq!(
            accelerator.modifiers,
            vec![Modifier::Command, Modifier::Alt, Modifier::Shift]
        );
        assert_eq!(accelerator.key, "K");
        assert_eq!(normalized("CommandOrControl+,"), "CmdOrCtrl+,");
        assert_eq!(normalized("Meta+Win+E"), "Super+E");
    }

    #[test]
    fn plus_can_be_the_key() {
        assert_eq!(normalized("Control++"), "Control++");
        assert_eq!(normalized("+"), "+");
    }

    #[test]
    fn invalid_accelerators_are_rejected() {
        assert!(Accelerator::parse("").is_err());
        assert!(Accelerator::parse("Control+").is_err());
        assert!(Accelerator::parse("Control+Shift").is_err());
        assert!(Accelerator::parse("Hyper+K").is_err());
    }

    #[test]
    fn registry_stores_the_normalized_form() {
        let state = KeybindState::new();
        assert_eq!(
            state.register("explorer.copy", "cmd+c").unwrap(),
            "Command+C"
        );
        assert!(state.register("bad", "Nope+X").is_err());
        assert_eq!(
            state.get_accelerator("explorer.copy").as_deref(),
            Some("Command+C")
        );
        assert_eq!(state.list_all().len(), 1);
        assert!(state.unregister("explorer.copy"));
        assert!(!state.unregister("explorer.copy"));
    }
}

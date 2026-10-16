// SPDX-License-Identifier: Apache-2.0
//! Hidden windows that never flash (tauri-apps/tauri#16205).
//!
//! On Linux the CEF runtime ignores `visible: false` at creation: the window maps at once and shows
//! a blank canvas until the first paint. Unmapping it afterwards is worse, because CEF then flags
//! the browser hidden and stalls the page load. The workaround is to park the window: windows that
//! start hidden are declared in `tauri.conf.json` at ([`PARK`], [`PARK`]), so they are created
//! outside every monitor, load and paint there, and [`reveal`] puts them where they belong before
//! showing them. The same code is correct where `visible: false` is honoured (Windows, macOS).
//!
//! Window-state and parking: a parked window must never be tracked by `tauri-plugin-window-state`,
//! which saves the position of every tracked window on exit and would persist the parking spot.
//! Parked windows are on its denylist (see [`HIDDEN_AT_START`]); the pet and the widget keep their
//! own position in the `desktop.json` store (`integration.rs`).

use tauri::{Runtime, Webview, WebviewWindow, webview::PageLoadEvent};

/// Coordinate (physical pixels, both axes) of the parking spot declared in `tauri.conf.json`.
pub const PARK: i32 = -32_000;

/// Every window declared `visible: false` in `tauri.conf.json`, parked at creation.
pub const HIDDEN_AT_START: [&str; 4] = ["splash", "pet", "widget", "quickbar"];

/// Whether a window position is the parking spot. Window managers may nudge it by a few pixels.
#[must_use]
pub const fn is_parked(x: i32, y: i32) -> bool {
    x <= PARK + 2_000 && y <= PARK + 2_000
}

/// Hide a parked window once its page has loaded.
///
/// A parked window is mapped, so CEF treats it as visible and keeps painting and animating its page
/// (the pet and widget sprites run at display rate) for nobody. Hiding it during the load is what
/// stalls the load (#16205), hiding it afterwards is safe: CEF then throttles the page.
///
/// The page-load callback runs on the event-loop thread, and a window call from that thread waits for
/// the loop to answer it: the hide runs on a short-lived thread instead (called inline it deadlocks the
/// browser process, measured on 2026-10-06).
pub fn hide_when_loaded<R: Runtime>(webview: &Webview<R>, event: &PageLoadEvent) {
    if !matches!(event, PageLoadEvent::Finished) {
        return;
    }
    let window = webview.window();
    if !HIDDEN_AT_START.contains(&window.label()) {
        return;
    }
    std::thread::spawn(move || {
        let parked = window.outer_position().is_ok_and(|at| is_parked(at.x, at.y));
        if parked && let Err(error) = window.hide() {
            log::warn!("hiding the parked window {}: {error}", window.label());
        }
    });
}

/// Move a (possibly parked) window with `place`, then show it.
///
/// `place` runs unconditionally: a platform that clamped the parking spot or a window that was
/// already placed is moved to the same target, so the caller never needs to know which case it is.
///
/// # Errors
///
/// Fails when the window cannot be shown.
pub fn reveal<R: Runtime>(
    window: &WebviewWindow<R>,
    place: impl FnOnce(&WebviewWindow<R>),
) -> tauri::Result<()> {
    place(window);
    window.show()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_parking_spot_is_recognised_with_window_manager_slack() {
        assert!(is_parked(PARK, PARK));
        assert!(is_parked(PARK + 40, PARK + 28));
        assert!(!is_parked(0, 0));
        assert!(!is_parked(PARK, 0));
        assert!(!is_parked(-1920, 300));
    }

    #[test]
    fn every_hidden_window_is_a_declared_label() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        let windows = config["app"]["windows"].as_array().expect("windows");
        for label in HIDDEN_AT_START {
            let window = windows
                .iter()
                .find(|window| window["label"] == label)
                .unwrap_or_else(|| panic!("`{label}` is not declared"));
            assert_eq!(window["visible"], false, "{label} must start hidden");
            assert_eq!(window["x"], PARK, "{label} must be created parked");
            assert_eq!(window["y"], PARK, "{label} must be created parked");
            assert!(window.get("center").is_none(), "{label}: `center` would undo the parking");
        }
        for window in windows.iter().filter(|window| window["visible"] == false) {
            let label = window["label"].as_str().expect("label");
            assert!(HIDDEN_AT_START.contains(&label), "{label} starts hidden but is not parked");
        }
    }
}

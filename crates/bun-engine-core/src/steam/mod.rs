//! Steamworks integration (feature `steam`) on steamworks-rs and its bundled redistributable
//! `steam_api`: client init with an AppID, Steam Input action sets mapped onto the machine keys,
//! an overlay-safe host for the shared wgpu window, Rich Presence, the screenshot hook, Steam
//! Cloud saves through `ISteamRemoteStorage` and a read-only stats/achievements stub.
//!
//! AppID 480 (Valve's Spacewar test app) is the development default: every Steam account owns it,
//! so init, the overlay, Rich Presence, screenshots, Steam Input and Remote Storage work without a
//! partner account. A shipped build uses its own AppID (see `docs/bun-engine/STEAM.md`).

pub mod cli;
pub mod cloud;
pub mod input;
pub mod options;
#[cfg(feature = "runtime")]
pub mod plugin;
pub mod stats;

pub use options::RunOptions;
#[cfg(feature = "runtime")]
pub use plugin::SteamPlugin;

use std::{
    ffi::{CStr, CString},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use steamworks::{
    AppId, CallbackHandle, Client, GameOverlayActivated,
    screenshots::{ScreenshotReady, ScreenshotRequested},
    sys,
};

/// Valve's Spacewar test application, owned by every Steam account.
pub const DEV_APP_ID: u32 = 480;

/// How the engine starts the Steam API.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SteamOptions {
    pub app_id: u32,
    /// Development mode: writes `steam_appid.txt` next to the binary and never asks Steam to
    /// relaunch the process. On by default for AppID 480.
    pub dev: bool,
}

impl Default for SteamOptions {
    fn default() -> Self {
        let app_id = std::env::var("BUN_ENGINE_STEAM_APPID")
            .ok()
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(DEV_APP_ID);
        let dev = app_id == DEV_APP_ID || std::env::var_os("BUN_ENGINE_STEAM_DEV").is_some();
        Self { app_id, dev }
    }
}

impl SteamOptions {
    pub fn with_app_id(app_id: u32) -> Self {
        Self { app_id, dev: app_id == DEV_APP_ID || std::env::var_os("BUN_ENGINE_STEAM_DEV").is_some() }
    }
}

/// What the engine is playing, published as Rich Presence.
#[derive(Clone, Debug, Default)]
pub struct Presence {
    /// Machine id (`nes`, `gba`, ...).
    pub system: String,
    /// Game title.
    pub game: String,
    /// Optional state line (`Paused`, `In menu`).
    pub state: Option<String>,
}

/// One initialized Steam client for the process.
pub struct Steam {
    pub client: Client,
    pub app_id: u32,
    overlay_active: Arc<AtomicBool>,
    overlay_changed: Arc<AtomicBool>,
    screenshot_requested: Arc<AtomicBool>,
    screenshots: Arc<Mutex<Vec<Result<u32, String>>>>,
    _callbacks: Vec<CallbackHandle>,
}

/// `steam_appid.txt` next to the running binary (development only).
pub fn dev_app_id_file() -> Option<PathBuf> {
    Some(std::env::current_exe().ok()?.parent()?.join("steam_appid.txt"))
}

fn write_dev_app_id(app_id: u32) -> Result<(), String> {
    let Some(path) = dev_app_id_file() else { return Ok(()) };
    let wanted = app_id.to_string();
    if std::fs::read_to_string(&path).is_ok_and(|v| v.trim() == wanted) {
        return Ok(());
    }
    std::fs::write(&path, &wanted).map_err(|e| format!("{}: {e}", path.display()))
}

/// The Steamworks redistributable is delay-loaded on Windows: check it is reachable (next to the
/// binary or on `PATH`) before the first SDK call, which would otherwise abort the process.
fn redistributable() -> Result<(), String> {
    if !cfg!(all(windows, target_env = "msvc")) {
        return Ok(());
    }
    let dll = if cfg!(target_pointer_width = "64") { "steam_api64.dll" } else { "steam_api.dll" };
    let exe_dir = std::env::current_exe().ok().and_then(|e| e.parent().map(PathBuf::from));
    let path = std::env::var_os("PATH").unwrap_or_default();
    let found = exe_dir.into_iter().chain(std::env::split_paths(&path)).any(|dir| dir.join(dll).is_file());
    if found {
        Ok(())
    } else {
        Err(format!("{dll} (Steamworks redistributable) is missing next to the binary; copy it from the steamworks-sys build output"))
    }
}

/// True inside gamescope (Steam Deck game mode, SteamOS, Bun OS Gaming composition).
pub fn gamescope() -> bool {
    std::env::var_os("GAMESCOPE_WAYLAND_DISPLAY").is_some()
        || std::env::var_os("SteamDeck").is_some_and(|v| v == "1")
        || std::env::var_os("SteamGamepadUI").is_some()
        || std::env::var("XDG_CURRENT_DESKTOP").is_ok_and(|v| v.eq_ignore_ascii_case("gamescope"))
}

impl Steam {
    /// Starts the Steam API. Must run before the window and GPU device exist so the overlay can
    /// hook the swap chain (D3D12 through `gameoverlayrenderer64`, Vulkan through Valve's layer).
    pub fn init(options: &SteamOptions) -> Result<Self, String> {
        redistributable()?;
        if options.dev {
            write_dev_app_id(options.app_id)?;
        } else if steamworks::restart_app_if_necessary(AppId(options.app_id)) {
            return Err(format!("relaunching through Steam for AppID {}", options.app_id));
        }
        let client = Client::init_app(options.app_id).map_err(|e| format!("SteamAPI_Init: {e}"))?;
        // Valve's Vulkan overlay layer is implicit and gated by this variable; Steam sets it for
        // the games it launches, so a process started outside Steam opts in itself.
        // SAFETY: called on the main thread before the GPU instance or any worker thread exists.
        unsafe { std::env::set_var("ENABLE_VK_LAYER_VALVE_steam_overlay_1", "1") };
        let overlay_active = Arc::new(AtomicBool::new(false));
        let overlay_changed = Arc::new(AtomicBool::new(false));
        let screenshot_requested = Arc::new(AtomicBool::new(false));
        let screenshots = Arc::new(Mutex::new(Vec::new()));
        let mut callbacks = Vec::new();
        {
            let (active, changed) = (overlay_active.clone(), overlay_changed.clone());
            callbacks.push(client.register_callback(move |event: GameOverlayActivated| {
                active.store(event.active, Ordering::SeqCst);
                changed.store(true, Ordering::SeqCst);
            }));
        }
        {
            let requested = screenshot_requested.clone();
            callbacks.push(client.register_callback(move |_: ScreenshotRequested| {
                requested.store(true, Ordering::SeqCst);
            }));
        }
        {
            let ready = screenshots.clone();
            callbacks.push(client.register_callback(move |event: ScreenshotReady| {
                if let Ok(mut list) = ready.lock() {
                    list.push(event.local_handle.map_err(|e| e.to_string()));
                }
            }));
        }
        Ok(Self {
            client,
            app_id: options.app_id,
            overlay_active,
            overlay_changed,
            screenshot_requested,
            screenshots,
            _callbacks: callbacks,
        })
    }

    /// Dispatches pending callbacks; call once per frame.
    pub fn pump(&self) {
        self.client.run_callbacks();
    }

    pub fn steam_id(&self) -> u64 {
        self.client.user().steam_id().raw()
    }

    pub fn overlay_active(&self) -> bool {
        self.overlay_active.load(Ordering::SeqCst)
    }

    /// The overlay state when it changed since the last call.
    pub fn take_overlay_change(&self) -> Option<bool> {
        self.overlay_changed.swap(false, Ordering::SeqCst).then(|| self.overlay_active())
    }

    /// Opens the overlay on `dialog` (`Friends`, `Community`, `Players`, `Settings`,
    /// `OfficialGameGroup`, `Stats`, `Achievements`).
    pub fn open_overlay(&self, dialog: &str) {
        self.client.friends().activate_game_overlay(dialog);
    }

    pub fn overlay_enabled(&self) -> bool {
        self.client.utils().is_overlay_enabled()
    }

    /// Steam Deck (or `SteamDeck=1`) and Big Picture: the controller-first layout applies.
    pub fn controller_first(&self) -> bool {
        let utils = self.client.utils();
        utils.is_steam_running_on_steam_deck() || utils.is_steam_in_big_picture_mode() || gamescope()
    }

    /// Publishes Rich Presence: `system`, `game`, `status` (the "view game info" line) and, for
    /// a real AppID with localized tokens, `steam_display` (`#Status_Playing`).
    pub fn set_presence(&self, presence: &Presence) -> bool {
        let friends = self.client.friends();
        let status = match &presence.state {
            Some(state) => format!("{} on {} ({state})", presence.game, presence.system.to_uppercase()),
            None => format!("Playing {} on {}", presence.game, presence.system.to_uppercase()),
        };
        let mut ok = friends.set_rich_presence("system", Some(&presence.system));
        ok &= friends.set_rich_presence("game", Some(&presence.game));
        ok &= friends.set_rich_presence("status", Some(&status));
        if self.app_id != DEV_APP_ID {
            ok &= friends.set_rich_presence("steam_display", Some("#Status_Playing"));
        }
        ok
    }

    pub fn clear_presence(&self) {
        self.client.friends().clear_rich_presence();
    }

    /// A Rich Presence value of the signed-in user, as Steam reports it back.
    pub fn presence_value(&self, key: &str) -> Option<String> {
        self.client.friends().get_friend(self.client.user().steam_id()).rich_presence(key)
    }

    /// The engine writes screenshots itself (from the machine picture) instead of Steam
    /// capturing the swap chain.
    pub fn hook_screenshots(&self, hook: bool) {
        self.client.screenshots().hook_screenshots(hook);
    }

    pub fn trigger_screenshot(&self) {
        self.client.screenshots().trigger_screenshot();
    }

    pub fn take_screenshot_request(&self) -> bool {
        self.screenshot_requested.swap(false, Ordering::SeqCst)
    }

    /// Completed screenshots (`ScreenshotReady`): local handles or errors.
    pub fn take_screenshots_ready(&self) -> Vec<Result<u32, String>> {
        self.screenshots.lock().map(|mut list| std::mem::take(&mut *list)).unwrap_or_default()
    }

    /// Writes an RGB8 picture to the Steam screenshot library and tags its location.
    pub fn write_screenshot(&self, width: u32, height: u32, rgb: &mut [u8], location: &str) -> Option<u32> {
        // SAFETY: the interface accessor is valid after init; `rgb` holds width*height*3 bytes.
        unsafe {
            let screenshots = sys::SteamAPI_SteamScreenshots_v003();
            let handle = sys::SteamAPI_ISteamScreenshots_WriteScreenshot(
                screenshots,
                rgb.as_mut_ptr().cast(),
                rgb.len() as u32,
                width as i32,
                height as i32,
            );
            if handle == sys::INVALID_SCREENSHOT_HANDLE {
                return None;
            }
            if let Ok(location) = CString::new(location) {
                sys::SteamAPI_ISteamScreenshots_SetLocation(screenshots, handle, location.as_ptr());
            }
            Some(handle)
        }
    }

    /// Machine-readable client state for `bun-engine steam status`.
    pub fn status(&self) -> serde_json::Value {
        let utils = self.client.utils();
        let apps = self.client.apps();
        let storage = self.client.remote_storage();
        let (total, available) = cloud::quota();
        // SAFETY: plain query on the initialized client.
        let logged_on = unsafe { sys::SteamAPI_ISteamUser_BLoggedOn(sys::SteamAPI_SteamUser_v023()) };
        serde_json::json!({
            "appId": self.app_id,
            "steamId": self.steam_id().to_string(),
            "loggedOn": logged_on,
            "subscribed": apps.is_subscribed(),
            "language": apps.current_game_language(),
            "overlayEnabled": utils.is_overlay_enabled(),
            "steamDeck": utils.is_steam_running_on_steam_deck(),
            "bigPicture": utils.is_steam_in_big_picture_mode(),
            "gamescope": gamescope(),
            "cloud": {
                "account": storage.is_cloud_enabled_for_account(),
                "app": storage.is_cloud_enabled_for_app(),
                "quotaTotal": total,
                "quotaAvailable": available,
                "files": storage.files().len(),
            },
        })
    }
}

impl Drop for Steam {
    fn drop(&mut self) {
        self.clear_presence();
        self.pump();
    }
}

/// Copies a C string returned by the SDK.
pub(crate) fn sdk_string(ptr: *const std::os::raw::c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    // SAFETY: the SDK returns NUL-terminated strings that live until the next call.
    unsafe { CStr::from_ptr(ptr) }.to_string_lossy().into_owned()
}

/// Lower-case hexadecimal SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

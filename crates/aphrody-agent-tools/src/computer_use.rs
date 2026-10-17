// SPDX-License-Identifier: Apache-2.0
//! Unified `computer` tool for UI and OS automation (P5b, feature `computer-use`).
//!
//! Provides a single model-facing `computer` tool adhering to Codex/Anthropic
//! computer-use conventions with:
//! - Dual perception: vision models receive screenshots in [`ToolOutput::images`]
//!   ([`aphrody_toolcall::ToolImage`]), while text-only models receive structured UI element trees
//!   via the `observe` action for element-id-driven actions (`@e1`).
//! - Policy enforcement: non-interactive No-HITL security with `allowed_apps` and `denied_apps`
//!   allowlists, plus hardcoded denial of UAC, Windows Security, Credential Manager, and root admin
//!   prompts.
//! - Pluggable [`ComputerBackend`]s:
//!   - `Windows`: in-process native execution via `aphrody-winclean`
//!   - `Browser`: controlled browser automation via shared Rust Web tools
//!   - `Linux`: X11 desktop automation via XTest / GetImage
//!   - `Mock`: in-memory deterministic backend for headless unit tests.

use std::{collections::BTreeMap, sync::Arc, time::Duration};

use aphrody_remote_desktop as rd;
use aphrody_toolcall::{
    AdditionalProperties, JsonSchema, ToolDefinition, ToolError, ToolExecutor, ToolImage,
    ToolOutput,
};
use aphrody_web_service::session;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Target environment for the computer tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComputerEnvironment {
    /// Native Windows desktop automation via the in-process `aphrody-winclean` crate.
    Windows,
    /// Browser session automation via the shared Rust Web client.
    Browser,
    /// Linux X11 automation.
    Linux,
    /// Terminal computer use via `aphrody-term` (a shell in a native PTY).
    Terminal,
    /// Windows Subsystem for Linux (WSL) automation via `wsl_execute` and guest telemetry.
    Wsl,
    /// Remote native Windows desktop automation on an administrator's PC (e.g. via WinClean MCP over WireGuard).
    RemoteWindows,
    /// Remote WSL automation on an administrator's PC.
    RemoteWsl,
    /// Any RFB (VNC) server, e.g. `aphrody infra remote serve` on a tunnel peer.
    RemoteVnc,
    /// In-memory mock environment for unit tests.
    Mock,
}

impl ComputerEnvironment {
    /// Best default environment detected for the host platform.
    #[must_use]
    pub fn auto_detect() -> Self {
        #[cfg(windows)]
        {
            Self::Windows
        }
        #[cfg(target_os = "linux")]
        {
            Self::Linux
        }
        #[cfg(not(any(windows, target_os = "linux")))]
        {
            Self::Browser
        }
    }

    /// Machine-readable identifier.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Windows => "windows",
            Self::Browser => "browser",
            Self::Linux => "linux",
            Self::Terminal => "terminal",
            Self::Wsl => "wsl",
            Self::RemoteWindows => "remote_windows",
            Self::RemoteWsl => "remote_wsl",
            Self::RemoteVnc => "remote_vnc",
            Self::Mock => "mock",
        }
    }
}

impl ComputerAction {
    /// The `action` discriminator as the model spells it.
    #[must_use]
    pub const fn name(&self) -> &'static str {
        match self {
            Self::Screenshot => "screenshot",
            Self::Click { .. } => "click",
            Self::DoubleClick { .. } => "double_click",
            Self::Move { .. } => "move",
            Self::Drag { .. } => "drag",
            Self::Scroll { .. } => "scroll",
            Self::Type { .. } => "type",
            Self::Keypress { .. } => "keypress",
            Self::Wait { .. } => "wait",
            Self::Observe { .. } => "observe",
            Self::ListWindows => "list_windows",
            Self::FocusWindow { .. } => "focus_window",
        }
    }
}

/// Autonomy policy for computer use: allowlist / denylist and security guards.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ComputerPolicy {
    /// Whitelist of allowed application names or window title patterns.
    /// When non-empty, any window/app not matching is rejected.
    #[serde(default)]
    pub allowed_apps: Vec<String>,
    /// Blacklist of explicitly forbidden application names or window title patterns.
    #[serde(default)]
    pub denied_apps: Vec<String>,
}

/// Hardcoded security prompts that must never be automated (No-HITL safety invariant).
const FORBIDDEN_SECURITY_PROMPTS: &[&str] = &[
    "user account control",
    "uac",
    "windows security",
    "credential manager",
    "task manager",
    "sudo",
    "polkit",
    "gksu",
];

impl ComputerPolicy {
    /// Verify whether a target application or window title is permitted by policy.
    ///
    /// # Errors
    ///
    /// Returns a structured rejection explanation if the target touches security
    /// credentials, matches `denied_apps`, or fails `allowed_apps`.
    pub fn verify_target(&self, target: &str) -> Result<(), String> {
        let lower = target.to_ascii_lowercase();

        // 1. Hardcoded security prompt check
        for forbidden in FORBIDDEN_SECURITY_PROMPTS {
            if lower.contains(forbidden) {
                return Err(format!(
                    "computer use rejected by security policy: interaction with administrative or \
                     credential prompt '{forbidden}' is forbidden"
                ));
            }
        }

        // 2. Explicit deny-list check
        for denied in &self.denied_apps {
            if lower.contains(&denied.to_ascii_lowercase()) {
                return Err(format!(
                    "computer use rejected by policy: target '{target}' matches denied_apps rule \
                     '{denied}'"
                ));
            }
        }

        // 3. Allow-list check (when non-empty)
        if !self.allowed_apps.is_empty() {
            let matched = self
                .allowed_apps
                .iter()
                .any(|allowed| lower.contains(&allowed.to_ascii_lowercase()));
            if !matched {
                return Err(format!(
                    "computer use rejected by policy: target '{target}' is not in allowed_apps \
                     whitelist ({:?})",
                    self.allowed_apps
                ));
            }
        }

        Ok(())
    }
}

/// Computer-use action requested by the model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ComputerAction {
    /// Capture screenshot of the active screen or window.
    Screenshot,
    /// Mouse click at coordinate or on accessible element id.
    Click {
        /// Screen X coordinate.
        #[serde(default)]
        x: Option<i32>,
        /// Screen Y coordinate.
        #[serde(default)]
        y: Option<i32>,
        /// Accessible element reference (e.g. `@e1`) from previous `observe`.
        #[serde(default)]
        element_id: Option<String>,
        /// Mouse button: `"left"` | `"right"` | `"middle"`. Defaults to `"left"`.
        #[serde(default)]
        button: Option<String>,
    },
    /// Double click at coordinate.
    DoubleClick {
        /// Screen X coordinate.
        x: i32,
        /// Screen Y coordinate.
        y: i32,
    },
    /// Move cursor to coordinate.
    Move {
        /// Screen X coordinate.
        x: i32,
        /// Screen Y coordinate.
        y: i32,
    },
    /// Drag cursor from start coordinate to end coordinate.
    Drag {
        /// Start X coordinate.
        start_x: i32,
        /// Start Y coordinate.
        start_y: i32,
        /// Destination X coordinate.
        end_x: i32,
        /// Destination Y coordinate.
        end_y: i32,
    },
    /// Scroll window or viewport.
    Scroll {
        /// Horizontal scroll delta.
        #[serde(default)]
        delta_x: Option<i32>,
        /// Vertical scroll delta.
        #[serde(default)]
        delta_y: Option<i32>,
        /// Optional scroll direction: `"up"` | `"down"` | `"left"` | `"right"`.
        #[serde(default)]
        direction: Option<String>,
        /// Optional scroll amount.
        #[serde(default)]
        amount: Option<i32>,
    },
    /// Type text into focused input.
    Type {
        /// Text string to type.
        text: String,
    },
    /// Press a keyboard key or shortcut combination (e.g. `"Enter"`, `"ctrl+s"`).
    Keypress {
        /// Key name or combo.
        key: String,
    },
    /// Pause execution for given milliseconds.
    Wait {
        /// Wait duration in milliseconds.
        #[serde(default = "default_wait_ms")]
        duration_ms: u64,
    },
    /// Inspect UI accessibility tree and OCR regions for text-based models.
    Observe {
        /// Optional element id to inspect subtree.
        #[serde(default)]
        element_id: Option<String>,
    },
    /// Enumerate visible desktop windows.
    ListWindows,
    /// Bring a window to foreground by title or window handle.
    FocusWindow {
        /// Window title substring.
        #[serde(default)]
        window_title: Option<String>,
        /// Window ID/handle.
        #[serde(default)]
        window_id: Option<u64>,
    },
}

const fn default_wait_ms() -> u64 {
    500
}

/// Pluggable execution backend for computer use.
#[async_trait::async_trait]
pub trait ComputerBackend: Send + Sync {
    /// Active environment.
    fn environment(&self) -> ComputerEnvironment;

    /// Execute a computer action with policy checks.
    async fn execute(
        &self,
        action: &ComputerAction,
        policy: &ComputerPolicy,
    ) -> Result<ToolOutput, ToolError>;
}

/// In-process native Windows execution backend using the `aphrody-winclean` crate.
pub struct WindowsComputerBackend;

#[async_trait::async_trait]
impl ComputerBackend for WindowsComputerBackend {
    fn environment(&self) -> ComputerEnvironment {
        ComputerEnvironment::Windows
    }

    async fn execute(
        &self,
        action: &ComputerAction,
        policy: &ComputerPolicy,
    ) -> Result<ToolOutput, ToolError> {
        let wc = match aphrody_winclean::shared() {
            Ok(wc) => wc,
            Err(error) => {
                return Ok(ToolOutput::error(format!(
                    "computer: aphrody-winclean backend unavailable ({error}); \
                     update ../aphrody-os and rebuild aphrody"
                )));
            }
        };

        match action {
            ComputerAction::Screenshot => {
                let res = wc
                    .call_async("computer_capture_screen", &json!({}))
                    .await
                    .map_err(|e| ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    })?;
                let mut images = Vec::new();
                for img in res.images() {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&img.bytes);
                    images.push(ToolImage::new(&img.mime_type, b64));
                }
                let mut out = ToolOutput::ok(if images.is_empty() {
                    res.text()
                } else {
                    format!("Screenshot captured ({} image(s)).", images.len())
                });
                out.images = images;
                Ok(out)
            }
            ComputerAction::Click {
                x,
                y,
                element_id,
                button,
            } => {
                if let Some(eid) = element_id {
                    let args = json!({ "elementId": eid });
                    let res = wc
                        .call_async("computer_click_element", &args)
                        .await
                        .map_err(|e| ToolError::Execution {
                            tool: "computer".into(),
                            message: e.to_string(),
                        })?;
                    Ok(ToolOutput::ok(res.text()))
                } else if let (Some(x), Some(y)) = (x, y) {
                    let btn = button.as_deref().unwrap_or("left");
                    let args = json!({ "x": x, "y": y, "button": btn });
                    let res = wc.call_async("computer_click", &args).await.map_err(|e| {
                        ToolError::Execution {
                            tool: "computer".into(),
                            message: e.to_string(),
                        }
                    })?;
                    Ok(ToolOutput::ok(res.text()))
                } else {
                    Err(ToolError::InvalidArguments {
                        tool: "computer".into(),
                        message: "click action requires either coordinates (x, y) or an element_id"
                            .into(),
                    })
                }
            }
            ComputerAction::DoubleClick { x, y } => {
                let args = json!({ "x": x, "y": y, "button": "left", "doubleClick": true });
                let res = wc.call_async("computer_click", &args).await.map_err(|e| {
                    ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    }
                })?;
                Ok(ToolOutput::ok(res.text()))
            }
            ComputerAction::Move { x, y } => {
                let args = json!({ "x": x, "y": y });
                let res = wc
                    .call_async("mouse_move_smooth", &args)
                    .await
                    .map_err(|e| ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    })?;
                Ok(ToolOutput::ok(res.text()))
            }
            ComputerAction::Drag {
                start_x,
                start_y,
                end_x,
                end_y,
            } => {
                let args = json!({
                    "startX": start_x,
                    "startY": start_y,
                    "endX": end_x,
                    "endY": end_y,
                });
                let res = wc.call_async("computer_drag", &args).await.map_err(|e| {
                    ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    }
                })?;
                Ok(ToolOutput::ok(res.text()))
            }
            ComputerAction::Scroll {
                delta_x,
                delta_y,
                direction,
                amount,
            } => {
                let dy = delta_y.or_else(|| match direction.as_deref() {
                    Some("up") => Some(-amount.unwrap_or(120)),
                    Some("down") => Some(amount.unwrap_or(120)),
                    _ => None,
                });
                let dx = delta_x.or_else(|| match direction.as_deref() {
                    Some("left") => Some(-amount.unwrap_or(120)),
                    Some("right") => Some(amount.unwrap_or(120)),
                    _ => None,
                });
                let args = json!({
                    "deltaX": dx.unwrap_or(0),
                    "deltaY": dy.unwrap_or(0),
                });
                let res = wc.call_async("computer_scroll", &args).await.map_err(|e| {
                    ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    }
                })?;
                Ok(ToolOutput::ok(res.text()))
            }
            ComputerAction::Type { text } => {
                let args = json!({ "text": text });
                let res = wc.call_async("computer_type", &args).await.map_err(|e| {
                    ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    }
                })?;
                Ok(ToolOutput::ok(res.text()))
            }
            ComputerAction::Keypress { key } => {
                let args = json!({ "key": key });
                let res = wc.call_async("computer_key", &args).await.map_err(|e| {
                    ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    }
                })?;
                Ok(ToolOutput::ok(res.text()))
            }
            ComputerAction::Wait { duration_ms } => {
                tokio::time::sleep(Duration::from_millis(*duration_ms)).await;
                Ok(ToolOutput::ok(format!("Waited {duration_ms} ms.")))
            }
            ComputerAction::Observe { element_id } => {
                let args = json!({ "elementId": element_id });
                let res = wc
                    .call_async("computer_observe", &args)
                    .await
                    .map_err(|e| ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    })?;
                Ok(ToolOutput::ok(res.text()))
            }
            ComputerAction::ListWindows => {
                let res = wc
                    .call_async("list_windows", &json!({}))
                    .await
                    .map_err(|e| ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    })?;
                Ok(ToolOutput::ok(res.text()))
            }
            ComputerAction::FocusWindow {
                window_title,
                window_id,
            } => {
                if let Some(title) = window_title {
                    if let Err(denial) = policy.verify_target(title) {
                        return Ok(ToolOutput::error(denial));
                    }
                    let args = json!({ "title": title });
                    let res = wc
                        .call_async("switch_to_window", &args)
                        .await
                        .map_err(|e| ToolError::Execution {
                            tool: "computer".into(),
                            message: e.to_string(),
                        })?;
                    Ok(ToolOutput::ok(res.text()))
                } else if let Some(wid) = window_id {
                    let args = json!({ "windowHandle": wid });
                    let res = wc
                        .call_async("switch_to_window", &args)
                        .await
                        .map_err(|e| ToolError::Execution {
                            tool: "computer".into(),
                            message: e.to_string(),
                        })?;
                    Ok(ToolOutput::ok(res.text()))
                } else {
                    Err(ToolError::InvalidArguments {
                        tool: "computer".into(),
                        message: "focus_window requires either window_title or window_id".into(),
                    })
                }
            }
        }
    }
}

/// Browser automation backend driven by the shared in-process browser session
/// ([`aphrody_web_service::session`]): no process is spawned.
pub struct BrowserComputerBackend;

#[async_trait::async_trait]
impl ComputerBackend for BrowserComputerBackend {
    fn environment(&self) -> ComputerEnvironment {
        ComputerEnvironment::Browser
    }

    async fn execute(
        &self,
        action: &ComputerAction,
        policy: &ComputerPolicy,
    ) -> Result<ToolOutput, ToolError> {
        let short = Duration::from_secs(5);
        let long = Duration::from_secs(15);
        match action {
            ComputerAction::Screenshot => match session::screenshot(long).await {
                Ok(png) if !png.trim().is_empty() => {
                    let mut out = ToolOutput::ok("Browser screenshot captured.");
                    out.images = vec![ToolImage::new("image/png", png.trim().to_string())];
                    Ok(out)
                }
                Ok(_) => Ok(ToolOutput::error(
                    "Browser screenshot returned no PNG data.",
                )),
                Err(error) => Ok(ToolOutput::error(format!(
                    "Browser screenshot error: {error}"
                ))),
            },
            ComputerAction::Click { element_id, .. } => match element_id {
                Some(selector) => match session::click(selector, long).await {
                    Ok(text) => Ok(ToolOutput::ok(text)),
                    Err(error) => Ok(ToolOutput::error(format!("Browser click error: {error}"))),
                },
                None => Ok(ToolOutput::error(
                    "Browser click error: coordinate clicks are not exposed by the shared \
                     browser session; pass an element_id CSS selector",
                )),
            },
            ComputerAction::DoubleClick { .. } => Ok(ToolOutput::error(
                "Browser double click error: double-click is not exposed by the shared browser \
                 session",
            )),
            ComputerAction::Move { .. } => Ok(ToolOutput::error(
                "Browser move error: pointer movement is not exposed by the shared browser \
                 session",
            )),
            ComputerAction::Drag { .. } => {
                Ok(ToolOutput::error("Native browser drag is not available."))
            }
            ComputerAction::Scroll {
                delta_x,
                delta_y,
                direction,
                amount,
            } => {
                let dy = delta_y
                    .or_else(|| match direction.as_deref() {
                        Some("up") => Some(-amount.unwrap_or(120)),
                        Some("down") => Some(amount.unwrap_or(120)),
                        _ => None,
                    })
                    .unwrap_or(0);
                let dx = delta_x.unwrap_or(0);
                match session::scroll(i64::from(dx), i64::from(dy), short).await {
                    Ok(text) => Ok(ToolOutput::ok(text)),
                    Err(error) => Ok(ToolOutput::error(format!("Browser scroll error: {error}"))),
                }
            }
            ComputerAction::Type { .. } => Ok(ToolOutput::error(
                "Browser type error: typing requires an element selector or ref",
            )),
            ComputerAction::Keypress { key } => match session::press_key(key, short).await {
                Ok(text) => Ok(ToolOutput::ok(text)),
                Err(error) => Ok(ToolOutput::error(format!("Browser key error: {error}"))),
            },
            ComputerAction::Wait { duration_ms } => {
                tokio::time::sleep(Duration::from_millis(*duration_ms)).await;
                Ok(ToolOutput::ok(format!("Waited {duration_ms} ms.")))
            }
            ComputerAction::Observe { element_id } => {
                if element_id.is_some() {
                    return Ok(ToolOutput::error(
                        "Element-specific observation requires a browser ref.",
                    ));
                }
                match session::snapshot(long).await {
                    Ok(text) => Ok(ToolOutput::ok(text)),
                    Err(error) => Ok(ToolOutput::error(format!("Browser observe error: {error}"))),
                }
            }
            ComputerAction::ListWindows => match session::tabs(long).await {
                Ok(text) => Ok(ToolOutput::ok(text)),
                Err(error) => Ok(ToolOutput::error(format!(
                    "Browser tab listing error: {error}"
                ))),
            },
            ComputerAction::FocusWindow { window_title, .. } => {
                if let Some(url) = window_title {
                    if let Err(denial) = policy.verify_target(url) {
                        return Ok(ToolOutput::error(denial));
                    }
                    match session::navigate(url, long).await {
                        Ok(text) => Ok(ToolOutput::ok(format!(
                            "Navigated browser to '{url}':\n{text}"
                        ))),
                        Err(error) => Ok(ToolOutput::error(format!("Navigation error: {error}"))),
                    }
                } else {
                    Ok(ToolOutput::error("Native browser focus requires a URL."))
                }
            }
        }
    }
}

/// Terminal computer-use backend via `aphrody-term`: reads the screen from the in-memory grid
/// (no OCR) and writes keys/text into the PTY.
#[cfg(not(target_arch = "wasm32"))]
pub struct TerminalComputerBackend {
    grid: Arc<aphrody_term::FairMutex<aphrody_term::TerminalGrid>>,
    controller: Arc<aphrody_term::ComputerUseController>,
}

#[cfg(not(target_arch = "wasm32"))]
impl TerminalComputerBackend {
    /// Create a new terminal backend wrapping an existing grid and controller.
    #[must_use]
    pub fn new(
        grid: Arc<aphrody_term::FairMutex<aphrody_term::TerminalGrid>>,
        controller: Arc<aphrody_term::ComputerUseController>,
    ) -> Self {
        Self { grid, controller }
    }

    /// Spawn `program` (default: `COMSPEC`/`cmd.exe` on Windows, `SHELL`/`/bin/sh` elsewhere)
    /// in a native PTY and attach the backend to it.
    pub fn spawn_shell(
        program: Option<&str>,
        cols: u16,
        rows: u16,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let program = program.map(str::to_owned).unwrap_or_else(default_shell);
        let term = aphrody_term::AphrodyTerm::spawn_pty(
            &program,
            &[],
            aphrody_term::TermConfig {
                cols,
                rows,
                ..Default::default()
            },
        )?;
        Ok(Self {
            grid: term.grid(),
            controller: term.computer_use_handle(),
        })
    }

    /// Create a headless backend with no PTY: `screenshot` works, input actions return an error.
    #[must_use]
    pub fn standalone(cols: usize, rows: usize) -> Self {
        let grid = Arc::new(aphrody_term::FairMutex::new(
            aphrody_term::TerminalGrid::new(cols, rows, 10_000),
        ));
        let controller = Arc::new(aphrody_term::ComputerUseController::new(None));
        Self { grid, controller }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn default_shell() -> String {
    #[cfg(windows)]
    let (var, fallback) = ("COMSPEC", "cmd.exe");
    #[cfg(not(windows))]
    let (var, fallback) = ("SHELL", "/bin/sh");
    std::env::var(var)
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| fallback.to_owned())
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait::async_trait]
impl ComputerBackend for TerminalComputerBackend {
    fn environment(&self) -> ComputerEnvironment {
        ComputerEnvironment::Terminal
    }

    async fn execute(
        &self,
        action: &ComputerAction,
        _policy: &ComputerPolicy,
    ) -> Result<ToolOutput, ToolError> {
        match action {
            ComputerAction::Screenshot | ComputerAction::Observe { .. } => {
                let g = self.grid.lock();
                let text = self.controller.snapshot_text(&g);
                let (col, row, visible) = self.controller.cursor_position(&g);
                Ok(ToolOutput::ok(format!(
                    "Terminal buffer (cursor at col {col}, row {row}, visible: {visible}):\n{text}"
                )))
            }
            ComputerAction::Type { text } => {
                self.controller
                    .dispatch_action(aphrody_term::ComputerAction::TypeText(text.clone()))
                    .map_err(|e| ToolError::Execution {
                        tool: "computer".into(),
                        message: format!("terminal type error: {e}"),
                    })?;
                Ok(ToolOutput::ok(format!(
                    "Typed {} character(s) into terminal.",
                    text.len()
                )))
            }
            ComputerAction::Keypress { key } => {
                self.controller
                    .dispatch_action(aphrody_term::ComputerAction::PressKey(key.clone()))
                    .map_err(|e| ToolError::Execution {
                        tool: "computer".into(),
                        message: format!("terminal keypress error: {e}"),
                    })?;
                Ok(ToolOutput::ok(format!("Pressed key '{key}' in terminal.")))
            }
            ComputerAction::Wait { duration_ms } => {
                tokio::time::sleep(Duration::from_millis(*duration_ms)).await;
                Ok(ToolOutput::ok(format!("Waited {duration_ms} ms.")))
            }
            other => Ok(ToolOutput::error(format!(
                "computer action `{}` is not supported in terminal environment",
                other.name()
            ))),
        }
    }
}

/// Execution mode for a remote computer-use backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteComputerMode {
    /// Remote native Windows desktop via WinClean MCP tools.
    WinClean,
    /// Remote WSL Linux guest via `wsl_execute` and WSL telemetry tools.
    Wsl,
}

/// Target endpoint and configuration for a remote administrator's PC computer-use session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteComputerTarget {
    /// Host name, IP address, or inventory alias (e.g. "omar", "10.200.77.10", "aphro-pc").
    pub host: String,
    /// Target port (defaults to 8793 for Aphrody PC MCP, 18793 for forwarded tunnel).
    pub port: u16,
    /// Explicit MCP/HTTP endpoint (e.g. "http://10.200.77.10:8793/mcp").
    pub endpoint: String,
    /// Optional authentication bearer token.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
    /// Optional WSL distribution name when targeting remote WSL (defaults to "Ubuntu-24.04").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wsl_distro: Option<String>,
    /// Tunnel member id scoping the credential store (`aphrody infra remote token`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub member: Option<String>,
}

impl RemoteComputerTarget {
    /// Default WSL distribution for admin tasks.
    pub const DEFAULT_WSL_DISTRO: &'static str = "Ubuntu-24.04";

    /// Resolve a host, alias, tunnel member (`omar`, `omar-tunnel`, `aphro-pc`), `host:port` or
    /// `http(s)://` endpoint through the shared remote target model (declared tunnel inventory).
    #[must_use]
    pub fn resolve(host: &str) -> Self {
        use rd::target::TargetKind;
        let wsl_distro = Some(Self::DEFAULT_WSL_DISTRO.to_string());
        match rd::target::resolve(host, TargetKind::McpHttp, None) {
            Ok(t) if t.kind == TargetKind::McpHttp => Self {
                endpoint: t.url(),
                host: t.host,
                port: t.port,
                auth_token: None,
                wsl_distro,
                member: t.id,
            },
            // Not an MCP endpoint (empty, other scheme): keep the spec so the call reports it.
            _ => Self {
                host: host.trim().to_string(),
                port: TargetKind::McpHttp.default_port(),
                endpoint: host.trim().to_string(),
                auth_token: None,
                wsl_distro,
                member: None,
            },
        }
    }

    /// Construct a target for administrator Omar.
    #[must_use]
    pub fn omar() -> Self {
        Self::resolve("omar")
    }

    /// With an explicit WSL distribution.
    #[must_use]
    pub fn with_wsl_distro(mut self, distro: impl Into<String>) -> Self {
        self.wsl_distro = Some(distro.into());
        self
    }

    /// With an explicit authentication token.
    #[must_use]
    pub fn with_auth_token(mut self, token: impl Into<String>) -> Self {
        self.auth_token = Some(token.into());
        self
    }
}

/// JSON-RPC reply from a streamable HTTP body: plain JSON or the first SSE `data:` event
/// carrying a JSON object.
fn parse_mcp_reply(text: &str) -> Option<Value> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(v) = serde_json::from_str::<Value>(text) {
        return Some(v);
    }
    text.lines()
        .filter_map(|l| l.strip_prefix("data:"))
        .filter_map(|d| serde_json::from_str::<Value>(d.trim()).ok())
        .find(|v| v.get("result").is_some() || v.get("error").is_some())
}

/// Remote execution backend for computer use on an administrator's PC.
/// Communicates with the remote PC's Aphrody MCP service over WireGuard / HTTP.
pub struct RemoteComputerBackend {
    target: RemoteComputerTarget,
    mode: RemoteComputerMode,
    client: reqwest::Client,
    /// Streamable HTTP MCP session (`Mcp-Session-Id`), opened on first call.
    session: tokio::sync::Mutex<Option<String>>,
}

impl RemoteComputerBackend {
    /// Create a new remote backend for the specified target and mode.
    #[must_use]
    pub fn new(target: RemoteComputerTarget, mode: RemoteComputerMode) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();
        Self {
            target,
            mode,
            client,
            session: tokio::sync::Mutex::new(None),
        }
    }

    /// Target information.
    #[must_use]
    pub fn target(&self) -> &RemoteComputerTarget {
        &self.target
    }

    /// Execution mode.
    #[must_use]
    pub fn mode(&self) -> RemoteComputerMode {
        self.mode
    }

    /// Call a remote tool on the target PC over HTTP MCP JSON-RPC.
    pub async fn call_remote_tool(
        &self,
        name: &str,
        arguments: &Value,
    ) -> Result<Value, ToolError> {
        let payload = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": { "name": name, "arguments": arguments }
        });
        let mut session = self.session.lock().await;
        for attempt in 0..2 {
            if session.is_none() {
                *session = Some(self.open_session().await?);
            }
            let (status, _, body) = self.post(&payload, session.as_deref()).await?;
            // An expired or unknown session is reopened once.
            if status == reqwest::StatusCode::NOT_FOUND && attempt == 0 {
                *session = None;
                continue;
            }
            if !status.is_success() {
                return Err(self.error(format!(
                    "remote computer-use `{name}`: HTTP {status} from {}",
                    self.target.endpoint
                )));
            }
            let body = body.ok_or_else(|| self.error(format!("empty response to `{name}`")))?;
            if let Some(err) = body.get("error") {
                return Err(self.error(format!("remote MCP error: {err}")));
            }
            return Ok(body.get("result").cloned().unwrap_or(body));
        }
        Err(self.error(format!(
            "remote MCP session refused by {}",
            self.target.endpoint
        )))
    }

    fn error(&self, message: String) -> ToolError {
        ToolError::Execution {
            tool: "computer".into(),
            message,
        }
    }

    fn bearer(&self) -> Option<String> {
        self.target.auth_token.clone().or_else(|| {
            rd::tokens::resolve(rd::tokens::TokenKind::Mcp, self.target.member.as_deref())
                .map(|s| s.expose().to_owned())
        })
    }

    /// POST one JSON-RPC message; returns the status, the session header and the JSON-RPC
    /// reply (plain JSON or the first `data:` event of an SSE stream).
    async fn post(
        &self,
        payload: &Value,
        session: Option<&str>,
    ) -> Result<(reqwest::StatusCode, Option<String>, Option<Value>), ToolError> {
        let mut req = self
            .client
            .post(&self.target.endpoint)
            .header("Accept", "application/json, text/event-stream")
            // The remote Aphrody MCP binds a loopback address by contract
            // (`aphrody-mcp http` refuses a non-loopback bind) and is reached over the
            // tunnel through a netsh portproxy. rmcp's streamable-HTTP transport guards
            // against DNS rebinding by rejecting any Host header that is not loopback
            // ("Forbidden: Host header is not allowed"), so the mesh address reqwest would
            // derive (e.g. 10.200.77.10:8793) is refused. Present the loopback identity the
            // server actually listens on; the portproxy already routed us there.
            .header(reqwest::header::HOST, "localhost")
            .json(payload);
        if let Some(token) = self.bearer() {
            req = req.bearer_auth(token);
        }
        if let Some(id) = session {
            req = req.header("Mcp-Session-Id", id);
        }
        let resp = req.send().await.map_err(|e| {
            self.error(format!(
                "remote computer-use call to {} ({}) failed: {e}",
                self.target.host, self.target.endpoint
            ))
        })?;
        let status = resp.status();
        let session_id = resp
            .headers()
            .get("mcp-session-id")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let text = resp
            .text()
            .await
            .map_err(|e| self.error(format!("remote computer-use read failed: {e}")))?;
        Ok((status, session_id, parse_mcp_reply(&text)))
    }

    /// `initialize` + `notifications/initialized`, returning the session id.
    async fn open_session(&self) -> Result<String, ToolError> {
        let init = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "aphrody-remote-computer", "version": env!("CARGO_PKG_VERSION") }
            }
        });
        let (status, session, _) = self.post(&init, None).await?;
        if !status.is_success() {
            return Err(self.error(format!(
                "remote MCP initialize: HTTP {status} from {}{}",
                self.target.endpoint,
                if status == reqwest::StatusCode::UNAUTHORIZED {
                    format!(
                        " (set {} or run aphrody infra remote token set mcp)",
                        rd::tokens::TokenKind::Mcp.env()
                    )
                } else {
                    String::new()
                }
            )));
        }
        let session = session
            .ok_or_else(|| self.error("remote MCP initialize returned no session".into()))?;
        let note = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        self.post(&note, Some(&session)).await?;
        Ok(session)
    }

    async fn execute_winclean(
        &self,
        action: &ComputerAction,
        _policy: &ComputerPolicy,
    ) -> Result<ToolOutput, ToolError> {
        match action {
            ComputerAction::Screenshot => {
                let res = self
                    .call_remote_tool("computer_capture_screen", &json!({}))
                    .await?;
                parse_remote_mcp_output(&res, "Screenshot captured from remote PC.")
            }
            ComputerAction::Click {
                x,
                y,
                element_id,
                button,
            } => {
                if let Some(eid) = element_id {
                    let args = json!({ "elementId": eid });
                    let res = self
                        .call_remote_tool("computer_click_element", &args)
                        .await?;
                    parse_remote_mcp_output(&res, "Clicked remote element.")
                } else if let (Some(x), Some(y)) = (x, y) {
                    let btn = button.as_deref().unwrap_or("left");
                    let args = json!({ "x": x, "y": y, "button": btn });
                    let res = self.call_remote_tool("computer_click", &args).await?;
                    parse_remote_mcp_output(&res, "Clicked at coordinates on remote PC.")
                } else {
                    Err(ToolError::InvalidArguments {
                        tool: "computer".into(),
                        message: "click action requires coordinates (x, y) or an element_id".into(),
                    })
                }
            }
            ComputerAction::DoubleClick { x, y } => {
                let args = json!({ "x": x, "y": y, "button": "left", "doubleClick": true });
                let res = self.call_remote_tool("computer_click", &args).await?;
                parse_remote_mcp_output(&res, "Double clicked on remote PC.")
            }
            ComputerAction::Move { x, y } => {
                let args = json!({ "x": x, "y": y });
                let res = self.call_remote_tool("mouse_move_smooth", &args).await?;
                parse_remote_mcp_output(&res, "Moved mouse on remote PC.")
            }
            ComputerAction::Drag {
                start_x,
                start_y,
                end_x,
                end_y,
            } => {
                let args = json!({
                    "startX": start_x,
                    "startY": start_y,
                    "endX": end_x,
                    "endY": end_y,
                });
                let res = self.call_remote_tool("computer_drag", &args).await?;
                parse_remote_mcp_output(&res, "Dragged on remote PC.")
            }
            ComputerAction::Scroll {
                delta_x,
                delta_y,
                direction,
                amount,
            } => {
                let dy = delta_y.or_else(|| match direction.as_deref() {
                    Some("up") => Some(-amount.unwrap_or(120)),
                    Some("down") => Some(amount.unwrap_or(120)),
                    _ => None,
                });
                let dx = delta_x.or_else(|| match direction.as_deref() {
                    Some("left") => Some(-amount.unwrap_or(120)),
                    Some("right") => Some(amount.unwrap_or(120)),
                    _ => None,
                });
                let args = json!({
                    "deltaX": dx.unwrap_or(0),
                    "deltaY": dy.unwrap_or(0),
                });
                let res = self.call_remote_tool("computer_scroll", &args).await?;
                parse_remote_mcp_output(&res, "Scrolled on remote PC.")
            }
            ComputerAction::Type { text } => {
                let args = json!({ "text": text });
                let res = self.call_remote_tool("computer_type", &args).await?;
                parse_remote_mcp_output(&res, "Typed on remote PC.")
            }
            ComputerAction::Keypress { key } => {
                let args = json!({ "key": key });
                let res = self.call_remote_tool("computer_key", &args).await?;
                parse_remote_mcp_output(&res, "Pressed key on remote PC.")
            }
            ComputerAction::Wait { duration_ms } => {
                tokio::time::sleep(Duration::from_millis(*duration_ms)).await;
                Ok(ToolOutput::ok(format!(
                    "Waited {duration_ms} ms on remote target."
                )))
            }
            ComputerAction::Observe { element_id } => {
                let args = json!({ "elementId": element_id });
                let res = self.call_remote_tool("computer_observe", &args).await?;
                parse_remote_mcp_output(&res, "Observed remote desktop.")
            }
            ComputerAction::ListWindows => {
                let res = self.call_remote_tool("list_windows", &json!({})).await?;
                parse_remote_mcp_output(&res, "Listed windows on remote PC.")
            }
            ComputerAction::FocusWindow {
                window_title,
                window_id,
            } => {
                let args = if let Some(title) = window_title {
                    json!({ "title": title })
                } else if let Some(wid) = window_id {
                    json!({ "windowHandle": wid })
                } else {
                    return Err(ToolError::InvalidArguments {
                        tool: "computer".into(),
                        message: "focus_window requires window_title or window_id".into(),
                    });
                };
                let res = self.call_remote_tool("switch_to_window", &args).await?;
                parse_remote_mcp_output(&res, "Focused window on remote PC.")
            }
        }
    }

    async fn execute_wsl(
        &self,
        action: &ComputerAction,
        _policy: &ComputerPolicy,
    ) -> Result<ToolOutput, ToolError> {
        let distro = self
            .target
            .wsl_distro
            .as_deref()
            .unwrap_or(RemoteComputerTarget::DEFAULT_WSL_DISTRO);
        match action {
            ComputerAction::Screenshot => {
                // If a visual capture is possible on remote PC, attempt it; otherwise return process telemetry.
                match self
                    .call_remote_tool("computer_capture_screen", &json!({}))
                    .await
                {
                    Ok(res)
                        if res
                            .get("content")
                            .and_then(Value::as_array)
                            .is_some_and(|c| {
                                c.iter()
                                    .any(|b| b.get("type").and_then(Value::as_str) == Some("image"))
                            }) =>
                    {
                        parse_remote_mcp_output(&res, "WSL desktop screenshot captured.")
                    }
                    _ => {
                        let res = self
                            .call_remote_tool(
                                "wsl_list_processes",
                                &json!({ "distribution": distro }),
                            )
                            .await?;
                        let text = format_wsl_process_list(&res, distro);
                        Ok(ToolOutput::ok(text))
                    }
                }
            }
            ComputerAction::Observe { .. } => {
                let res = self
                    .call_remote_tool("wsl_list_processes", &json!({ "distribution": distro }))
                    .await?;
                let text = format_wsl_process_list(&res, distro);
                Ok(ToolOutput::ok(text))
            }
            ComputerAction::Type { text } => {
                let args = json!({
                    "distribution": distro,
                    "command": ["/bin/sh", "-lc", text],
                });
                let res = self.call_remote_tool("wsl_execute", &args).await?;
                let text = format_wsl_execution_result(&res, distro, text);
                Ok(ToolOutput::ok(text))
            }
            ComputerAction::Keypress { key } => {
                let sig = match key.to_ascii_uppercase().as_str() {
                    "CTRL+C" | "SIGINT" => "INT",
                    "SIGTERM" => "TERM",
                    "SIGKILL" => "KILL",
                    _ => "INT",
                };
                let args = json!({
                    "distribution": distro,
                    "processId": 0,
                    "signal": sig,
                });
                let res = self.call_remote_tool("wsl_send_signal", &args).await?;
                parse_remote_mcp_output(
                    &res,
                    &format!("Dispatched signal {sig} to WSL distro {distro}."),
                )
            }
            ComputerAction::Wait { duration_ms } => {
                tokio::time::sleep(Duration::from_millis(*duration_ms)).await;
                Ok(ToolOutput::ok(format!(
                    "Waited {duration_ms} ms in remote WSL session."
                )))
            }
            ComputerAction::ListWindows => {
                let distros = self
                    .call_remote_tool("wsl_list_distributions", &json!({}))
                    .await?;
                let text = format!(
                    "WSL Distributions on {}:\n{}",
                    self.target.host,
                    serde_json::to_string_pretty(&distros).unwrap_or_default()
                );
                Ok(ToolOutput::ok(text))
            }
            ComputerAction::FocusWindow { window_title, .. } => {
                if let Some(target_distro) = window_title {
                    Ok(ToolOutput::ok(format!(
                        "Selected active WSL distribution: `{target_distro}` on remote PC {}.",
                        self.target.host
                    )))
                } else {
                    Ok(ToolOutput::ok(format!(
                        "Active WSL distribution: `{distro}` on remote PC {}.",
                        self.target.host
                    )))
                }
            }
            other => Ok(ToolOutput::error(format!(
                "computer action `{}` is not supported in WSL environment (use `type` to execute commands, or `observe` to inspect processes)",
                other.name()
            ))),
        }
    }
}

#[async_trait::async_trait]
impl ComputerBackend for RemoteComputerBackend {
    fn environment(&self) -> ComputerEnvironment {
        match self.mode {
            RemoteComputerMode::WinClean => ComputerEnvironment::RemoteWindows,
            RemoteComputerMode::Wsl => ComputerEnvironment::RemoteWsl,
        }
    }

    async fn execute(
        &self,
        action: &ComputerAction,
        policy: &ComputerPolicy,
    ) -> Result<ToolOutput, ToolError> {
        if let ComputerAction::FocusWindow {
            window_title: Some(title),
            ..
        } = action
            && let Err(denial) = policy.verify_target(title)
        {
            return Ok(ToolOutput::error(denial));
        }

        match self.mode {
            RemoteComputerMode::WinClean => self.execute_winclean(action, policy).await,
            RemoteComputerMode::Wsl => self.execute_wsl(action, policy).await,
        }
    }
}

/// Computer use over RFB: any VNC server (`aphrody infra remote serve`, TigerVNC, macOS...).
/// The session opens on the first action and is reused; a failed action drops it.
pub struct VncComputerBackend {
    target: rd::target::RemoteTarget,
    password: Option<String>,
    session: tokio::sync::Mutex<Option<rd::vnc::client::VncSession>>,
}

impl VncComputerBackend {
    /// Backend for `target` (`vnc://host:port`, tunnel member or `host[:port]`); the password
    /// comes from the credential store when `password` is `None`.
    ///
    /// # Errors
    ///
    /// Returns an error when the target does not resolve to an RFB endpoint.
    pub fn new(target: &str, password: Option<String>) -> Result<Self, ToolError> {
        let t = rd::target::resolve(target, rd::target::TargetKind::Vnc, None)
            .map_err(|e| vnc_error(format!("{e:#}")))?;
        if t.kind != rd::target::TargetKind::Vnc {
            return Err(vnc_error(format!(
                "{target}: not a VNC target (use vnc://host:port)"
            )));
        }
        Ok(Self {
            target: t,
            password,
            session: tokio::sync::Mutex::new(None),
        })
    }

    /// Canonical `vnc://` URL of the target.
    #[must_use]
    pub fn url(&self) -> String {
        self.target.url()
    }

    async fn run(&self, action: &ComputerAction) -> anyhow::Result<ToolOutput> {
        use rd::backend::MouseButton;
        let mut guard = self.session.lock().await;
        if guard.is_none() {
            let password = self
                .password
                .clone()
                .or_else(|| self.target.credential().map(|s| s.expose().to_owned()));
            *guard =
                Some(rd::vnc::client::VncSession::connect(&self.target.addr(), password).await?);
        }
        let Some(vnc) = guard.as_ref() else {
            anyhow::bail!("VNC session unavailable")
        };
        let out = match action {
            ComputerAction::Screenshot => {
                let shot = vnc.screenshot(80, 1).await?;
                let b64 = base64::engine::general_purpose::STANDARD.encode(&shot.jpeg);
                let mut out = ToolOutput::ok(format!(
                    "Screenshot {}x{} from {}.",
                    shot.width,
                    shot.height,
                    self.target.url()
                ));
                out.images = vec![ToolImage::new("image/jpeg", b64)];
                out
            }
            ComputerAction::Click {
                x: Some(x),
                y: Some(y),
                element_id: None,
                button,
            } => {
                let b = MouseButton::parse(button.as_deref().unwrap_or("left"));
                vnc.click(*x, *y, b, 1).await?;
                ToolOutput::ok(format!("Clicked {} at ({x}, {y}).", b.as_str()))
            }
            ComputerAction::Click { .. } => ToolOutput::error(
                "VNC click needs x and y (no accessibility tree over RFB)".to_string(),
            ),
            ComputerAction::DoubleClick { x, y } => {
                vnc.click(*x, *y, MouseButton::Left, 2).await?;
                ToolOutput::ok(format!("Double-clicked at ({x}, {y})."))
            }
            ComputerAction::Move { x, y } => {
                vnc.move_to(*x, *y).await?;
                ToolOutput::ok(format!("Moved to ({x}, {y})."))
            }
            ComputerAction::Drag {
                start_x,
                start_y,
                end_x,
                end_y,
            } => {
                vnc.drag((*start_x, *start_y), (*end_x, *end_y)).await?;
                ToolOutput::ok(format!(
                    "Dragged ({start_x}, {start_y}) -> ({end_x}, {end_y})."
                ))
            }
            ComputerAction::Scroll {
                delta_x,
                delta_y,
                direction,
                amount,
            } => {
                let (dx, dy) = scroll_deltas(*delta_x, *delta_y, direction.as_deref(), *amount);
                vnc.scroll(dx, dy).await?;
                ToolOutput::ok(format!("Scrolled ({dx}, {dy})."))
            }
            ComputerAction::Type { text } => {
                vnc.type_text(text).await?;
                ToolOutput::ok(format!("Typed {} character(s).", text.chars().count()))
            }
            ComputerAction::Keypress { key } => {
                vnc.keypress(key).await?;
                ToolOutput::ok(format!("Pressed {key}."))
            }
            ComputerAction::Wait { duration_ms } => {
                tokio::time::sleep(Duration::from_millis(*duration_ms)).await;
                ToolOutput::ok(format!("Waited {duration_ms} ms."))
            }
            ComputerAction::Observe { .. }
            | ComputerAction::ListWindows
            | ComputerAction::FocusWindow { .. } => ToolOutput::error(format!(
                "`{}` is unavailable over RFB (pixels and input only); use screenshot",
                action.name()
            )),
        };
        Ok(out)
    }
}

/// Scroll deltas in 120-unit wheel steps: explicit deltas win, else `direction` × `amount`.
fn scroll_deltas(
    delta_x: Option<i32>,
    delta_y: Option<i32>,
    direction: Option<&str>,
    amount: Option<i32>,
) -> (i32, i32) {
    let step = amount.unwrap_or(120);
    let dy = delta_y.unwrap_or(match direction {
        Some("up") => -step,
        Some("down") => step,
        _ => 0,
    });
    let dx = delta_x.unwrap_or(match direction {
        Some("left") => -step,
        Some("right") => step,
        _ => 0,
    });
    (dx, dy)
}

fn vnc_error(message: String) -> ToolError {
    ToolError::Execution {
        tool: "computer".into(),
        message,
    }
}

#[async_trait::async_trait]
impl ComputerBackend for VncComputerBackend {
    fn environment(&self) -> ComputerEnvironment {
        ComputerEnvironment::RemoteVnc
    }

    async fn execute(
        &self,
        action: &ComputerAction,
        _policy: &ComputerPolicy,
    ) -> Result<ToolOutput, ToolError> {
        match self.run(action).await {
            Ok(out) => Ok(out),
            Err(e) => {
                // A broken connection is reopened by the next action.
                if let Some(old) = self.session.lock().await.take() {
                    old.close().await;
                }
                Err(vnc_error(format!("VNC {}: {e:#}", self.target.url())))
            }
        }
    }
}

/// Local Windows Subsystem for Linux (WSL) computer-use backend.
/// Uses the in-process `aphrody-winclean` crate to drive WSL distributions directly.
pub struct WslComputerBackend {
    distro: String,
}

impl WslComputerBackend {
    /// Create a local WSL backend targeting `distro` (defaults to "Ubuntu-24.04").
    #[must_use]
    pub fn new(distro: Option<&str>) -> Self {
        Self {
            distro: distro
                .unwrap_or(RemoteComputerTarget::DEFAULT_WSL_DISTRO)
                .to_string(),
        }
    }
}

#[async_trait::async_trait]
impl ComputerBackend for WslComputerBackend {
    fn environment(&self) -> ComputerEnvironment {
        ComputerEnvironment::Wsl
    }

    async fn execute(
        &self,
        action: &ComputerAction,
        _policy: &ComputerPolicy,
    ) -> Result<ToolOutput, ToolError> {
        let wc = match aphrody_winclean::shared() {
            Ok(wc) => wc,
            Err(error) => {
                return Ok(ToolOutput::error(format!(
                    "WSL computer use unavailable: aphrody-winclean backend not loaded ({error})"
                )));
            }
        };

        match action {
            ComputerAction::Screenshot | ComputerAction::Observe { .. } => {
                let args = json!({ "distribution": self.distro });
                let res = wc
                    .call_async("wsl_list_processes", &args)
                    .await
                    .map_err(|e| ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    })?;
                let text = format!("WSL [{}] Processes:\n{}", self.distro, res.text());
                Ok(ToolOutput::ok(text))
            }
            ComputerAction::Type { text } => {
                let args = json!({
                    "distribution": self.distro,
                    "command": ["/bin/sh", "-lc", text],
                });
                let res = wc.call_async("wsl_execute", &args).await.map_err(|e| {
                    ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    }
                })?;
                let out_text = res.text();
                Ok(ToolOutput::ok(if out_text.is_empty() {
                    serde_json::to_string_pretty(&res.structured_content).unwrap_or_default()
                } else {
                    out_text
                }))
            }
            ComputerAction::Keypress { key } => {
                let sig = match key.to_ascii_uppercase().as_str() {
                    "CTRL+C" | "SIGINT" => "INT",
                    "SIGTERM" => "TERM",
                    "SIGKILL" => "KILL",
                    _ => "INT",
                };
                let args = json!({
                    "distribution": self.distro,
                    "processId": 0,
                    "signal": sig,
                });
                let res = wc.call_async("wsl_send_signal", &args).await.map_err(|e| {
                    ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    }
                })?;
                Ok(ToolOutput::ok(res.text()))
            }
            ComputerAction::Wait { duration_ms } => {
                tokio::time::sleep(Duration::from_millis(*duration_ms)).await;
                Ok(ToolOutput::ok(format!("Waited {duration_ms} ms in WSL.")))
            }
            ComputerAction::ListWindows => {
                let res = wc
                    .call_async("wsl_list_distributions", &json!({}))
                    .await
                    .map_err(|e| ToolError::Execution {
                        tool: "computer".into(),
                        message: e.to_string(),
                    })?;
                Ok(ToolOutput::ok(format!(
                    "WSL Distributions:\n{}",
                    res.text()
                )))
            }
            ComputerAction::FocusWindow { window_title, .. } => {
                if let Some(target) = window_title {
                    Ok(ToolOutput::ok(format!(
                        "Targeted WSL distribution: `{target}`."
                    )))
                } else {
                    Ok(ToolOutput::ok(format!(
                        "Active WSL distribution: `{}`.",
                        self.distro
                    )))
                }
            }
            other => Ok(ToolOutput::error(format!(
                "computer action `{}` is not supported in WSL environment",
                other.name()
            ))),
        }
    }
}

fn parse_remote_mcp_output(value: &Value, fallback_default: &str) -> Result<ToolOutput, ToolError> {
    let is_error = value
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mut texts = Vec::new();
    let mut images = Vec::new();

    if let Some(content) = value.get("content").and_then(Value::as_array) {
        for block in content {
            match block.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(t) = block.get("text").and_then(Value::as_str) {
                        texts.push(t);
                    }
                }
                Some("image") => {
                    if let Some(data) = block.get("data").and_then(Value::as_str) {
                        let mime = block
                            .get("mimeType")
                            .and_then(Value::as_str)
                            .unwrap_or("image/png");
                        images.push(ToolImage::new(mime, data));
                    }
                }
                _ => {}
            }
        }
    }

    let text = if texts.is_empty() {
        if let Some(structured) = value.get("structuredContent") {
            serde_json::to_string_pretty(structured)
                .unwrap_or_else(|_| fallback_default.to_string())
        } else {
            fallback_default.to_string()
        }
    } else {
        texts.join("\n")
    };

    let mut out = if is_error {
        ToolOutput::error(text)
    } else {
        ToolOutput::ok(text)
    };
    out.images = images;
    Ok(out)
}

fn format_wsl_process_list(value: &Value, distro: &str) -> String {
    let mut s = format!("WSL [{distro}] Active Processes:\n");
    if let Some(text) = value
        .get("content")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .and_then(|b| b.get("text"))
        .and_then(Value::as_str)
    {
        s.push_str(text);
    } else if let Some(content) = value.get("structuredContent") {
        s.push_str(&serde_json::to_string_pretty(content).unwrap_or_default());
    } else {
        s.push_str(&serde_json::to_string_pretty(value).unwrap_or_default());
    }
    s
}

fn format_wsl_execution_result(value: &Value, distro: &str, command: &str) -> String {
    let struct_val = value.get("structuredContent").unwrap_or(value);
    let stdout = struct_val
        .get("Stdout")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let stderr = struct_val
        .get("Stderr")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let exit_code = struct_val
        .get("ExitCode")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let success = struct_val
        .get("Success")
        .and_then(Value::as_bool)
        .unwrap_or(exit_code == 0);

    let err_str = if stderr.is_empty() {
        String::new()
    } else {
        format!("\n[stderr]: {stderr}")
    };

    format!(
        "WSL [{distro}] Execution (exit {exit_code}, success: {success}) for `{command}`:\n{stdout}{err_str}"
    )
}

/// Backend for a target environment this build cannot drive.
///
/// Every action is rejected with an explicit error naming the missing
/// backend, so the model learns the desktop is unavailable instead of
/// receiving invented results. Used for `Linux` (no X11 backend yet) and for
/// `Windows` requested on a non-Windows host.
pub struct UnsupportedComputerBackend {
    env: ComputerEnvironment,
    reason: std::borrow::Cow<'static, str>,
}

impl UnsupportedComputerBackend {
    /// Describe why `env` cannot be driven by this build.
    #[must_use]
    pub fn new(
        env: ComputerEnvironment,
        reason: impl Into<std::borrow::Cow<'static, str>>,
    ) -> Self {
        Self {
            env,
            reason: reason.into(),
        }
    }
}

#[async_trait::async_trait]
impl ComputerBackend for UnsupportedComputerBackend {
    fn environment(&self) -> ComputerEnvironment {
        self.env
    }

    async fn execute(
        &self,
        action: &ComputerAction,
        _policy: &ComputerPolicy,
    ) -> Result<ToolOutput, ToolError> {
        Ok(ToolOutput::error(format!(
            "computer action `{}` unavailable: the `{}` desktop backend is not supported by this \
             build ({}). Use the `browser` tool for web tasks.",
            action.name(),
            self.env.as_str(),
            self.reason
        )))
    }
}

/// In-memory mock backend for testing computer use without native desktop display.
pub struct MockComputerBackend {
    /// Environment reported.
    pub env: ComputerEnvironment,
    /// Recorded actions for assertions.
    pub recorded: std::sync::Mutex<Vec<ComputerAction>>,
}

impl MockComputerBackend {
    /// Create a new mock backend.
    #[must_use]
    pub fn new(env: ComputerEnvironment) -> Self {
        Self {
            env,
            recorded: std::sync::Mutex::new(Vec::new()),
        }
    }
}

#[async_trait::async_trait]
impl ComputerBackend for MockComputerBackend {
    fn environment(&self) -> ComputerEnvironment {
        self.env
    }

    async fn execute(
        &self,
        action: &ComputerAction,
        policy: &ComputerPolicy,
    ) -> Result<ToolOutput, ToolError> {
        if let ComputerAction::FocusWindow {
            window_title: Some(title),
            ..
        } = action
            && let Err(denial) = policy.verify_target(title)
        {
            return Ok(ToolOutput::error(denial));
        }

        let mut rec = self.recorded.lock().unwrap();
        rec.push(action.clone());

        match action {
            ComputerAction::Screenshot => {
                // 1x1 transparent PNG encoded in base64
                let png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
                let mut out = ToolOutput::ok("Screenshot captured (1920x1080).");
                out.images = vec![ToolImage::new("image/png", png_b64)];
                Ok(out)
            }
            ComputerAction::Click {
                x,
                y,
                element_id,
                button,
            } => {
                let btn = button.as_deref().unwrap_or("left");
                if let Some(eid) = element_id {
                    Ok(ToolOutput::ok(format!(
                        "Clicked element '{eid}' with {btn} button."
                    )))
                } else {
                    Ok(ToolOutput::ok(format!(
                        "Clicked at ({}, {}) with {btn} button.",
                        x.unwrap_or(0),
                        y.unwrap_or(0)
                    )))
                }
            }
            ComputerAction::DoubleClick { x, y } => {
                Ok(ToolOutput::ok(format!("Double clicked at ({x}, {y}).")))
            }
            ComputerAction::Move { x, y } => {
                Ok(ToolOutput::ok(format!("Moved cursor to ({x}, {y}).")))
            }
            ComputerAction::Drag {
                start_x,
                start_y,
                end_x,
                end_y,
            } => Ok(ToolOutput::ok(format!(
                "Dragged from ({start_x}, {start_y}) to ({end_x}, {end_y})."
            ))),
            ComputerAction::Scroll {
                delta_x, delta_y, ..
            } => Ok(ToolOutput::ok(format!(
                "Scrolled dx: {}, dy: {}.",
                delta_x.unwrap_or(0),
                delta_y.unwrap_or(0)
            ))),
            ComputerAction::Type { text } => Ok(ToolOutput::ok(format!(
                "Typed {} character(s).",
                text.len()
            ))),
            ComputerAction::Keypress { key } => Ok(ToolOutput::ok(format!("Pressed key '{key}'."))),
            ComputerAction::Wait { duration_ms } => {
                Ok(ToolOutput::ok(format!("Waited {duration_ms} ms.")))
            }
            ComputerAction::Observe { .. } => Ok(ToolOutput::ok(
                r#"[{"id":"@e1","role":"window","name":"Notepad"},{"id":"@e2","role":"edit","name":"Text Editor"}]"#,
            )),
            ComputerAction::ListWindows => Ok(ToolOutput::ok(
                r#"[{"handle":1001,"title":"Untitled - Notepad","process":"notepad.exe"}]"#,
            )),
            ComputerAction::FocusWindow {
                window_title,
                window_id,
            } => Ok(ToolOutput::ok(format!(
                "Focused window title: {:?}, id: {:?}.",
                window_title, window_id
            ))),
        }
    }
}

/// Unified model-facing computer tool.
pub struct ComputerTool {
    definition: ToolDefinition,
    backend: Arc<dyn ComputerBackend>,
    policy: ComputerPolicy,
}

/// Legacy wrapper preserving backwards compatibility with existing runtime call sites.
pub struct ComputerUseTool;

impl ComputerUseTool {
    /// Create a computer tool registered with the legacy name `computer_use`.
    #[must_use]
    #[expect(
        clippy::new_ret_no_self,
        reason = "Existing public legacy constructor retained for runtime consumer compatibility"
    )]
    pub fn new() -> ComputerTool {
        ComputerTool::with_name("computer_use")
    }
}

impl ComputerTool {
    /// Create a new computer tool with an explicit backend and policy.
    #[must_use]
    pub fn new_with_backend(backend: Arc<dyn ComputerBackend>, policy: ComputerPolicy) -> Self {
        Self {
            definition: build_definition("computer"),
            backend,
            policy,
        }
    }

    /// Create with a custom tool definition name (e.g. `"computer"` or `"computer_use"`).
    #[must_use]
    pub fn with_name(name: &str) -> Self {
        let mut tool = Self::auto();
        tool.definition.name = name.to_string();
        tool
    }

    /// Create with native auto-detected backend and default policy.
    #[must_use]
    pub fn new() -> Self {
        Self::auto()
    }

    /// Create with native auto-detected backend and default policy.
    #[must_use]
    pub fn auto() -> Self {
        Self::for_environment(
            ComputerEnvironment::auto_detect(),
            ComputerPolicy::default(),
        )
    }

    /// Create the backend that drives `env` on this host, under `policy`.
    ///
    /// The choice is honest about what the build can do: `Windows` maps to
    /// the in-process `aphrody-winclean` backend only when compiled for Windows,
    /// `Browser` to the shared Rust Web client, `Mock` to the deterministic test backend, and
    /// `Linux` (no X11 backend yet) or `Windows` on another host to
    /// [`UnsupportedComputerBackend`], which rejects every action.
    #[must_use]
    pub fn for_environment(env: ComputerEnvironment, policy: ComputerPolicy) -> Self {
        let backend: Arc<dyn ComputerBackend> = match env {
            #[cfg(windows)]
            ComputerEnvironment::Windows => Arc::new(WindowsComputerBackend),
            #[cfg(not(windows))]
            ComputerEnvironment::Windows => Arc::new(UnsupportedComputerBackend::new(
                env,
                "aphrody-winclean is only available when aphrody runs on Windows",
            )),
            ComputerEnvironment::Browser => Arc::new(BrowserComputerBackend),
            ComputerEnvironment::Linux => Arc::new(UnsupportedComputerBackend::new(
                env,
                "no X11 desktop backend is compiled into this build",
            )),
            #[cfg(not(target_arch = "wasm32"))]
            ComputerEnvironment::Terminal => {
                match TerminalComputerBackend::spawn_shell(None, 80, 24) {
                    Ok(backend) => Arc::new(backend),
                    Err(e) => Arc::new(UnsupportedComputerBackend::new(
                        env,
                        format!("cannot start a shell in a PTY: {e}"),
                    )),
                }
            }
            #[cfg(target_arch = "wasm32")]
            ComputerEnvironment::Terminal => Arc::new(UnsupportedComputerBackend::new(
                env,
                "terminal PTY is unavailable in WebAssembly",
            )),
            ComputerEnvironment::Wsl => Arc::new(WslComputerBackend::new(None)),
            ComputerEnvironment::RemoteWindows => Arc::new(RemoteComputerBackend::new(
                RemoteComputerTarget::omar(),
                RemoteComputerMode::WinClean,
            )),
            ComputerEnvironment::RemoteWsl => Arc::new(RemoteComputerBackend::new(
                RemoteComputerTarget::omar(),
                RemoteComputerMode::Wsl,
            )),
            ComputerEnvironment::RemoteVnc => match VncComputerBackend::new("omar", None) {
                Ok(b) => Arc::new(b),
                Err(_) => Arc::new(UnsupportedComputerBackend::new(
                    env,
                    "the declared tunnel has no VNC target for omar",
                )),
            },
            ComputerEnvironment::Mock => Arc::new(MockComputerBackend::new(env)),
        };
        Self::new_with_backend(backend, policy)
    }

    /// Create configured for any VNC server (`vnc://host:port`, tunnel member or `host[:port]`).
    ///
    /// # Errors
    ///
    /// Returns an error when the target does not resolve to an RFB endpoint.
    pub fn remote_vnc(
        target: &str,
        password: Option<String>,
        policy: ComputerPolicy,
    ) -> Result<Self, ToolError> {
        Ok(Self::new_with_backend(
            Arc::new(VncComputerBackend::new(target, password)?),
            policy,
        ))
    }

    /// Create configured for remote Windows WinClean desktop computer use on an administrator's PC.
    #[must_use]
    pub fn remote_winclean(target: RemoteComputerTarget, policy: ComputerPolicy) -> Self {
        Self::new_with_backend(
            Arc::new(RemoteComputerBackend::new(
                target,
                RemoteComputerMode::WinClean,
            )),
            policy,
        )
    }

    /// Create configured for remote WSL computer use on an administrator's PC.
    #[must_use]
    pub fn remote_wsl(target: RemoteComputerTarget, policy: ComputerPolicy) -> Self {
        Self::new_with_backend(
            Arc::new(RemoteComputerBackend::new(target, RemoteComputerMode::Wsl)),
            policy,
        )
    }

    /// Create configured for an administrator peer (e.g. "omar" at 10.200.77.10) in either WinClean or WSL mode.
    #[must_use]
    pub fn for_admin_peer(peer_name: &str, use_wsl: bool, policy: ComputerPolicy) -> Self {
        let target = RemoteComputerTarget::resolve(peer_name);
        if use_wsl {
            Self::remote_wsl(target, policy)
        } else {
            Self::remote_winclean(target, policy)
        }
    }

    /// Create configured for local WSL computer use.
    #[must_use]
    pub fn wsl(distro: Option<&str>, policy: ComputerPolicy) -> Self {
        Self::new_with_backend(Arc::new(WslComputerBackend::new(distro)), policy)
    }

    /// Create configured specifically for autonomous terminal computer use via `aphrody-term`.
    #[cfg(not(target_arch = "wasm32"))]
    #[must_use]
    pub fn terminal(
        grid: Arc<aphrody_term::FairMutex<aphrody_term::TerminalGrid>>,
        controller: Arc<aphrody_term::ComputerUseController>,
    ) -> Self {
        Self::new_with_backend(
            Arc::new(TerminalComputerBackend::new(grid, controller)),
            ComputerPolicy::default(),
        )
    }

    /// Create standalone terminal computer tool with custom grid dimensions.
    #[cfg(not(target_arch = "wasm32"))]
    #[must_use]
    pub fn terminal_standalone(cols: usize, rows: usize) -> Self {
        Self::new_with_backend(
            Arc::new(TerminalComputerBackend::standalone(cols, rows)),
            ComputerPolicy::default(),
        )
    }

    /// Create configured specifically for browser and web computer use via the shared Rust Web client.
    #[must_use]
    pub fn browser() -> Self {
        Self::new_with_backend(Arc::new(BrowserComputerBackend), ComputerPolicy::default())
    }

    /// Create the browser backend under an explicit tool name.
    ///
    /// The native backend already owns `computer` / `computer_use`, so the
    /// browser surface is registered beside it under its own name rather than
    /// replacing it. Both stay reachable in the same registry.
    #[must_use]
    pub fn browser_with_name(name: &str) -> Self {
        let mut tool = Self::browser();
        tool.definition.name = name.to_string();
        tool
    }

    /// Get current backend environment.
    #[must_use]
    pub fn environment(&self) -> ComputerEnvironment {
        self.backend.environment()
    }

    /// The autonomy policy this tool enforces.
    #[must_use]
    pub fn policy(&self) -> &ComputerPolicy {
        &self.policy
    }

    /// Expose the tool to the model under `name` (e.g. `computer_use`).
    pub fn rename(&mut self, name: &str) {
        self.definition.name = name.to_string();
    }
}

impl Default for ComputerTool {
    fn default() -> Self {
        Self::auto()
    }
}

#[async_trait::async_trait]
impl ToolExecutor for ComputerTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: Value) -> Result<ToolOutput, ToolError> {
        let action: ComputerAction =
            serde_json::from_value(arguments).map_err(|error| ToolError::InvalidArguments {
                tool: "computer".into(),
                message: error.to_string(),
            })?;

        self.backend.execute(&action, &self.policy).await
    }
}

fn build_definition(name: &str) -> ToolDefinition {
    let mut properties = BTreeMap::new();
    properties.insert(
        "action".into(),
        JsonSchema::string(Some(
            "Action to perform: 'screenshot', 'click', 'double_click', 'move', 'drag', 'scroll', \
             'type', 'keypress', 'wait', 'observe', 'list_windows', 'focus_window'."
                .into(),
        )),
    );
    properties.insert(
        "x".into(),
        JsonSchema::integer(Some("X coordinate in screen pixels.".into())),
    );
    properties.insert(
        "y".into(),
        JsonSchema::integer(Some("Y coordinate in screen pixels.".into())),
    );
    properties.insert(
        "element_id".into(),
        JsonSchema::string(Some(
            "Accessible element reference (e.g. '@e1') returned by previous 'observe' call.".into(),
        )),
    );
    properties.insert(
        "button".into(),
        JsonSchema::string(Some(
            "Mouse button: 'left', 'right', 'middle' (default 'left').".into(),
        )),
    );
    properties.insert(
        "text".into(),
        JsonSchema::string(Some("Text string for 'type' action.".into())),
    );
    properties.insert(
        "key".into(),
        JsonSchema::string(Some(
            "Key name or shortcut for 'keypress' action (e.g. 'Enter', 'ctrl+s').".into(),
        )),
    );
    properties.insert(
        "start_x".into(),
        JsonSchema::integer(Some("Drag start X coordinate.".into())),
    );
    properties.insert(
        "start_y".into(),
        JsonSchema::integer(Some("Drag start Y coordinate.".into())),
    );
    properties.insert(
        "end_x".into(),
        JsonSchema::integer(Some("Drag destination X coordinate.".into())),
    );
    properties.insert(
        "end_y".into(),
        JsonSchema::integer(Some("Drag destination Y coordinate.".into())),
    );
    properties.insert(
        "delta_x".into(),
        JsonSchema::integer(Some("Horizontal scroll offset.".into())),
    );
    properties.insert(
        "delta_y".into(),
        JsonSchema::integer(Some("Vertical scroll offset.".into())),
    );
    properties.insert(
        "direction".into(),
        JsonSchema::string(Some(
            "Scroll direction: 'up', 'down', 'left', 'right'.".into(),
        )),
    );
    properties.insert(
        "amount".into(),
        JsonSchema::integer(Some("Scroll step amount.".into())),
    );
    properties.insert(
        "duration_ms".into(),
        JsonSchema::integer(Some("Wait duration in milliseconds.".into())),
    );
    properties.insert(
        "window_title".into(),
        JsonSchema::string(Some("Window title substring for focus_window.".into())),
    );
    properties.insert(
        "window_id".into(),
        JsonSchema::integer(Some("Window handle/ID for focus_window.".into())),
    );

    ToolDefinition::new(
        name,
        "Control the computer display, keyboard, mouse, and UI automation in the active \
         environment (Windows desktop, browser, or Linux desktop). Supports dual perception: \
         returns screenshots for vision models and UI element trees for text models.",
        JsonSchema::object(
            properties,
            Some(vec!["action".into()]),
            Some(AdditionalProperties::Boolean(true)),
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_reply_parses_json_and_sse() {
        assert_eq!(
            parse_mcp_reply(r#"{"result":1}"#),
            Some(json!({"result": 1}))
        );
        let sse = "id: 0\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"ok\":true}}\n\n";
        assert_eq!(parse_mcp_reply(sse).unwrap()["result"]["ok"], json!(true));
        assert_eq!(parse_mcp_reply("  "), None);
    }

    #[test]
    fn policy_blocks_uac_prompts_deterministically() {
        let policy = ComputerPolicy::default();
        let denial = policy.verify_target("User Account Control").unwrap_err();
        assert!(denial.contains("administrative or credential prompt"));

        let denial_uac = policy.verify_target("Windows Security Prompt").unwrap_err();
        assert!(denial_uac.contains("administrative or credential prompt"));
    }

    #[test]
    fn policy_enforces_allowed_and_denied_apps() {
        let policy = ComputerPolicy {
            allowed_apps: vec!["notepad".into(), "calc".into()],
            denied_apps: vec!["terminal".into(), "regedit".into()],
        };

        // Allowed app passes
        assert!(policy.verify_target("Untitled - Notepad").is_ok());

        // Denied app rejected
        let err = policy
            .verify_target("Registry Editor - regedit")
            .unwrap_err();
        assert!(err.contains("denied_apps"));

        // App outside allowed_apps rejected
        let err2 = policy.verify_target("Paint").unwrap_err();
        assert!(err2.contains("not in allowed_apps"));
    }

    #[tokio::test]
    async fn mock_backend_returns_screenshot_with_images() {
        let backend = Arc::new(MockComputerBackend::new(ComputerEnvironment::Mock));
        let tool = ComputerTool::new_with_backend(backend, ComputerPolicy::default());

        let out = tool.handle(json!({"action": "screenshot"})).await.unwrap();
        assert!(!out.is_error);
        assert_eq!(out.images.len(), 1);
        assert_eq!(out.images[0].mime, "image/png");
        assert!(!out.images[0].data_base64.is_empty());
    }

    #[tokio::test]
    async fn mock_backend_click_and_observe() {
        let backend = Arc::new(MockComputerBackend::new(ComputerEnvironment::Mock));
        let tool = ComputerTool::new_with_backend(backend, ComputerPolicy::default());

        let click_out = tool
            .handle(json!({"action": "click", "element_id": "@e1"}))
            .await
            .unwrap();
        assert!(click_out.content.contains("@e1"));

        let obs_out = tool.handle(json!({"action": "observe"})).await.unwrap();
        assert!(obs_out.content.contains("@e1"));
    }

    #[tokio::test]
    async fn focus_window_denies_forbidden_targets() {
        let backend = Arc::new(MockComputerBackend::new(ComputerEnvironment::Mock));
        let tool = ComputerTool::new_with_backend(backend, ComputerPolicy::default());

        let out = tool
            .handle(json!({"action": "focus_window", "window_title": "Windows Security"}))
            .await
            .unwrap();
        assert!(out.is_error);
        assert!(out.content.contains("administrative or credential prompt"));
    }

    #[tokio::test]
    async fn browser_backend_constructs_and_verifies_environment() {
        let tool = ComputerTool::browser();
        assert_eq!(tool.environment(), ComputerEnvironment::Browser);
        assert_eq!(tool.definition().name, "computer");
    }

    #[tokio::test]
    #[cfg(not(target_arch = "wasm32"))]
    async fn terminal_backend_scrapes_and_rejects_input_without_pty() {
        let tool = ComputerTool::terminal_standalone(80, 24);
        assert_eq!(tool.environment(), ComputerEnvironment::Terminal);

        let snap = tool.handle(json!({"action": "screenshot"})).await.unwrap();
        assert!(!snap.is_error);
        assert!(snap.content.contains("Terminal buffer"));

        // Headless backend: no PTY, so input must fail instead of pretending to type.
        let type_out = tool
            .handle(json!({"action": "type", "text": "ls -la"}))
            .await;
        assert!(type_out.is_err());
        let key_out = tool
            .handle(json!({"action": "keypress", "key": "Enter"}))
            .await;
        assert!(key_out.is_err());

        let wait_out = tool
            .handle(json!({"action": "wait", "duration_ms": 5}))
            .await
            .unwrap();
        assert!(!wait_out.is_error);
        assert!(wait_out.content.contains("Waited 5 ms"));
    }

    #[test]
    fn remote_computer_target_resolves_omar_and_peers() {
        let omar = RemoteComputerTarget::resolve("omar");
        assert_eq!(omar.host, "10.200.77.10");
        assert_eq!(omar.port, 8793);
        assert_eq!(omar.endpoint, "http://10.200.77.10:8793/mcp");
        assert_eq!(omar.wsl_distro.as_deref(), Some("Ubuntu-24.04"));

        let omar_shortcut = RemoteComputerTarget::omar();
        assert_eq!(omar_shortcut, omar);

        let omar_tunnel = RemoteComputerTarget::resolve("omar-tunnel");
        assert_eq!(omar_tunnel.host, "127.0.0.1");
        assert_eq!(omar_tunnel.port, 18793);
        assert_eq!(omar_tunnel.endpoint, "http://127.0.0.1:18793/mcp");

        let owner = RemoteComputerTarget::resolve("aphro-pc");
        assert_eq!(owner.host, "10.200.77.4");
        assert_eq!(owner.member.as_deref(), Some("aphro-pc"));
        assert_eq!(omar.member.as_deref(), Some("omar"));

        let custom = RemoteComputerTarget::resolve("192.168.1.50:9000");
        assert_eq!(custom.host, "192.168.1.50");
        assert_eq!(custom.port, 9000);
        assert_eq!(custom.endpoint, "http://192.168.1.50:9000/mcp");
    }

    #[test]
    fn vnc_backend_resolves_targets_and_reports_failures() {
        let tool = ComputerTool::remote_vnc("omar", None, ComputerPolicy::default()).unwrap();
        assert_eq!(tool.environment(), ComputerEnvironment::RemoteVnc);
        let backend = VncComputerBackend::new("omar", None).unwrap();
        assert_eq!(backend.url(), "vnc://10.200.77.10:5900");
        assert!(VncComputerBackend::new("http://10.200.77.10:8793", None).is_err());
        assert_eq!(scroll_deltas(None, None, Some("up"), None), (0, -120));
        assert_eq!(
            scroll_deltas(Some(240), Some(-360), Some("up"), None),
            (240, -360)
        );
        assert_eq!(scroll_deltas(None, None, Some("right"), Some(3)), (3, 0));
    }

    #[tokio::test]
    async fn vnc_backend_errors_when_server_is_absent() {
        let backend = VncComputerBackend::new("vnc://127.0.0.1:9", Some("x".into())).unwrap();
        let err = backend
            .execute(&ComputerAction::Screenshot, &ComputerPolicy::default())
            .await
            .unwrap_err();
        assert!(err.to_string().contains("vnc://127.0.0.1:9"), "{err}");
    }

    #[test]
    fn admin_peer_tool_construction() {
        let winclean_tool = ComputerTool::for_admin_peer("omar", false, ComputerPolicy::default());
        assert_eq!(
            winclean_tool.environment(),
            ComputerEnvironment::RemoteWindows
        );

        let wsl_tool = ComputerTool::for_admin_peer("omar", true, ComputerPolicy::default());
        assert_eq!(wsl_tool.environment(), ComputerEnvironment::RemoteWsl);

        let local_wsl = ComputerTool::wsl(Some("Ubuntu-24.04"), ComputerPolicy::default());
        assert_eq!(local_wsl.environment(), ComputerEnvironment::Wsl);
    }

    #[tokio::test]
    async fn remote_computer_backend_executes_actions_over_mock_http() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        // Spawn mock streamable HTTP MCP server: initialize, notifications, tools/call
        tokio::spawn(async move {
            loop {
                if let Ok((mut socket, _)) = listener.accept().await {
                    let mut buf = vec![0u8; 4096];
                    let n = socket.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);

                    // Every request must present the loopback Host the remote MCP listens on,
                    // not the mesh address, or rmcp's DNS-rebinding guard would reject it.
                    assert!(
                        req.to_ascii_lowercase().contains("host: localhost"),
                        "request must carry `Host: localhost`, got headers: {req}"
                    );

                    if req.contains("notifications/initialized") {
                        let _ = socket
                            .write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                            .await;
                        continue;
                    }
                    let initialize = req.contains("\"initialize\"");
                    let session = if initialize {
                        "Mcp-Session-Id: mock-session\r\n"
                    } else {
                        assert!(
                            req.to_ascii_lowercase()
                                .contains("mcp-session-id: mock-session")
                        );
                        ""
                    };
                    let body = if initialize {
                        r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"mock","version":"1"}}}"#
                    } else if req.contains("computer_capture_screen") {
                        r#"{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"image","mimeType":"image/png","data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="}],"isError":false}}"#
                    } else if req.contains("wsl_execute") {
                        r#"{"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"Success":true,"ExitCode":0,"Stdout":"Linux omar-wsl 6.6.36.6-microsoft-standard-WSL2\n","Stderr":""},"isError":false}}"#
                    } else {
                        r#"{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Remote click acknowledged"}],"isError":false}}"#
                    };

                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n{session}Connection: close\r\nContent-Length: {}\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = socket.write_all(response.as_bytes()).await;
                }
            }
        });

        let target = RemoteComputerTarget {
            host: addr.ip().to_string(),
            port: addr.port(),
            endpoint: format!("http://{addr}/mcp"),
            auth_token: None,
            wsl_distro: Some("Ubuntu-24.04".to_string()),
            member: None,
        };

        // 1. WinClean screenshot
        let win_tool = ComputerTool::remote_winclean(target.clone(), ComputerPolicy::default());
        let snap_out = win_tool
            .handle(json!({"action": "screenshot"}))
            .await
            .unwrap();
        assert!(!snap_out.is_error);
        assert_eq!(snap_out.images.len(), 1);
        assert_eq!(snap_out.images[0].mime, "image/png");

        // 2. WSL command execution
        let wsl_tool = ComputerTool::remote_wsl(target.clone(), ComputerPolicy::default());
        let exec_out = wsl_tool
            .handle(json!({"action": "type", "text": "uname -a"}))
            .await
            .unwrap();
        assert!(!exec_out.is_error);
        assert!(exec_out.content.contains("Linux omar-wsl"));

        // 3. WinClean click
        let click_out = win_tool
            .handle(json!({"action": "click", "x": 150, "y": 250}))
            .await
            .unwrap();
        assert!(!click_out.is_error);
        assert!(click_out.content.contains("Remote click acknowledged"));
    }
}

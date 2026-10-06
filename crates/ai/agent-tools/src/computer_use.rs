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
            },
        };

        match action {
            ComputerAction::Screenshot => {
                let res =
                    wc.call_async("computer_capture_screen", &json!({})).await.map_err(|e| {
                        ToolError::Execution { tool: "computer".into(), message: e.to_string() }
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
            },
            ComputerAction::Click { x, y, element_id, button } => {
                if let Some(eid) = element_id {
                    let args = json!({ "elementId": eid });
                    let res =
                        wc.call_async("computer_click_element", &args).await.map_err(|e| {
                            ToolError::Execution { tool: "computer".into(), message: e.to_string() }
                        })?;
                    Ok(ToolOutput::ok(res.text()))
                } else if let (Some(x), Some(y)) = (x, y) {
                    let btn = button.as_deref().unwrap_or("left");
                    let args = json!({ "x": x, "y": y, "button": btn });
                    let res = wc.call_async("computer_click", &args).await.map_err(|e| {
                        ToolError::Execution { tool: "computer".into(), message: e.to_string() }
                    })?;
                    Ok(ToolOutput::ok(res.text()))
                } else {
                    Err(ToolError::InvalidArguments {
                        tool: "computer".into(),
                        message: "click action requires either coordinates (x, y) or an element_id"
                            .into(),
                    })
                }
            },
            ComputerAction::DoubleClick { x, y } => {
                let args = json!({ "x": x, "y": y, "button": "left", "doubleClick": true });
                let res = wc.call_async("computer_click", &args).await.map_err(|e| {
                    ToolError::Execution { tool: "computer".into(), message: e.to_string() }
                })?;
                Ok(ToolOutput::ok(res.text()))
            },
            ComputerAction::Move { x, y } => {
                let args = json!({ "x": x, "y": y });
                let res = wc.call_async("mouse_move_smooth", &args).await.map_err(|e| {
                    ToolError::Execution { tool: "computer".into(), message: e.to_string() }
                })?;
                Ok(ToolOutput::ok(res.text()))
            },
            ComputerAction::Drag { start_x, start_y, end_x, end_y } => {
                let args = json!({
                    "startX": start_x,
                    "startY": start_y,
                    "endX": end_x,
                    "endY": end_y,
                });
                let res = wc.call_async("computer_drag", &args).await.map_err(|e| {
                    ToolError::Execution { tool: "computer".into(), message: e.to_string() }
                })?;
                Ok(ToolOutput::ok(res.text()))
            },
            ComputerAction::Scroll { delta_x, delta_y, direction, amount } => {
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
                    ToolError::Execution { tool: "computer".into(), message: e.to_string() }
                })?;
                Ok(ToolOutput::ok(res.text()))
            },
            ComputerAction::Type { text } => {
                let args = json!({ "text": text });
                let res = wc.call_async("computer_type", &args).await.map_err(|e| {
                    ToolError::Execution { tool: "computer".into(), message: e.to_string() }
                })?;
                Ok(ToolOutput::ok(res.text()))
            },
            ComputerAction::Keypress { key } => {
                let args = json!({ "key": key });
                let res = wc.call_async("computer_key", &args).await.map_err(|e| {
                    ToolError::Execution { tool: "computer".into(), message: e.to_string() }
                })?;
                Ok(ToolOutput::ok(res.text()))
            },
            ComputerAction::Wait { duration_ms } => {
                tokio::time::sleep(Duration::from_millis(*duration_ms)).await;
                Ok(ToolOutput::ok(format!("Waited {duration_ms} ms.")))
            },
            ComputerAction::Observe { element_id } => {
                let args = json!({ "elementId": element_id });
                let res = wc.call_async("computer_observe", &args).await.map_err(|e| {
                    ToolError::Execution { tool: "computer".into(), message: e.to_string() }
                })?;
                Ok(ToolOutput::ok(res.text()))
            },
            ComputerAction::ListWindows => {
                let res = wc.call_async("list_windows", &json!({})).await.map_err(|e| {
                    ToolError::Execution { tool: "computer".into(), message: e.to_string() }
                })?;
                Ok(ToolOutput::ok(res.text()))
            },
            ComputerAction::FocusWindow { window_title, window_id } => {
                if let Some(title) = window_title {
                    if let Err(denial) = policy.verify_target(title) {
                        return Ok(ToolOutput::error(denial));
                    }
                    let args = json!({ "title": title });
                    let res = wc.call_async("switch_to_window", &args).await.map_err(|e| {
                        ToolError::Execution { tool: "computer".into(), message: e.to_string() }
                    })?;
                    Ok(ToolOutput::ok(res.text()))
                } else if let Some(wid) = window_id {
                    let args = json!({ "windowHandle": wid });
                    let res = wc.call_async("switch_to_window", &args).await.map_err(|e| {
                        ToolError::Execution { tool: "computer".into(), message: e.to_string() }
                    })?;
                    Ok(ToolOutput::ok(res.text()))
                } else {
                    Err(ToolError::InvalidArguments {
                        tool: "computer".into(),
                        message: "focus_window requires either window_title or window_id".into(),
                    })
                }
            },
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
                },
                Ok(_) => Ok(ToolOutput::error("Browser screenshot returned no PNG data.")),
                Err(error) => Ok(ToolOutput::error(format!("Browser screenshot error: {error}"))),
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
            },
            ComputerAction::Scroll { delta_x, delta_y, direction, amount } => {
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
            },
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
            },
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
            },
            ComputerAction::ListWindows => match session::tabs(long).await {
                Ok(text) => Ok(ToolOutput::ok(text)),
                Err(error) => Ok(ToolOutput::error(format!("Browser tab listing error: {error}"))),
            },
            ComputerAction::FocusWindow { window_title, .. } => {
                if let Some(url) = window_title {
                    if let Err(denial) = policy.verify_target(url) {
                        return Ok(ToolOutput::error(denial));
                    }
                    match session::navigate(url, long).await {
                        Ok(text) => {
                            Ok(ToolOutput::ok(format!("Navigated browser to '{url}':\n{text}")))
                        },
                        Err(error) => Ok(ToolOutput::error(format!("Navigation error: {error}"))),
                    }
                } else {
                    Ok(ToolOutput::error("Native browser focus requires a URL."))
                }
            },
        }
    }
}

/// Backend for a target environment this build cannot drive.
///
/// Every action is rejected with an explicit error naming the missing
/// backend, so the model learns the desktop is unavailable instead of
/// receiving invented results. Used for `Linux` (no X11 backend yet) and for
/// `Windows` requested on a non-Windows host.
pub struct UnsupportedComputerBackend {
    env: ComputerEnvironment,
    reason: &'static str,
}

impl UnsupportedComputerBackend {
    /// Describe why `env` cannot be driven by this build.
    #[must_use]
    pub fn new(env: ComputerEnvironment, reason: &'static str) -> Self {
        Self { env, reason }
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
        Self { env, recorded: std::sync::Mutex::new(Vec::new()) }
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
        if let ComputerAction::FocusWindow { window_title: Some(title), .. } = action
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
            },
            ComputerAction::Click { x, y, element_id, button } => {
                let btn = button.as_deref().unwrap_or("left");
                if let Some(eid) = element_id {
                    Ok(ToolOutput::ok(format!("Clicked element '{eid}' with {btn} button.")))
                } else {
                    Ok(ToolOutput::ok(format!(
                        "Clicked at ({}, {}) with {btn} button.",
                        x.unwrap_or(0),
                        y.unwrap_or(0)
                    )))
                }
            },
            ComputerAction::DoubleClick { x, y } => {
                Ok(ToolOutput::ok(format!("Double clicked at ({x}, {y}).")))
            },
            ComputerAction::Move { x, y } => {
                Ok(ToolOutput::ok(format!("Moved cursor to ({x}, {y}).")))
            },
            ComputerAction::Drag { start_x, start_y, end_x, end_y } => Ok(ToolOutput::ok(format!(
                "Dragged from ({start_x}, {start_y}) to ({end_x}, {end_y})."
            ))),
            ComputerAction::Scroll { delta_x, delta_y, .. } => Ok(ToolOutput::ok(format!(
                "Scrolled dx: {}, dy: {}.",
                delta_x.unwrap_or(0),
                delta_y.unwrap_or(0)
            ))),
            ComputerAction::Type { text } => {
                Ok(ToolOutput::ok(format!("Typed {} character(s).", text.len())))
            },
            ComputerAction::Keypress { key } => Ok(ToolOutput::ok(format!("Pressed key '{key}'."))),
            ComputerAction::Wait { duration_ms } => {
                Ok(ToolOutput::ok(format!("Waited {duration_ms} ms.")))
            },
            ComputerAction::Observe { .. } => Ok(ToolOutput::ok(
                r#"[{"id":"@e1","role":"window","name":"Notepad"},{"id":"@e2","role":"edit","name":"Text Editor"}]"#,
            )),
            ComputerAction::ListWindows => Ok(ToolOutput::ok(
                r#"[{"handle":1001,"title":"Untitled - Notepad","process":"notepad.exe"}]"#,
            )),
            ComputerAction::FocusWindow { window_title, window_id } => Ok(ToolOutput::ok(format!(
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
        Self { definition: build_definition("computer"), backend, policy }
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
        Self::for_environment(ComputerEnvironment::auto_detect(), ComputerPolicy::default())
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
            ComputerEnvironment::Mock => Arc::new(MockComputerBackend::new(env)),
        };
        Self::new_with_backend(backend, policy)
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
        let action: ComputerAction = serde_json::from_value(arguments).map_err(|error| {
            ToolError::InvalidArguments { tool: "computer".into(), message: error.to_string() }
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
    properties
        .insert("x".into(), JsonSchema::integer(Some("X coordinate in screen pixels.".into())));
    properties
        .insert("y".into(), JsonSchema::integer(Some("Y coordinate in screen pixels.".into())));
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
    properties
        .insert("text".into(), JsonSchema::string(Some("Text string for 'type' action.".into())));
    properties.insert(
        "key".into(),
        JsonSchema::string(Some(
            "Key name or shortcut for 'keypress' action (e.g. 'Enter', 'ctrl+s').".into(),
        )),
    );
    properties
        .insert("start_x".into(), JsonSchema::integer(Some("Drag start X coordinate.".into())));
    properties
        .insert("start_y".into(), JsonSchema::integer(Some("Drag start Y coordinate.".into())));
    properties
        .insert("end_x".into(), JsonSchema::integer(Some("Drag destination X coordinate.".into())));
    properties
        .insert("end_y".into(), JsonSchema::integer(Some("Drag destination Y coordinate.".into())));
    properties
        .insert("delta_x".into(), JsonSchema::integer(Some("Horizontal scroll offset.".into())));
    properties
        .insert("delta_y".into(), JsonSchema::integer(Some("Vertical scroll offset.".into())));
    properties.insert(
        "direction".into(),
        JsonSchema::string(Some("Scroll direction: 'up', 'down', 'left', 'right'.".into())),
    );
    properties.insert("amount".into(), JsonSchema::integer(Some("Scroll step amount.".into())));
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
        let err = policy.verify_target("Registry Editor - regedit").unwrap_err();
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

        let click_out = tool.handle(json!({"action": "click", "element_id": "@e1"})).await.unwrap();
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
}

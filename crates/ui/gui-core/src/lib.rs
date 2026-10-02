// SPDX-License-Identifier: Apache-2.0
//! Neutral GUI abstractions for Aphrody OS.
//!
//! Provides toolkit-agnostic traits and types for window management, surface
//! provisioning, Material Design 3 theme consumption, and kernel bridging:
//! - [`WindowHost`]: window lifecycle, bounds, state, titles and capabilities.
//! - [`SurfaceProvider`]: presenting swapchain surfaces (raw window handle, host GPU, or CPU raster).
//! - [`ThemeProvider`]: reading and subscribing to M3 color roles and theme mode.
//! - [`KernelBridge`]: dispatching tool calls and bus events to the Aphrody OS kernel.

#![forbid(unsafe_code)]
#![deny(missing_docs)]

use async_trait::async_trait;
use raw_window_handle::{HasDisplayHandle, HasWindowHandle};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

// ── Window Types ─────────────────────────────────────────────────────────────

/// State of a desktop window.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WindowState {
    /// The window is minimized / iconified to the dock or taskbar.
    Minimized,
    /// The window is maximized across the active display work area.
    Maximized,
    /// The window is restored to standard floating bounds.
    Normal,
    /// The window is hidden from view.
    Hidden,
    /// The window is shown and visible.
    Shown,
}

impl WindowState {
    /// Return the canonical string identifier for the state.
    #[must_use]
    pub const fn as_str(&self) -> &'static str {
        match self {
            Self::Minimized => "minimized",
            Self::Maximized => "maximized",
            Self::Normal => "normal",
            Self::Hidden => "hidden",
            Self::Shown => "shown",
        }
    }
}

impl std::fmt::Display for WindowState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Physical pixel position and dimensions of a window.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowBounds {
    /// X coordinate in physical screen pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<i32>,
    /// Y coordinate in physical screen pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<i32>,
    /// Width in physical screen pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// Height in physical screen pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

impl WindowBounds {
    /// Construct empty bounds where no properties are specified.
    #[must_use]
    pub const fn empty() -> Self {
        Self { x: None, y: None, width: None, height: None }
    }

    /// Construct bounds with explicit size.
    #[must_use]
    pub const fn from_size(width: u32, height: u32) -> Self {
        Self { x: None, y: None, width: Some(width), height: Some(height) }
    }

    /// Construct bounds with explicit position and size.
    #[must_use]
    pub const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self { x: Some(x), y: Some(y), width: Some(width), height: Some(height) }
    }
}

/// Specification for creating or opening a window.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowSpec {
    /// Unique identifier for the window.
    pub label: String,
    /// Target URL or route if this window hosts web or remote content.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Display title for the window titlebar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Initial physical bounds (position and size).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bounds: Option<WindowBounds>,
    /// Whether the window background should support transparency.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transparent: Option<bool>,
    /// Whether the window should remain pinned on top of other windows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub always_on_top: Option<bool>,
}

impl WindowSpec {
    /// Create a new window specification with a unique label.
    pub fn new(label: impl Into<String>) -> Self {
        Self { label: label.into(), ..Default::default() }
    }

    /// Set window URL.
    #[must_use]
    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }

    /// Set window title.
    #[must_use]
    pub fn with_title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// Set window bounds.
    #[must_use]
    pub fn with_bounds(mut self, bounds: WindowBounds) -> Self {
        self.bounds = Some(bounds);
        self
    }
}

/// Metadata snapshot of an active window.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowInfo {
    /// Unique label of the window.
    pub label: String,
    /// Current window title.
    pub title: String,
    /// Current URL or content location.
    #[serde(default)]
    pub url: String,
    /// Whether the window is visible.
    #[serde(default)]
    pub visible: bool,
    /// Whether the window currently has input focus.
    #[serde(default)]
    pub focused: bool,
    /// Whether the window is minimized.
    #[serde(default)]
    pub minimized: bool,
    /// Whether the window is maximized.
    #[serde(default)]
    pub maximized: bool,
    /// Physical X position on screen, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<i32>,
    /// Physical Y position on screen, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<i32>,
    /// Physical width in pixels, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// Physical height in pixels, if available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
}

impl WindowInfo {
    /// Retrieve the current bounds from the window info snapshot.
    #[must_use]
    pub const fn bounds(&self) -> WindowBounds {
        WindowBounds { x: self.x, y: self.y, width: self.width, height: self.height }
    }
}

/// Capabilities exposed by a window host.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowCaps {
    /// Whether the host can render embedded webview content.
    pub webview: bool,
    /// Whether the host supports multiple windows simultaneously.
    pub multi_window: bool,
    /// Whether the host supports transparent windows / surfaces.
    pub transparent: bool,
    /// Whether the host supports pinning windows always-on-top.
    pub always_on_top: bool,
    /// Whether the host can present a 3D/GPU surface underneath UI content.
    pub surface_under_content: bool,
}

// ── WindowHost Trait ─────────────────────────────────────────────────────────

/// Neutral trait for window management across GUI toolkits.
#[async_trait]
pub trait WindowHost: Send + Sync {
    /// List all open windows and their current metadata.
    async fn list(&self) -> Result<Vec<WindowInfo>, String>;

    /// Open a new window according to `spec` (or show/focus if already open).
    async fn open(&self, spec: WindowSpec) -> Result<WindowInfo, String>;

    /// Focus, unminimize and bring a window to front.
    async fn focus(&self, label: &str) -> Result<WindowInfo, String>;

    /// Close a window by label.
    async fn close(&self, label: &str) -> Result<(), String>;

    /// Adjust position and/or size of a window.
    async fn set_bounds(&self, label: &str, bounds: WindowBounds) -> Result<WindowInfo, String>;

    /// Change a window's state (minimized, maximized, normal, hidden, shown).
    async fn set_state(&self, label: &str, state: WindowState) -> Result<WindowInfo, String>;

    /// Change a window's title.
    async fn set_title(&self, label: &str, title: &str) -> Result<WindowInfo, String>;

    /// Describe the current state of a window by label.
    async fn describe(&self, label: &str) -> Result<WindowInfo, String> {
        let windows = self.list().await?;
        windows
            .into_iter()
            .find(|w| w.label == label)
            .ok_or_else(|| format!("no window labelled `{label}`"))
    }

    /// Query the capabilities supported by this window host implementation.
    fn capabilities(&self) -> WindowCaps {
        WindowCaps::default()
    }
}

// ── Surface Provisioning ─────────────────────────────────────────────────────

/// Supertrait combining raw window and display handles in a thread-safe handle provider.
pub trait HasWindowAndDisplayHandle: HasWindowHandle + HasDisplayHandle + Send + Sync {}

impl<T> HasWindowAndDisplayHandle for T where
    T: HasWindowHandle + HasDisplayHandle + Send + Sync + ?Sized
{
}

/// Target representation where graphical rendering can occur.
pub enum SurfaceTarget {
    /// Raw OS window with display and window handles for direct swapchain presentation.
    RawWindow(Arc<dyn HasWindowAndDisplayHandle>),
    /// Offscreen host GPU texture descriptor for shared device rendering.
    HostGpu {
        /// Width in physical pixels.
        width: u32,
        /// Height in physical pixels.
        height: u32,
        /// Texture pixel format name (e.g., `"Rgba8Unorm"`, `"Bgra8Unorm"`).
        format: String,
    },
    /// In-memory RGBA8 CPU pixel buffer.
    CpuImage {
        /// Width in pixels.
        width: u32,
        /// Height in pixels.
        height: u32,
        /// Raw pixel bytes in straight RGBA8 layout.
        rgba: Vec<u8>,
    },
}

impl std::fmt::Debug for SurfaceTarget {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RawWindow(_) => f.debug_tuple("RawWindow").finish_non_exhaustive(),
            Self::HostGpu { width, height, format } => f
                .debug_struct("HostGpu")
                .field("width", width)
                .field("height", height)
                .field("format", format)
                .finish(),
            Self::CpuImage { width, height, rgba } => f
                .debug_struct("CpuImage")
                .field("width", width)
                .field("height", height)
                .field("rgba_len", &rgba.len())
                .finish(),
        }
    }
}

impl SurfaceTarget {
    /// Construct a raw window surface target from a handle provider.
    pub fn raw_window<T: HasWindowAndDisplayHandle + 'static>(target: Arc<T>) -> Self {
        Self::RawWindow(target)
    }

    /// Construct a host GPU texture surface target.
    pub fn host_gpu(width: u32, height: u32, format: impl Into<String>) -> Self {
        Self::HostGpu { width, height, format: format.into() }
    }

    /// Construct a CPU image surface target.
    #[must_use]
    pub fn cpu_image(width: u32, height: u32, rgba: Vec<u8>) -> Self {
        Self::CpuImage { width, height, rgba }
    }
}

/// Neutral trait providing graphical rendering surface targets for windows.
pub trait SurfaceProvider: Send + Sync {
    /// Retrieve the surface presentation target for a window identified by `label`.
    fn surface_target(&self, label: &str) -> Option<SurfaceTarget>;
}

// ── Theme Provisioning ───────────────────────────────────────────────────────

/// Material Design 3 color roles serializable DTO.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColorRolesDto {
    /// Key brand color.
    pub primary: u32,
    /// Contrast color on primary.
    pub on_primary: u32,
    /// Container tinted with primary.
    pub primary_container: u32,
    /// Contrast color on primary container.
    pub on_primary_container: u32,
    /// Accent color.
    pub secondary: u32,
    /// Contrast color on secondary.
    pub on_secondary: u32,
    /// Container tinted with secondary.
    pub secondary_container: u32,
    /// Contrast color on secondary container.
    pub on_secondary_container: u32,
    /// Tertiary accent color.
    pub tertiary: u32,
    /// Contrast color on tertiary.
    pub on_tertiary: u32,
    /// Container tinted with tertiary.
    pub tertiary_container: u32,
    /// Contrast color on tertiary container.
    pub on_tertiary_container: u32,
    /// Error state color.
    pub error: u32,
    /// Contrast color on error.
    pub on_error: u32,
    /// Container for error states.
    pub error_container: u32,
    /// Contrast color on error container.
    pub on_error_container: u32,
    /// App background.
    pub background: u32,
    /// Contrast color on background.
    pub on_background: u32,
    /// Surface base color.
    pub surface: u32,
    /// Contrast color on surface.
    pub on_surface: u32,
    /// Variant surface color.
    pub surface_variant: u32,
    /// Contrast color on surface variant.
    pub on_surface_variant: u32,
    /// Outline boundary color.
    pub outline: u32,
    /// Subtle outline variant.
    pub outline_variant: u32,
    /// Shadow color.
    pub shadow: u32,
    /// Scrim overlay color.
    pub scrim: u32,
    /// Inverse surface.
    pub inverse_surface: u32,
    /// Contrast color on inverse surface.
    pub inverse_on_surface: u32,
    /// Inverse primary.
    pub inverse_primary: u32,
    /// Dimmed surface.
    pub surface_dim: u32,
    /// Brightened surface.
    pub surface_bright: u32,
    /// Surface container lowest.
    pub surface_container_lowest: u32,
    /// Surface container low.
    pub surface_container_low: u32,
    /// Standard surface container.
    pub surface_container: u32,
    /// Surface container high.
    pub surface_container_high: u32,
    /// Surface container highest.
    pub surface_container_highest: u32,
}

impl From<aphrody_m3_tokens::color::ColorRoles> for ColorRolesDto {
    fn from(r: aphrody_m3_tokens::color::ColorRoles) -> Self {
        Self {
            primary: r.primary,
            on_primary: r.on_primary,
            primary_container: r.primary_container,
            on_primary_container: r.on_primary_container,
            secondary: r.secondary,
            on_secondary: r.on_secondary,
            secondary_container: r.secondary_container,
            on_secondary_container: r.on_secondary_container,
            tertiary: r.tertiary,
            on_tertiary: r.on_tertiary,
            tertiary_container: r.tertiary_container,
            on_tertiary_container: r.on_tertiary_container,
            error: r.error,
            on_error: r.on_error,
            error_container: r.error_container,
            on_error_container: r.on_error_container,
            background: r.background,
            on_background: r.on_background,
            surface: r.surface,
            on_surface: r.on_surface,
            surface_variant: r.surface_variant,
            on_surface_variant: r.on_surface_variant,
            outline: r.outline,
            outline_variant: r.outline_variant,
            shadow: r.shadow,
            scrim: r.scrim,
            inverse_surface: r.inverse_surface,
            inverse_on_surface: r.inverse_on_surface,
            inverse_primary: r.inverse_primary,
            surface_dim: r.surface_dim,
            surface_bright: r.surface_bright,
            surface_container_lowest: r.surface_container_lowest,
            surface_container_low: r.surface_container_low,
            surface_container: r.surface_container,
            surface_container_high: r.surface_container_high,
            surface_container_highest: r.surface_container_highest,
        }
    }
}

impl From<ColorRolesDto> for aphrody_m3_tokens::color::ColorRoles {
    fn from(r: ColorRolesDto) -> Self {
        Self {
            primary: r.primary,
            on_primary: r.on_primary,
            primary_container: r.primary_container,
            on_primary_container: r.on_primary_container,
            secondary: r.secondary,
            on_secondary: r.on_secondary,
            secondary_container: r.secondary_container,
            on_secondary_container: r.on_secondary_container,
            tertiary: r.tertiary,
            on_tertiary: r.on_tertiary,
            tertiary_container: r.tertiary_container,
            on_tertiary_container: r.on_tertiary_container,
            error: r.error,
            on_error: r.on_error,
            error_container: r.error_container,
            on_error_container: r.on_error_container,
            background: r.background,
            on_background: r.on_background,
            surface: r.surface,
            on_surface: r.on_surface,
            surface_variant: r.surface_variant,
            on_surface_variant: r.on_surface_variant,
            outline: r.outline,
            outline_variant: r.outline_variant,
            shadow: r.shadow,
            scrim: r.scrim,
            inverse_surface: r.inverse_surface,
            inverse_on_surface: r.inverse_on_surface,
            inverse_primary: r.inverse_primary,
            surface_dim: r.surface_dim,
            surface_bright: r.surface_bright,
            surface_container_lowest: r.surface_container_lowest,
            surface_container_low: r.surface_container_low,
            surface_container: r.surface_container,
            surface_container_high: r.surface_container_high,
            surface_container_highest: r.surface_container_highest,
        }
    }
}

/// Preferred theme mode.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThemeMode {
    /// Follow system/desktop environment preferences.
    #[default]
    System,
    /// Force light color scheme.
    Light,
    /// Force dark color scheme.
    Dark,
    /// High-contrast scheme for accessibility.
    HighContrast,
}

impl From<aphrody_m3_tokens::facade::platform::ThemeMode> for ThemeMode {
    fn from(mode: aphrody_m3_tokens::facade::platform::ThemeMode) -> Self {
        match mode {
            aphrody_m3_tokens::facade::platform::ThemeMode::System => Self::System,
            aphrody_m3_tokens::facade::platform::ThemeMode::Light => Self::Light,
            aphrody_m3_tokens::facade::platform::ThemeMode::Dark => Self::Dark,
            aphrody_m3_tokens::facade::platform::ThemeMode::HighContrast => Self::HighContrast,
        }
    }
}

impl From<ThemeMode> for aphrody_m3_tokens::facade::platform::ThemeMode {
    fn from(mode: ThemeMode) -> Self {
        match mode {
            ThemeMode::System => Self::System,
            ThemeMode::Light => Self::Light,
            ThemeMode::Dark => Self::Dark,
            ThemeMode::HighContrast => Self::HighContrast,
        }
    }
}

/// Serializable snapshot of the Material Design 3 theme.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ThemeSnapshot {
    /// Active 36 M3 color roles.
    pub roles: ColorRolesDto,
    /// Active theme mode.
    pub mode: ThemeMode,
    /// Whether the current active scheme is dark mode.
    pub is_dark: bool,
    /// Contrast factor (where 0.0 is standard, -1.0 is reduced, 1.0 is high contrast).
    pub contrast: f32,
}

impl Default for ThemeSnapshot {
    fn default() -> Self {
        Self {
            roles: ColorRolesDto::from(aphrody_m3_tokens::color::BASELINE),
            mode: ThemeMode::System,
            is_dark: false,
            contrast: 0.0,
        }
    }
}

impl ThemeSnapshot {
    /// Get the M3 tokens [`aphrody_m3_tokens::color::ColorRoles`] for this snapshot.
    #[must_use]
    pub fn color_roles(&self) -> aphrody_m3_tokens::color::ColorRoles {
        self.roles.into()
    }
}

/// Trait for reading and subscribing to M3 theme snapshots.
pub trait ThemeProvider: Send + Sync {
    /// Read the current M3 theme snapshot.
    fn snapshot(&self) -> ThemeSnapshot;

    /// Return whether the current theme is dark mode.
    fn is_dark(&self) -> bool {
        self.snapshot().is_dark
    }

    /// Subscribe to theme changes with a callback. Returns a subscription ID.
    fn subscribe(
        &self,
        callback: Box<dyn Fn(ThemeSnapshot) + Send + Sync + 'static>,
    ) -> Result<u64, String> {
        let _ = callback;
        Ok(0)
    }

    /// Unsubscribe a previously registered callback.
    fn unsubscribe(&self, subscription_id: u64) -> Result<(), String> {
        let _ = subscription_id;
        Ok(())
    }
}

// ── Kernel Bridge ────────────────────────────────────────────────────────────

/// Neutral trait bridging tool calls and events to the Aphrody OS kernel.
#[async_trait]
pub trait KernelBridge: Send + Sync {
    /// Invoke a tool on the Aphrody OS kernel.
    async fn call_tool(
        &self,
        tool: &str,
        arguments: serde_json::Value,
    ) -> Result<serde_json::Value, String>;

    /// Emit an event onto the Aphrody OS kernel bus.
    async fn emit_event(&self, topic: &str, payload: serde_json::Value) -> Result<(), String>;

    /// Check if the bridge is currently connected to the kernel.
    async fn is_connected(&self) -> bool {
        true
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn window_state_serialization() {
        let states = [
            (WindowState::Minimized, "\"minimized\""),
            (WindowState::Maximized, "\"maximized\""),
            (WindowState::Normal, "\"normal\""),
            (WindowState::Hidden, "\"hidden\""),
            (WindowState::Shown, "\"shown\""),
        ];
        for (state, expected_json) in states {
            let serialized = serde_json::to_string(&state).unwrap();
            assert_eq!(serialized, expected_json);
            let deserialized: WindowState = serde_json::from_str(&serialized).unwrap();
            assert_eq!(deserialized, state);
            assert_eq!(state.as_str(), deserialized.as_str());
        }
    }

    #[test]
    fn window_bounds_helpers_and_serialization() {
        let bounds = WindowBounds::new(100, 200, 800, 600);
        let val = serde_json::to_value(bounds).unwrap();
        assert_eq!(val["x"], 100);
        assert_eq!(val["y"], 200);
        assert_eq!(val["width"], 800);
        assert_eq!(val["height"], 600);

        let from_size = WindowBounds::from_size(1024, 768);
        assert_eq!(from_size.x, None);
        assert_eq!(from_size.y, None);
        assert_eq!(from_size.width, Some(1024));
        assert_eq!(from_size.height, Some(768));
    }

    #[test]
    fn window_spec_builder_and_serialization() {
        let spec = WindowSpec::new("main")
            .with_url("https://aphrody.internal")
            .with_title("Aphrody Shell")
            .with_bounds(WindowBounds::from_size(1200, 800));

        let val = serde_json::to_value(&spec).unwrap();
        assert_eq!(val["label"], "main");
        assert_eq!(val["url"], "https://aphrody.internal");
        assert_eq!(val["title"], "Aphrody Shell");
        assert_eq!(val["bounds"]["width"], 1200);
        assert_eq!(val["bounds"]["height"], 800);
    }

    #[test]
    fn window_info_serialization_matches_describe_schema() {
        let info = WindowInfo {
            label: "preview".into(),
            title: "Preview Window".into(),
            url: "https://example.com".into(),
            visible: true,
            focused: true,
            minimized: false,
            maximized: false,
            x: Some(10),
            y: Some(20),
            width: Some(640),
            height: Some(480),
        };

        let val = serde_json::to_value(&info).unwrap();
        assert_eq!(val["label"], "preview");
        assert_eq!(val["title"], "Preview Window");
        assert_eq!(val["url"], "https://example.com");
        assert_eq!(val["visible"], true);
        assert_eq!(val["focused"], true);
        assert_eq!(val["minimized"], false);
        assert_eq!(val["maximized"], false);
        assert_eq!(val["x"], 10);
        assert_eq!(val["y"], 20);
        assert_eq!(val["width"], 640);
        assert_eq!(val["height"], 480);

        let bounds = info.bounds();
        assert_eq!(bounds.x, Some(10));
        assert_eq!(bounds.width, Some(640));
    }

    #[test]
    fn window_caps_default() {
        let caps = WindowCaps::default();
        assert!(!caps.webview);
        assert!(!caps.multi_window);
        assert!(!caps.transparent);
        assert!(!caps.always_on_top);
        assert!(!caps.surface_under_content);
    }

    #[test]
    fn theme_dto_and_conversions() {
        let baseline = aphrody_m3_tokens::color::BASELINE;
        let dto = ColorRolesDto::from(baseline);
        assert_eq!(dto.primary, baseline.primary);
        assert_eq!(dto.surface, baseline.surface);

        let back: aphrody_m3_tokens::color::ColorRoles = dto.into();
        assert_eq!(back, baseline);

        let snapshot =
            ThemeSnapshot { roles: dto, mode: ThemeMode::Dark, is_dark: true, contrast: 0.5 };
        let json_val = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(json_val["mode"], "dark");
        assert_eq!(json_val["is_dark"], true);

        let decoded: ThemeSnapshot = serde_json::from_value(json_val).unwrap();
        assert_eq!(decoded.mode, ThemeMode::Dark);
        assert!(decoded.is_dark);
        assert_eq!(decoded.color_roles(), baseline);
    }

    #[test]
    fn surface_target_variants() {
        let host_gpu = SurfaceTarget::host_gpu(1920, 1080, "Rgba8Unorm");
        if let SurfaceTarget::HostGpu { width, height, format } = &host_gpu {
            assert_eq!(*width, 1920);
            assert_eq!(*height, 1080);
            assert_eq!(format, "Rgba8Unorm");
        } else {
            panic!("expected HostGpu variant");
        }

        let cpu = SurfaceTarget::cpu_image(2, 2, vec![0; 16]);
        if let SurfaceTarget::CpuImage { width, height, rgba } = &cpu {
            assert_eq!(*width, 2);
            assert_eq!(*height, 2);
            assert_eq!(rgba.len(), 16);
        } else {
            panic!("expected CpuImage variant");
        }
    }

    struct MockWindowHost {
        windows: Vec<WindowInfo>,
    }

    #[async_trait]
    impl WindowHost for MockWindowHost {
        async fn list(&self) -> Result<Vec<WindowInfo>, String> {
            Ok(self.windows.clone())
        }
        async fn open(&self, _spec: WindowSpec) -> Result<WindowInfo, String> {
            Err("unimplemented".into())
        }
        async fn focus(&self, _label: &str) -> Result<WindowInfo, String> {
            Err("unimplemented".into())
        }
        async fn close(&self, _label: &str) -> Result<(), String> {
            Ok(())
        }
        async fn set_bounds(
            &self,
            _label: &str,
            _bounds: WindowBounds,
        ) -> Result<WindowInfo, String> {
            Err("unimplemented".into())
        }
        async fn set_state(&self, _label: &str, _state: WindowState) -> Result<WindowInfo, String> {
            Err("unimplemented".into())
        }
        async fn set_title(&self, _label: &str, _title: &str) -> Result<WindowInfo, String> {
            Err("unimplemented".into())
        }
    }

    #[tokio::test]
    async fn window_host_default_describe_and_capabilities() {
        let host = MockWindowHost {
            windows: vec![WindowInfo {
                label: "main".into(),
                title: "Main".into(),
                ..Default::default()
            }],
        };

        let caps = host.capabilities();
        assert!(!caps.webview);

        let desc = host.describe("main").await.unwrap();
        assert_eq!(desc.label, "main");
        assert_eq!(desc.title, "Main");

        let err = host.describe("unknown").await;
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), "no window labelled `unknown`");
    }

    struct MockThemeProvider;
    impl ThemeProvider for MockThemeProvider {
        fn snapshot(&self) -> ThemeSnapshot {
            ThemeSnapshot { mode: ThemeMode::Dark, is_dark: true, ..Default::default() }
        }
    }

    #[test]
    fn theme_provider_defaults() {
        let provider = MockThemeProvider;
        assert!(provider.is_dark());
        assert_eq!(provider.subscribe(Box::new(|_| {})).unwrap(), 0);
        assert!(provider.unsubscribe(0).is_ok());
    }

    struct MockKernelBridge;
    #[async_trait]
    impl KernelBridge for MockKernelBridge {
        async fn call_tool(
            &self,
            tool: &str,
            _args: serde_json::Value,
        ) -> Result<serde_json::Value, String> {
            Ok(json!({ "called": tool }))
        }
        async fn emit_event(
            &self,
            _topic: &str,
            _payload: serde_json::Value,
        ) -> Result<(), String> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn kernel_bridge_defaults_and_call() {
        let bridge = MockKernelBridge;
        assert!(bridge.is_connected().await);
        let res = bridge.call_tool("echo", json!({})).await.unwrap();
        assert_eq!(res["called"], "echo");
    }
}

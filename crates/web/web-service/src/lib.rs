// SPDX-License-Identifier: Apache-2.0
//! Canonical runtime boundary for web-facing JavaScript in Aphrody OS.
//!
//! This crate deliberately does not make all JavaScript one engine:
//!
//! - N2B parses source statically with OXC and never executes it.
//! - Bun owns TypeScript tooling, package management and FFI on JavaScriptCore.
//! - Obscura owns remote-page rendering, DOM, network, CDP and V8.
//! - Tauri/CEF owns the desktop webview: the trusted Aphrody UI and isolated, interactive previews
//!   of remote pages. It is not a crawler or an artifact source.
//!
//! Browser subsystems and the `aphrody-web` CLI use the same [`WebSession`]
//! contract. HTML from either static fetches or V8-rendered pages is normalized
//! by [`aphrody_web_extract`], the single content-extraction implementation.
//!
//! Two native-only modules are the in-process remainder of the former `aphrody-web-bridge`
//! (the executable bridge to `bxc` is gone; `bxc` is a name of the `aphrody` binary):
//!
//! - [`fetch`]: fetch a page with a profile (HTTP or Obscura browser) and convert it to Markdown,
//!   with its itinerary attached.
//! - [`session`]: the shared browser session on its own worker thread, with typed helpers
//!   (navigate, snapshot, click, evaluate, ...).

pub use aphrody_web_extract::{Extracted, extract_main, html_to_markdown};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(not(target_arch = "wasm32"))]
pub mod error;
#[cfg(not(target_arch = "wasm32"))]
pub mod fetch;
#[cfg(not(target_arch = "wasm32"))]
pub mod session;

#[cfg(not(target_arch = "wasm32"))]
pub use error::WebError;

/// A JavaScript unit discovered while crawling HTML. External scripts retain
/// their resolved URL but are not fetched implicitly; the caller controls
/// network acquisition and can pass their source to N2B independently.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PageScript {
    /// Absolute URL for `src`, or `None` for inline source.
    pub url: Option<String>,
    /// Inline source only. Empty inline scripts are omitted.
    pub source: Option<String>,
    /// HTML `type` attribute, when present.
    pub media_type: Option<String>,
    /// `true` for module scripts.
    pub module: bool,
}

/// Stable hand-off between a crawler/browser and N2B. HTML itself is retained
/// for reproducibility; normalized content and discovered scripts prevent each
/// client from reparsing a divergent page representation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PageArtifact {
    pub url: String,
    pub html: String,
    pub extracted: Extracted,
    pub scripts: Vec<PageScript>,
}

/// Parses a static or already V8-rendered page once into the shared artifact.
#[must_use]
pub fn page_artifact(html: &str, page_url: &str) -> PageArtifact {
    let parsed_url = url::Url::parse(page_url).ok();
    let dom = obscura_dom::parse_html(html);
    let scripts = dom
        .query_selector_all("script")
        .unwrap_or_default()
        .into_iter()
        .filter_map(|id| {
            let (src, media_type) = dom.with_node(id, |node| {
                (
                    node.get_attribute("src").map(str::to_owned),
                    node.get_attribute("type").map(str::to_owned),
                )
            })?;
            let url = src.and_then(|value| {
                parsed_url
                    .as_ref()
                    .and_then(|base| base.join(value.trim()).ok())
                    .map(|url| url.to_string())
            });
            let source = if url.is_none() {
                let text = dom.text_content(id);
                (!text.trim().is_empty()).then_some(text)
            } else {
                None
            };
            (url.is_some() || source.is_some()).then_some(PageScript {
                module: media_type
                    .as_deref()
                    .is_some_and(|kind| kind.eq_ignore_ascii_case("module")),
                url,
                source,
                media_type,
            })
        })
        .collect();
    PageArtifact {
        url: page_url.to_string(),
        html: html.to_string(),
        extracted: extract_main(html, Some(page_url)),
        scripts,
    }
}

/// The only permitted JavaScript responsibilities in the OS.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JavaScriptRole {
    /// OXC AST parsing for N2B rules and codemods. Never evaluates source.
    SourceAnalysis,
    /// Bun tooling and native FFI on JavaScriptCore. Not a browser runtime.
    BunTooling,
    /// Remote web pages rendered by Obscura on V8.
    RenderedPage,
    /// Desktop UI and isolated interactive page previews in Tauri/CEF.
    ///
    /// The Aphrody shell has an explicit CSP and capability allow-list. A
    /// remote preview is opened without those capabilities, so it cannot call
    /// the desktop IPC surface.
    DesktopWebview,
}

/// Concrete engine selected by a [`JavaScriptRole`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JavaScriptEngine {
    Oxc,
    BunJavaScriptCore,
    V8,
    Cef,
}

impl JavaScriptRole {
    /// Returns the engine which owns this role.
    #[must_use]
    pub const fn engine(self) -> JavaScriptEngine {
        match self {
            Self::SourceAnalysis => JavaScriptEngine::Oxc,
            Self::BunTooling => JavaScriptEngine::BunJavaScriptCore,
            Self::RenderedPage => JavaScriptEngine::V8,
            Self::DesktopWebview => JavaScriptEngine::Cef,
        }
    }

    /// True only for remote page JavaScript. N2B remains parse-only by design.
    #[must_use]
    pub const fn executes_javascript(self) -> bool {
        matches!(self, Self::RenderedPage | Self::BunTooling | Self::DesktopWebview)
    }

    /// Source analysis must never acquire a network capability.
    #[must_use]
    pub const fn permits_network(self) -> bool {
        !matches!(self, Self::SourceAnalysis)
    }
}

/// Validates a network navigation used by the V8 page renderer.
///
/// Local files, data URLs and custom schemes are intentionally not browser
/// navigation inputs. They have separate, explicit desktop/file capabilities.
pub fn validate_page_url(value: &str) -> Result<(), String> {
    let url = url::Url::parse(value).map_err(|error| format!("invalid page URL: {error}"))?;
    match url.scheme() {
        "http" | "https" if url.host_str().is_some() => Ok(()),
        "http" | "https" => Err("page URL requires a host".to_string()),
        scheme => Err(format!("page URL scheme {scheme:?} is not allowed")),
    }
}

/// A stealth renderer uses an HTTP client that cannot speak SOCKS5.
pub fn validate_render_proxy(proxy: Option<&str>, stealth: bool) -> Result<(), String> {
    if !stealth {
        return Ok(());
    }
    let Some(proxy) = proxy else { return Ok(()) };
    let scheme = proxy.split("://").next().unwrap_or_default().to_ascii_lowercase();
    if matches!(scheme.as_str(), "socks5" | "socks5h") {
        return Err("stealth rendering does not support SOCKS5; use an HTTP proxy or disable \
                    stealth"
            .to_string());
    }
    Ok(())
}

/// Canonical trimming for raw V8 flags before startup.
#[must_use]
pub fn normalize_v8_flags(raw: Option<&str>) -> Option<String> {
    let flags = raw?.trim();
    (!flags.is_empty()).then(|| flags.to_string())
}

/// A single V8-backed page session. It intentionally exposes only JSON tool
/// contracts; Obscura/V8 types cannot leak into OS callers.
pub struct WebSession {
    state: obscura_mcp::BrowserState,
}

impl WebSession {
    #[must_use]
    pub fn new(proxy: Option<String>, user_agent: Option<String>, stealth: bool) -> Self {
        Self { state: obscura_mcp::BrowserState::new(proxy, user_agent, stealth) }
    }

    /// Browser tools published by the canonical session implementation.
    #[must_use]
    pub fn tools() -> Vec<Value> {
        obscura_mcp::aphrody::tools()
    }

    /// Calls an Obscura browser tool after enforcing the remote-page boundary.
    pub async fn call(&mut self, tool: &str, arguments: Value) -> Result<Value, String> {
        if tool == "browser_navigate" {
            let url = arguments
                .get("url")
                .and_then(Value::as_str)
                .ok_or_else(|| "browser_navigate requires a string url".to_string())?;
            validate_page_url(url)?;
        }
        obscura_mcp::aphrody::call(&mut self.state, tool, arguments).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_javascript_role_has_exactly_one_engine() {
        assert_eq!(JavaScriptRole::SourceAnalysis.engine(), JavaScriptEngine::Oxc);
        assert_eq!(JavaScriptRole::BunTooling.engine(), JavaScriptEngine::BunJavaScriptCore);
        assert_eq!(JavaScriptRole::RenderedPage.engine(), JavaScriptEngine::V8);
        assert_eq!(JavaScriptRole::DesktopWebview.engine(), JavaScriptEngine::Cef);
        assert!(!JavaScriptRole::SourceAnalysis.executes_javascript());
        assert!(!JavaScriptRole::SourceAnalysis.permits_network());
        assert!(JavaScriptRole::DesktopWebview.executes_javascript());
        assert!(JavaScriptRole::DesktopWebview.permits_network());
    }

    #[test]
    fn page_urls_are_remote_http_only() {
        assert!(validate_page_url("https://example.com/path").is_ok());
        assert!(validate_page_url("http://localhost:8080").is_ok());
        assert!(validate_page_url("file:///C:/secret.txt").is_err());
        assert!(validate_page_url("data:text/html,hi").is_err());
        assert!(validate_page_url("https://").is_err());
    }

    #[test]
    fn stealth_rejects_socks_without_rewriting_it() {
        assert!(validate_render_proxy(Some("socks5://127.0.0.1:1080"), true).is_err());
        assert!(validate_render_proxy(Some("https://proxy.example"), true).is_ok());
        assert!(validate_render_proxy(Some("socks5://127.0.0.1:1080"), false).is_ok());
    }

    #[test]
    fn flags_are_trimmed_once_at_the_v8_boundary() {
        assert_eq!(
            normalize_v8_flags(Some("  --max-old-space-size=512  ")).as_deref(),
            Some("--max-old-space-size=512")
        );
        assert_eq!(normalize_v8_flags(Some(" \t")), None);
    }

    #[test]
    fn artifact_keeps_one_html_parse_for_extraction_and_scripts() {
        let artifact = page_artifact(
            r#"<main><h1>Title</h1><p>Body</p></main>
            <script type="module" src="/assets/app.js"></script>
            <script>import value from "pkg";</script>"#,
            "https://example.test/docs/page",
        );
        assert!(artifact.extracted.text.contains("Body"));
        assert_eq!(artifact.scripts.len(), 2);
        assert_eq!(artifact.scripts[0].url.as_deref(), Some("https://example.test/assets/app.js"));
        assert!(artifact.scripts[0].module);
        assert_eq!(artifact.scripts[1].source.as_deref(), Some("import value from \"pkg\";"));
    }
}

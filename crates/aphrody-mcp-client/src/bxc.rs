// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Legacy web compatibility types backed by the shared Rust tool registry.

#[cfg(not(target_arch = "wasm32"))]
use std::sync::Arc;

use aphrody_toolcall::ToolRegistry;
#[cfg(not(target_arch = "wasm32"))]
use aphrody_toolcall::{
    AdditionalProperties, JsonSchema, ToolDefinition, ToolError, ToolExecutor, ToolExposure,
    ToolOutput,
};
use serde::{Deserialize, Serialize};

#[cfg(not(target_arch = "wasm32"))]
use crate::web::{WebExposureProfile, register_native_web_tools};
use crate::{builtins::search::ToolCatalog, error::Result};

/// Legacy exposure profile, now mapped to the native web tool catalog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BxcExposureProfile {
    /// Supported native web and browser tools are exposed directly.
    #[default]
    Default,
    /// Minimal: only `web_fetch` exposed directly.
    Minimal,
    /// Every native and available compatibility web tool is exposed directly.
    Full,
}

/// Static definition of a stable bxc tool alias.
#[derive(Debug, Clone, Copy)]
pub struct BxcAliasMapping {
    /// Exposed function name the model calls.
    pub exposed_name: &'static str,
    /// Historical upstream name retained for API compatibility.
    pub upstream_name: &'static str,
    /// Short description for model visibility.
    pub description: &'static str,
    /// Whether this tool is in the default core set (≤ 25 tools).
    pub in_default_set: bool,
}

/// Historical alias map retained for consumers inspecting the old public API.
/// Runtime registration uses native tools and reports unported aliases explicitly.
pub const BXC_STABLE_ALIASES: &[BxcAliasMapping] = &[
    // Core search & crawl:
    BxcAliasMapping {
        exposed_name: "web_search",
        upstream_name: "bxc_search",
        description: "Search the public web and return curated, markdown-formatted results.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "web_fetch",
        upstream_name: "bxc_scrape_markdown",
        description: "Scrape and convert a public web page directly to clean Markdown.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "web_crawl",
        upstream_name: "bxc_crawl_recursive",
        description: "Recursively crawl a domain up to a configured depth limit.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "bxc_recon",
        upstream_name: "bxc_recon",
        description: "One-shot deep reconnaissance of a URL (technologies, metadata, structure).",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "bxc_detect_frameworks",
        upstream_name: "bxc_detect_frameworks",
        description: "Detect web frameworks, libraries, and CMS used by a target website.",
        in_default_set: true,
    },
    // Browser automation (11 tools):
    BxcAliasMapping {
        exposed_name: "browser_navigate",
        upstream_name: "browser_navigate",
        description: "Navigate active browser page to target URL.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "browser_snapshot",
        upstream_name: "browser_snapshot",
        description: "Capture accessibility snapshot and DOM structure of active browser page.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "browser_click",
        upstream_name: "browser_click",
        description: "Click an element matched by CSS selector or coordinates.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "browser_fill",
        upstream_name: "browser_fill",
        description: "Fill a form input with specified text.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "browser_type",
        upstream_name: "browser_type",
        description: "Type text into currently focused element with keystroke events.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "browser_press_key",
        upstream_name: "browser_press_key",
        description: "Press a specific keyboard key (e.g. 'Enter', 'Escape', 'Tab').",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "browser_select_option",
        upstream_name: "browser_select_option",
        description: "Select an option from a drop-down menu element.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "browser_evaluate",
        upstream_name: "browser_evaluate",
        description: "Execute JavaScript expression in the context of the active browser page.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "browser_wait_for",
        upstream_name: "browser_wait_for",
        description: "Wait for a selector or condition to appear in the browser DOM.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "browser_screenshot",
        upstream_name: "browser_screenshot",
        description: "Capture a full-page or element screenshot from active browser.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "browser_close",
        upstream_name: "browser_close",
        description: "Close the active browser session and release resources.",
        in_default_set: true,
    },
    // Remote RAG & Google endpoints:
    BxcAliasMapping {
        exposed_name: "rag_remote_search",
        upstream_name: "bxc_aphrody_rag_search",
        description: "Query the remote Aphrody / Dragon Ball FR shared RAG knowledge base.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "google_fetch",
        upstream_name: "bxc_google_fetch",
        description: "Fetch live content directly via Google stealth proxies.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "google_translate",
        upstream_name: "bxc_google_translate",
        description: "Translate text between languages via Google Neural Machine Translation.",
        in_default_set: true,
    },
    BxcAliasMapping {
        exposed_name: "google_dns",
        upstream_name: "bxc_google_dns",
        description: "Resolve DNS records via Google Public DNS-over-HTTPS.",
        in_default_set: false,
    },
    BxcAliasMapping {
        exposed_name: "google_suggest",
        upstream_name: "bxc_google_suggest",
        description: "Retrieve Google search autocomplete keyword suggestions.",
        in_default_set: false,
    },
    BxcAliasMapping {
        exposed_name: "google_books",
        upstream_name: "bxc_google_books",
        description: "Search Google Books catalog for publications and authors.",
        in_default_set: false,
    },
];

#[cfg(not(target_arch = "wasm32"))]
struct UnportedWebAlias {
    definition: ToolDefinition,
}

/// Where the capability behind an alias that this registry cannot serve lives.
#[cfg(not(target_arch = "wasm32"))]
fn unported_hint(name: &str) -> &'static str {
    match name {
        "web_search" => {
            "use the agent `web_search` tool or `aphrody web search`: the shared SERP client \
             lives in aphrody-google, which depends on this crate"
        }
        _ => "see `aphrody web --help` and the MCP tool catalog of `aphrody-mcp`",
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[async_trait::async_trait]
impl ToolExecutor for UnportedWebAlias {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, _: serde_json::Value) -> std::result::Result<ToolOutput, ToolError> {
        Ok(ToolOutput::error(format!(
            "{} has no native Rust tool mapping in this Aphrody Web registry yet: {}.",
            self.definition.name,
            unported_hint(&self.definition.name)
        )))
    }
}

/// Registers native Rust web tools and compatibility errors for unported aliases.
///
/// Every native tool runs in process (`aphrody_web_service`); no executable is located or
/// spawned. Returns the total number of tools registered.
pub async fn register_bxc_tools(
    registry: &mut ToolRegistry,
    catalog: &ToolCatalog,
    profile: BxcExposureProfile,
) -> Result<usize> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let native_profile = match profile {
            BxcExposureProfile::Default => WebExposureProfile::Default,
            BxcExposureProfile::Minimal => WebExposureProfile::Minimal,
            BxcExposureProfile::Full => WebExposureProfile::Full,
        };
        let mut registered = register_native_web_tools(registry, catalog, native_profile).await;
        // The normal catalog advertises only implemented native capabilities.
        // Full compatibility mode retains unported names with explicit errors.
        if profile != BxcExposureProfile::Full {
            return Ok(registered);
        }
        for alias in BXC_STABLE_ALIASES {
            if registry.get(alias.exposed_name).is_some() {
                continue;
            }
            let definition = ToolDefinition::new(
                alias.exposed_name,
                format!(
                    "Unavailable: this alias has no native Rust mapping in this registry yet. {}",
                    alias.description
                ),
                JsonSchema::object(
                    Default::default(),
                    None,
                    Some(AdditionalProperties::Boolean(true)),
                ),
            )
            .with_exposure(ToolExposure::Direct);
            let executor = UnportedWebAlias {
                definition: definition.clone(),
            };
            if registry.register(Arc::new(executor)).is_ok() {
                catalog.add(definition).await;
                registered += 1;
            }
        }
        Ok(registered)
    }
    #[cfg(target_arch = "wasm32")]
    {
        let _ = (registry, catalog, profile);
        Ok(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn native_tools_register_in_process() {
        let mut registry = ToolRegistry::new();
        let catalog = ToolCatalog::new();
        assert_eq!(
            register_bxc_tools(&mut registry, &catalog, BxcExposureProfile::Default)
                .await
                .unwrap(),
            6
        );
        assert!(registry.get("web_fetch").is_some());
        assert!(registry.get("browser_snapshot").is_some());
        assert!(
            registry.get("web_search").is_none(),
            "no SERP client below aphrody-google"
        );
        assert!(registry.get("web_crawl").is_none());
        assert_eq!(
            register_bxc_tools(&mut registry, &catalog, BxcExposureProfile::Default)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn full_profile_retains_unported_aliases_with_explicit_errors() {
        let mut registry = ToolRegistry::new();
        let catalog = ToolCatalog::new();
        assert_eq!(
            register_bxc_tools(&mut registry, &catalog, BxcExposureProfile::Full)
                .await
                .unwrap(),
            BXC_STABLE_ALIASES.len()
        );
        let tool = registry.get("web_crawl").unwrap();
        let output = tool
            .handle(serde_json::json!({"url": "https://example.com"}))
            .await
            .unwrap();
        assert!(output.is_error);
        assert!(output.content.contains("web_crawl"));
        assert!(output.content.contains("no native Rust tool mapping"));

        let search = registry.get("web_search").unwrap();
        let output = search
            .handle(serde_json::json!({"query": "rust"}))
            .await
            .unwrap();
        assert!(output.is_error);
        assert!(
            output.content.contains("aphrody web search"),
            "{}",
            output.content
        );
    }
}

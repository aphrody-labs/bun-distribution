// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! bxc native tools bridge: resolution, lazy MCP server initialization, and stable aliases.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
};

use aphrody_toolcall::{ToolExecutor, ToolExposure, ToolRegistry};
use serde::{Deserialize, Serialize};
use tokio::sync::OnceCell;
use tracing::{debug, info};

use crate::{
    builtins::search::ToolCatalog,
    client::{McpClient, McpClientHandle},
    error::{McpClientError, Result},
    executor::McpToolExecutor,
};

/// Exposure profile controlling how many bxc tools are visible directly to the model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BxcExposureProfile {
    /// Recommended default: ≤ ~25 primary web and browser tools exposed directly;
    /// all other specialized tools (FUT, wiki, archive, etc.) registered as Deferred.
    #[default]
    Default,
    /// Minimal: only `web_search` and `web_fetch` exposed directly.
    Minimal,
    /// Full: every tool advertised by bxc is exposed directly.
    Full,
}

/// Static definition of a stable bxc tool alias.
#[derive(Debug, Clone, Copy)]
pub struct BxcAliasMapping {
    /// Exposed function name the model calls.
    pub exposed_name: &'static str,
    /// Upstream name on the `bxc mcp` server.
    pub upstream_name: &'static str,
    /// Short description for model visibility.
    pub description: &'static str,
    /// Whether this tool is in the default core set (≤ 25 tools).
    pub in_default_set: bool,
}

/// The canonical set of stable aliases mapped to bxc tools.
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

/// Resolves the bxc executable path.
///
/// The chain (`APHRODY_WEB_BROWSER_BIN` / `BXC_BIN`, home, `PATH`, the in-tree aphrody-os
/// build) is owned by [`aphrody_web_bridge::resolve::binary`]; this is only its `Option` form.
pub fn resolve_bxc_binary() -> Option<PathBuf> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        aphrody_web_bridge::resolve::binary()
            .ok()
            .map(aphrody_web_bridge::resolve::Source::into_path)
    }
    #[cfg(target_arch = "wasm32")]
    {
        None
    }
}

/// Provider managing a lazily-spawned bxc MCP server process.
#[derive(Clone)]
pub struct LazyBxcProvider {
    binary_path: Option<PathBuf>,
    cell: Arc<OnceCell<McpClientHandle>>,
}

impl LazyBxcProvider {
    /// Create a new provider discovering the binary location automatically.
    #[must_use]
    pub fn new() -> Self {
        Self { binary_path: resolve_bxc_binary(), cell: Arc::new(OnceCell::new()) }
    }

    /// Create with an explicit binary path.
    #[must_use]
    pub fn with_binary(path: impl Into<PathBuf>) -> Self {
        Self { binary_path: Some(path.into()), cell: Arc::new(OnceCell::new()) }
    }

    /// Whether a valid bxc executable could be resolved on this system.
    #[must_use]
    pub fn is_available(&self) -> bool {
        self.binary_path.as_ref().map_or(false, |p| p.is_file())
    }

    /// Access the resolved binary path.
    #[must_use]
    pub fn binary_path(&self) -> Option<&Path> {
        self.binary_path.as_deref()
    }

    /// Lazily get or spawn the underlying `bxc mcp` client connection.
    pub async fn get_client(&self) -> Result<McpClientHandle> {
        let bin = self.binary_path.as_ref().ok_or_else(|| {
            McpClientError::BxcResolve(
                "bxc binary not found; install bxc or set BXC_BIN".to_string(),
            )
        })?;

        self.cell
            .get_or_try_init(|| async {
                info!(bin = %bin.display(), "Spawning lazy bxc MCP server (`bxc mcp`)");
                let bin_str = bin.to_str().unwrap_or("bxc");
                let args = vec!["mcp".to_string()];

                let mut client = McpClient::from_stdio(bin_str, &args, None, None)?;
                client.initialize().await?;
                Ok(McpClientHandle::new("bxc", client))
            })
            .await
            .cloned()
    }
}

impl Default for LazyBxcProvider {
    fn default() -> Self {
        Self::new()
    }
}

/// Connects to bxc and registers both first-class aliases and remaining upstream tools
/// into the [`ToolRegistry`] and [`ToolCatalog`].
///
/// Returns the total number of tools registered.
pub async fn register_bxc_tools(
    registry: &mut ToolRegistry,
    catalog: &ToolCatalog,
    provider: &LazyBxcProvider,
    profile: BxcExposureProfile,
) -> Result<usize> {
    if !provider.is_available() {
        debug!("bxc binary not available; skipping bxc tool registration");
        return Ok(0);
    }

    // Initialize or obtain the client connection:
    let client = provider.get_client().await?;
    let upstream_tools = client.list_tools().await?;

    let mut registered_count = 0;
    let mut claimed_upstream = HashSet::new();

    // 1. Register first-class aliases:
    for alias in BXC_STABLE_ALIASES {
        // Check if upstream server provides this tool:
        if let Some(tool) = upstream_tools.iter().find(|t| t.name == alias.upstream_name) {
            let exposure = match profile {
                BxcExposureProfile::Full => ToolExposure::Direct,
                BxcExposureProfile::Minimal => {
                    if alias.exposed_name == "web_search" || alias.exposed_name == "web_fetch" {
                        ToolExposure::Direct
                    } else {
                        ToolExposure::Deferred
                    }
                },
                BxcExposureProfile::Default => {
                    if alias.in_default_set {
                        ToolExposure::Direct
                    } else {
                        ToolExposure::Deferred
                    }
                },
            };

            let executor = McpToolExecutor::with_alias(
                "bxc",
                alias.upstream_name,
                alias.exposed_name,
                alias.description,
                &tool.input_schema,
                client.clone(),
                exposure,
            );

            catalog.add(executor.definition().clone()).await;
            if registry.register(Arc::new(executor)).is_ok() {
                registered_count += 1;
            }
            claimed_upstream.insert(alias.upstream_name.to_string());
        }
    }

    // 2. Register all other tools advertised by bxc (e.g. FUT, wiki, archive, etc.):
    for tool in &upstream_tools {
        if !claimed_upstream.contains(&tool.name) {
            let exposure = match profile {
                BxcExposureProfile::Full => ToolExposure::Direct,
                _ => ToolExposure::Deferred,
            };

            let executor = McpToolExecutor::from_mcp_tool("bxc", tool, client.clone(), exposure);

            catalog.add(executor.definition().clone()).await;
            if registry.register(Arc::new(executor)).is_ok() {
                registered_count += 1;
            }
        }
    }

    info!(
        registered = registered_count,
        total_upstream = upstream_tools.len(),
        profile = ?profile,
        "Registered bxc tools into registry and catalog"
    );

    Ok(registered_count)
}

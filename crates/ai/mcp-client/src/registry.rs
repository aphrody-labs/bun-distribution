// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! High-level registry assemblers connecting configured MCP servers and built-in tools.

use std::{collections::BTreeMap, sync::Arc};

use aphrody_config::mcp::McpServerConfig;
use aphrody_toolcall::{ToolExecutor, ToolExposure, ToolRegistry};
use tracing::{info, warn};

use crate::{
    builtins::{PlanState, ToolCatalog, register_builtins},
    bxc::{BxcExposureProfile, register_bxc_tools},
    client::{McpClient, McpClientHandle},
    error::Result,
    executor::McpToolExecutor,
};

/// Result of assembling an agent tool registry with MCP and builtins.
pub struct AssembledRegistry {
    /// The populated tool registry ready for engine execution.
    pub registry: ToolRegistry,
    /// Shared catalog for on-demand tool discovery via `tool_search`.
    pub catalog: ToolCatalog,
    /// Handle to the plan state managed by `update_plan`.
    pub plan_state: PlanState,
}

/// Options controlling registry assembly.
#[derive(Debug, Clone, Default)]
pub struct RegistryOptions {
    /// Exposure profile for native web tools (legacy field name).
    pub bxc_exposure: BxcExposureProfile,
    /// Whether to register the shared Rust web tools. Retains the legacy field name.
    pub enable_bxc: bool,
}

/// Assemble a ready-to-use [`ToolRegistry`] including builtins, configured MCP servers, and
/// optional native web tools.
pub async fn assemble_tool_registry(
    configured_servers: &BTreeMap<String, McpServerConfig>,
    options: RegistryOptions,
) -> Result<AssembledRegistry> {
    let mut registry = ToolRegistry::new();
    let (plan_state, catalog) = register_builtins(&mut registry);

    // Register all configured external MCP servers:
    register_configured_mcp_servers(&mut registry, &catalog, configured_servers).await?;

    // Register native web tools first, then compatibility tools still missing in Rust.
    if options.enable_bxc
        && let Err(error) = register_bxc_tools(&mut registry, &catalog, options.bxc_exposure).await
    {
        warn!(%error, "Web compatibility tools could not be registered");
    }

    Ok(AssembledRegistry { registry, catalog, plan_state })
}

/// Connect to and register all enabled MCP servers defined in configuration.
pub async fn register_configured_mcp_servers(
    registry: &mut ToolRegistry,
    catalog: &ToolCatalog,
    servers: &BTreeMap<String, McpServerConfig>,
) -> Result<usize> {
    let mut total_registered = 0;

    for (name, cfg) in servers {
        if !cfg.enabled {
            info!(server = name, "MCP server is disabled by configuration; skipping");
            continue;
        }

        match McpClient::from_config(name, cfg) {
            Ok(mut client) => {
                match client.list_tools().await {
                    Ok(tools) => {
                        let handle = McpClientHandle::new(name, client);
                        let mut server_tool_count = 0;

                        for tool in tools {
                            // Check explicit allow-list:
                            if let Some(allow) = &cfg.enabled_tools
                                && !allow.contains(&tool.name)
                            {
                                continue;
                            }

                            // Check explicit deny-list:
                            if let Some(deny) = &cfg.disabled_tools
                                && deny.contains(&tool.name)
                            {
                                continue;
                            }

                            let executor = McpToolExecutor::from_mcp_tool(
                                name,
                                &tool,
                                handle.clone(),
                                ToolExposure::Direct,
                            );

                            catalog.add(executor.definition().clone()).await;
                            if registry.register(Arc::new(executor)).is_ok() {
                                server_tool_count += 1;
                            }
                        }

                        info!(
                            server = name,
                            tools = server_tool_count,
                            "Registered MCP server tools"
                        );
                        total_registered += server_tool_count;
                    },
                    Err(err) => {
                        warn!(
                            server = name,
                            error = %err,
                            "Failed to list tools from MCP server"
                        );
                    },
                }
            },
            Err(err) => {
                warn!(
                    server = name,
                    error = %err,
                    "Failed to create MCP client from configuration"
                );
            },
        }
    }

    Ok(total_registered)
}

/// Connect to and register the exact enabled MCP server set, failing closed.
///
/// Profile assembly uses this variant so an unavailable server, malformed
/// catalogue, or tool-name collision cannot silently widen or partially alter
/// the selected tool surface.
pub async fn register_selected_mcp_servers(
    registry: &mut ToolRegistry,
    catalog: &ToolCatalog,
    servers: &BTreeMap<String, McpServerConfig>,
) -> Result<usize> {
    let mut total_registered = 0;

    for (name, cfg) in servers {
        if !cfg.enabled {
            info!(server = name, "MCP server is disabled by configuration; skipping");
            continue;
        }

        let mut client = McpClient::from_config(name, cfg)?;
        let tools = client.list_tools().await?;
        let handle = McpClientHandle::new(name, client);
        for tool in tools {
            if cfg.enabled_tools.as_ref().is_some_and(|allow| !allow.contains(&tool.name)) {
                continue;
            }
            if cfg.disabled_tools.as_ref().is_some_and(|deny| deny.contains(&tool.name)) {
                continue;
            }

            let executor =
                McpToolExecutor::from_mcp_tool(name, &tool, handle.clone(), ToolExposure::Direct);
            let definition = executor.definition().clone();
            registry.register(Arc::new(executor)).map_err(|error| {
                crate::error::McpClientError::ToolRegistration(error.to_string())
            })?;
            catalog.add(definition).await;
            total_registered += 1;
        }
    }

    Ok(total_registered)
}

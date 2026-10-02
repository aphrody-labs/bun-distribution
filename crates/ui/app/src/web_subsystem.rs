// SPDX-License-Identifier: Apache-2.0
//! `WebSubsystem`: the desktop kernel's `web` subsystem.
//!
//! Formerly the `aphrody-web` facade crate (`crates/web/web`), merged here because this desktop
//! was its only consumer and already depends on `aphrody-subsystem`. The facade also re-exported
//! `aphrody-web-bridge`, `aphrody-web-extract`, `aphrody-web-index`, `aphrody-web-service` and
//! `obscura`; nothing used those re-exports, and dropping them removes the Obscura/V8 engine and
//! the translate layer from this crate's dependency graph.

use std::sync::Arc;

use aphrody_subsystem::{AgentBus, SkillManifest, SubsystemError, SystemSubsystem, ToolDefinition};
use async_trait::async_trait;
use serde_json::Value;

/// Web subsystem facade used by desktop hosts to register the configured Web MCP provider.
pub struct WebSubsystem {
    provider: Option<Arc<dyn SystemSubsystem>>,
}

impl WebSubsystem {
    /// Create the facade around an optional MCP provider discovered by the host.
    #[must_use]
    pub fn new(provider: Option<Arc<dyn SystemSubsystem>>) -> Self {
        Self { provider }
    }
}

#[async_trait]
impl SystemSubsystem for WebSubsystem {
    fn name(&self) -> &str {
        "web"
    }

    fn description(&self) -> &str {
        "Aphrody Web browser and page automation tools."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        self.provider.as_ref().map_or_else(Vec::new, |provider| provider.tools())
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        let provider = self.provider.as_ref().ok_or_else(|| {
            SubsystemError::Unavailable("Aphrody Web MCP provider is not configured".into())
        })?;
        provider.call(tool, arguments).await
    }

    fn skills(&self) -> Vec<SkillManifest> {
        self.provider.as_ref().map_or_else(Vec::new, |provider| provider.skills())
    }

    async fn run(&self, bus: AgentBus) -> Result<(), SubsystemError> {
        if let Some(provider) = &self.provider {
            provider.run(bus).await?;
        }
        Ok(())
    }
}

// SPDX-License-Identifier: Apache-2.0

//! Native Aphrody Web tools for the agent registry.

use std::{collections::BTreeMap, sync::Arc, time::Duration};

use aphrody_toolcall::{
    AdditionalProperties, JsonSchema, ToolDefinition, ToolError, ToolExecutor, ToolExposure,
    ToolImage, ToolOutput, ToolRegistry,
};
use aphrody_web_service::{
    fetch::{Profile, Request, fetch},
    session,
};
use serde_json::Value;

use crate::builtins::search::ToolCatalog;

/// Exposure policy for the native web tools.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum WebExposureProfile {
    /// Fetch and browser actions are shown directly.
    #[default]
    Default,
    /// Only fetch is shown directly.
    Minimal,
    /// Every available web tool is shown directly.
    Full,
}

#[derive(Debug, Clone, Copy)]
enum Operation {
    Fetch,
    Navigate,
    Snapshot,
    Click,
    Screenshot,
    PressKey,
}

struct NativeWebTool {
    definition: ToolDefinition,
    operation: Operation,
}

fn schema(required: &[&str], optional: &[&str]) -> JsonSchema {
    let mut properties = BTreeMap::new();
    for name in required.iter().chain(optional) {
        properties.insert((*name).to_owned(), JsonSchema::string(None));
    }
    JsonSchema::object(
        properties,
        Some(required.iter().map(|name| (*name).to_owned()).collect()),
        Some(AdditionalProperties::Boolean(false)),
    )
}

fn definitions(profile: WebExposureProfile) -> Vec<NativeWebTool> {
    let entries = [
        (
            "web_fetch",
            "Fetch a public web page as Markdown.",
            Operation::Fetch,
            &["url"][..],
            &["profile"][..],
        ),
        (
            "browser_navigate",
            "Navigate the shared browser page to a URL.",
            Operation::Navigate,
            &["url"][..],
            &[][..],
        ),
        (
            "browser_snapshot",
            "Read the shared browser accessibility snapshot.",
            Operation::Snapshot,
            &[][..],
            &[][..],
        ),
        (
            "browser_click",
            "Click an element in the shared browser by selector.",
            Operation::Click,
            &["selector"][..],
            &[][..],
        ),
        (
            "browser_screenshot",
            "Capture a PNG screenshot of the shared browser page.",
            Operation::Screenshot,
            &[][..],
            &[][..],
        ),
        (
            "browser_press_key",
            "Press a key in the shared browser page.",
            Operation::PressKey,
            &["key"][..],
            &[][..],
        ),
    ];
    entries
        .into_iter()
        .map(|(name, description, operation, required, optional)| {
            let exposure = if profile == WebExposureProfile::Minimal
                && !matches!(operation, Operation::Fetch)
            {
                ToolExposure::Deferred
            } else {
                ToolExposure::Direct
            };
            NativeWebTool {
                definition: ToolDefinition::new(name, description, schema(required, optional))
                    .with_exposure(exposure),
                operation,
            }
        })
        .collect()
}

fn required<'a>(arguments: &'a Value, name: &str, tool: &str) -> Result<&'a str, ToolError> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| ToolError::InvalidArguments {
            tool: tool.to_owned(),
            message: format!("{name} must be a nonempty string"),
        })
}

#[async_trait::async_trait]
impl ToolExecutor for NativeWebTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: Value) -> Result<ToolOutput, ToolError> {
        let tool = self.definition.name.as_str();
        let budget = Duration::from_secs(45);
        let outcome = match self.operation {
            Operation::Fetch => {
                let url = required(&arguments, "url", tool)?;
                let mut request = Request::new(url).with_timeout(budget);
                if let Some(name) = arguments.get("profile").and_then(Value::as_str) {
                    let Some(profile) = Profile::parse(name) else {
                        return Ok(ToolOutput::error(format!(
                            "{tool}: unknown profile {name:?}; use static, fast, http, stealth or max"
                        )));
                    };
                    request = request.with_profile(profile);
                }
                match fetch(&request).await {
                    Ok(page) if page.body.trim().is_empty() => {
                        return Ok(ToolOutput::error(format!(
                            "{tool}: the page produced an empty body"
                        )));
                    }
                    Ok(page) => Ok(page.body),
                    Err(error) => Err(error),
                }
            }
            Operation::Navigate => {
                session::navigate(required(&arguments, "url", tool)?, budget).await
            }
            Operation::Snapshot => session::snapshot(budget).await,
            Operation::Click => {
                session::click(required(&arguments, "selector", tool)?, budget).await
            }
            Operation::Screenshot => {
                return Ok(match session::screenshot(budget).await {
                    Ok(png) => ToolOutput::ok("Browser screenshot captured.")
                        .with_images(vec![ToolImage::new("image/png", png)]),
                    Err(error) => ToolOutput::error(format!("{tool}: {error}")),
                });
            }
            Operation::PressKey => {
                session::press_key(required(&arguments, "key", tool)?, budget).await
            }
        };
        Ok(match outcome {
            Ok(text) => ToolOutput::ok(text),
            Err(error) => ToolOutput::error(format!("{tool}: {error}")),
        })
    }
}

/// Register only tools whose shared Rust implementation is available.
pub async fn register_native_web_tools(
    registry: &mut ToolRegistry,
    catalog: &ToolCatalog,
    profile: WebExposureProfile,
) -> usize {
    let mut count = 0;
    for tool in definitions(profile) {
        let definition = tool.definition.clone();
        if registry.register(Arc::new(tool)).is_ok() {
            catalog.add(definition).await;
            count += 1;
        }
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn native_catalog_advertises_only_implemented_tools() {
        let mut registry = ToolRegistry::new();
        let catalog = ToolCatalog::new();
        assert_eq!(
            register_native_web_tools(&mut registry, &catalog, WebExposureProfile::Default).await,
            6
        );
        assert!(registry.get("web_fetch").is_some());
        assert!(registry.get("browser_snapshot").is_some());
        assert!(registry.get("web_search").is_none());
        assert!(registry.get("web_crawl").is_none());
        assert!(registry.get("browser_fill").is_none());
    }

    #[test]
    fn missing_required_argument_is_explicit() {
        assert!(required(&serde_json::json!({}), "url", "web_fetch").is_err());
    }
}

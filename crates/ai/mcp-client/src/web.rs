// SPDX-License-Identifier: Apache-2.0

//! Native Aphrody Web tools for the agent registry.

use std::{collections::BTreeMap, sync::Arc, time::Duration};

use aphrody_toolcall::{
    AdditionalProperties, JsonSchema, ToolDefinition, ToolError, ToolExecutor, ToolExposure,
    ToolImage, ToolOutput, ToolRegistry,
};
use serde_json::Value;

use crate::builtins::search::ToolCatalog;

/// Exposure policy for the native web tools.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum WebExposureProfile {
    /// Search, fetch and browser actions are shown directly.
    #[default]
    Default,
    /// Only search and fetch are shown directly.
    Minimal,
    /// Every available web tool is shown directly.
    Full,
}

#[derive(Debug, Clone, Copy)]
enum Operation {
    Search,
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
        let field =
            if *name == "num" { JsonSchema::integer(None) } else { JsonSchema::string(None) };
        properties.insert((*name).to_owned(), field);
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
            "web_search",
            "Search the public web and return linked results.",
            Operation::Search,
            &["query"][..],
            &["num"][..],
        ),
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
                && !matches!(operation, Operation::Search | Operation::Fetch)
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
    arguments.get(name).and_then(Value::as_str).filter(|value| !value.trim().is_empty()).ok_or_else(
        || ToolError::InvalidArguments {
            tool: tool.to_owned(),
            message: format!("{name} must be a nonempty string"),
        },
    )
}

#[async_trait::async_trait]
impl ToolExecutor for NativeWebTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: Value) -> Result<ToolOutput, ToolError> {
        let tool = self.definition.name.as_str();
        let client = match aphrody_web_bridge::WebBrowserClient::discover() {
            Ok(client) => client,
            Err(error) => return Ok(ToolOutput::error(format!("{tool}: {error}"))),
        };
        let budget = Duration::from_secs(45);
        match self.operation {
            Operation::Search => {
                let query = required(&arguments, "query", tool)?;
                let num = arguments
                    .get("num")
                    .and_then(Value::as_u64)
                    .and_then(|v| u32::try_from(v).ok());
                match client.search(query, num, budget).await {
                    Ok(results) => {
                        let mut body = format!("# Search results for: {query}\n\n");
                        for hit in results.hits {
                            body.push_str(&format!(
                                "- [{}]({}): {}\n",
                                hit.title, hit.link, hit.snippet
                            ));
                        }
                        Ok(ToolOutput::ok(body))
                    },
                    Err(error) => Ok(ToolOutput::error(format!("{tool}: {error}"))),
                }
            },
            Operation::Fetch => {
                let url = required(&arguments, "url", tool)?;
                let profile = arguments
                    .get("profile")
                    .and_then(Value::as_str)
                    .and_then(aphrody_web_bridge::Profile::parse);
                match client.scrape_markdown(url, profile, budget).await {
                    Ok((body, _)) => Ok(ToolOutput::ok(body)),
                    Err(error) => Ok(ToolOutput::error(format!("{tool}: {error}"))),
                }
            },
            operation => {
                let args = match operation {
                    Operation::Navigate => vec![
                        "chrome".to_owned(),
                        "navigate".to_owned(),
                        required(&arguments, "url", tool)?.to_owned(),
                    ],
                    Operation::Snapshot => vec!["chrome".to_owned(), "snapshot".to_owned()],
                    Operation::Click => vec![
                        "chrome".to_owned(),
                        "click".to_owned(),
                        "--selector".to_owned(),
                        required(&arguments, "selector", tool)?.to_owned(),
                    ],
                    Operation::Screenshot => vec!["chrome".to_owned(), "screenshot".to_owned()],
                    Operation::PressKey => vec![
                        "chrome".to_owned(),
                        "key".to_owned(),
                        "--key".to_owned(),
                        required(&arguments, "key", tool)?.to_owned(),
                    ],
                    Operation::Search | Operation::Fetch => unreachable!(),
                };
                match client.run(&args, budget).await {
                    Ok(run) if !run.ok() => {
                        Ok(ToolOutput::error(format!("{tool}: {}", run.stderr)))
                    },
                    Ok(run) if matches!(operation, Operation::Screenshot) => {
                        Ok(ToolOutput::ok("Browser screenshot captured.")
                            .with_images(vec![ToolImage::new("image/png", run.stdout)]))
                    },
                    Ok(run) => Ok(ToolOutput::ok(run.stdout)),
                    Err(error) => Ok(ToolOutput::error(format!("{tool}: {error}"))),
                }
            },
        }
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
            7
        );
        assert!(registry.get("web_search").is_some());
        assert!(registry.get("browser_snapshot").is_some());
        assert!(registry.get("web_crawl").is_none());
        assert!(registry.get("browser_fill").is_none());
    }

    #[test]
    fn missing_required_argument_is_explicit() {
        assert!(required(&serde_json::json!({}), "url", "web_fetch").is_err());
    }
}

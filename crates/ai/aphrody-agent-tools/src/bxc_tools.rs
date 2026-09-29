// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Native BXC tools for the Aphrody Agent Engine:
//! - [`WebSearchTool`]: high-cadence search via bxc search engine
//! - [`WebScrapeTool`]: fast markdown extraction via bxc scrape engine
//! - [`JsEvalTool`]: in-process / sandboxed JavaScript VM execution
//! - [`GoogleAiTool`]: direct keyless Google AI generative interface

use std::{collections::BTreeMap, time::Duration};

use aphrody_toolcall::{
    AdditionalProperties, JsonSchema, ToolDefinition, ToolError, ToolExecutor, ToolOutput,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ----------------------------------------------------------------------------
// 1. WebSearchTool
// ----------------------------------------------------------------------------

/// Search query parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSearchArgs {
    /// Search terms to query.
    pub query: String,
    /// Maximum number of results to return (default: 5).
    #[serde(default)]
    pub num: Option<u32>,
}

/// Native web search tool powered by the bxc engine.
pub struct WebSearchTool {
    definition: ToolDefinition,
    budget: Duration,
}

impl WebSearchTool {
    /// Create a new web search tool.
    #[must_use]
    pub fn new() -> Self {
        let mut properties = BTreeMap::new();
        properties
            .insert("query".into(), JsonSchema::string(Some("Search query keywords.".into())));
        properties.insert(
            "num".into(),
            JsonSchema::integer(Some("Maximum number of results to retrieve (default: 5).".into())),
        );

        let definition = ToolDefinition::new(
            "web_search",
            "Search the live web and return curated, markdown-formatted results.",
            JsonSchema::object(
                properties,
                Some(vec!["query".into()]),
                Some(AdditionalProperties::Boolean(false)),
            ),
        );

        Self { definition, budget: Duration::from_secs(45) }
    }
}

impl Default for WebSearchTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl ToolExecutor for WebSearchTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: Value) -> Result<ToolOutput, ToolError> {
        let args: WebSearchArgs = serde_json::from_value(arguments).map_err(|e| {
            ToolError::InvalidArguments { tool: "web_search".into(), message: e.to_string() }
        })?;

        let client = match aphrody_web_bridge::cli::BxcCli::discover() {
            Ok(c) => c,
            Err(e) => {
                return Ok(ToolOutput::error(format!(
                    "web_search: native Web client unavailable ({e})"
                )));
            },
        };

        let num = args.num.unwrap_or(5);
        match client.search(&args.query, Some(num), self.budget).await {
            Ok(results) => {
                let mut out = format!("# Search results for: {}\n\n", args.query);
                if results.hits.is_empty() {
                    out.push_str("No results found.\n");
                } else {
                    for (i, hit) in results.hits.iter().enumerate() {
                        out.push_str(&format!(
                            "### {}. [{}]({})\n{}\n\n",
                            i + 1,
                            hit.title,
                            hit.link,
                            hit.snippet
                        ));
                    }
                }
                Ok(ToolOutput::ok(out))
            },
            Err(e) => Ok(ToolOutput::error(format!("web_search failed: {e}"))),
        }
    }
}

// ----------------------------------------------------------------------------
// 2. WebScrapeTool
// ----------------------------------------------------------------------------

/// Scrape parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebScrapeArgs {
    /// URL to scrape.
    pub url: String,
    /// Optional stealth profile: "static", "fast", "http", "stealth", "max".
    #[serde(default)]
    pub profile: Option<String>,
}

/// Native web scraper tool powered by bxc.
pub struct WebScrapeTool {
    definition: ToolDefinition,
    budget: Duration,
}

impl WebScrapeTool {
    /// Create a new web scrape tool.
    #[must_use]
    pub fn new() -> Self {
        let mut properties = BTreeMap::new();
        properties.insert(
            "url".into(),
            JsonSchema::string(Some("Target HTTP or HTTPS URL to scrape and convert.".into())),
        );
        properties.insert(
            "profile".into(),
            JsonSchema::string(Some(
                "Optional stealth profile: 'static', 'fast', 'http', 'stealth', 'max'.".into(),
            )),
        );

        let definition = ToolDefinition::new(
            "web_scrape",
            "Scrape and convert any public web page directly into clean Markdown using the native \
             bxc engine.",
            JsonSchema::object(
                properties,
                Some(vec!["url".into()]),
                Some(AdditionalProperties::Boolean(false)),
            ),
        );

        Self { definition, budget: Duration::from_secs(60) }
    }
}

impl Default for WebScrapeTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl ToolExecutor for WebScrapeTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: Value) -> Result<ToolOutput, ToolError> {
        let args: WebScrapeArgs = serde_json::from_value(arguments).map_err(|e| {
            ToolError::InvalidArguments { tool: "web_scrape".into(), message: e.to_string() }
        })?;

        let client = match aphrody_web_bridge::cli::BxcCli::discover() {
            Ok(c) => c,
            Err(e) => {
                return Ok(ToolOutput::error(format!(
                    "web_scrape: native Web client unavailable ({e})"
                )));
            },
        };

        let profile = args.profile.as_deref().and_then(aphrody_web_bridge::cli::Profile::parse);
        match client.scrape_markdown(&args.url, profile, self.budget).await {
            Ok((body, _run)) => Ok(ToolOutput::ok(body)),
            Err(e) => Ok(ToolOutput::error(format!("web_scrape failed: {e}"))),
        }
    }
}

// ----------------------------------------------------------------------------
// 3. JsEvalTool (VM JS)
// ----------------------------------------------------------------------------

/// JavaScript execution parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsEvalArgs {
    /// JavaScript code to execute.
    pub code: String,
}

/// Fast JavaScript VM evaluation tool powered by the bxc engine.
pub struct JsEvalTool {
    definition: ToolDefinition,
}

impl JsEvalTool {
    /// Create a new JavaScript evaluation tool.
    #[must_use]
    pub fn new() -> Self {
        let mut properties = BTreeMap::new();
        properties.insert(
            "code".into(),
            JsonSchema::string(Some("JavaScript code snippet to execute.".into())),
        );

        let definition = ToolDefinition::new(
            "js_eval",
            "Execute JavaScript code in the native bxc V8 / Bun VM runtime and return output.",
            JsonSchema::object(
                properties,
                Some(vec!["code".into()]),
                Some(AdditionalProperties::Boolean(false)),
            ),
        );

        Self { definition }
    }
}

impl Default for JsEvalTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl ToolExecutor for JsEvalTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: Value) -> Result<ToolOutput, ToolError> {
        let args: JsEvalArgs = serde_json::from_value(arguments).map_err(|e| {
            ToolError::InvalidArguments { tool: "js_eval".into(), message: e.to_string() }
        })?;

        let client = match aphrody_web_bridge::cli::BxcCli::discover() {
            Ok(c) => c,
            Err(e) => {
                return Ok(ToolOutput::error(format!(
                    "js_eval: native Web client unavailable ({e})"
                )));
            },
        };

        let run = client
            .run(&["-e".to_string(), args.code], Duration::from_secs(10))
            .await
            .map_err(|e| ToolError::Execution { tool: "js_eval".into(), message: e.to_string() })?;

        if run.ok() {
            Ok(ToolOutput::ok(if run.stdout.trim().is_empty() {
                "Execution finished successfully with empty output.".into()
            } else {
                run.stdout
            }))
        } else {
            Ok(ToolOutput::error(format!(
                "js_eval exited {}: {}",
                run.code.unwrap_or(-1),
                run.stderr
            )))
        }
    }
}

// ----------------------------------------------------------------------------
// 4. GoogleAiTool (Keyless Google AI)
// ----------------------------------------------------------------------------

/// Google AI request parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GoogleAiArgs {
    /// Prompt to send to the model.
    pub prompt: String,
    /// Model name: "flash", "pro", "gemini-2.5-pro", etc.
    #[serde(default)]
    pub model: Option<String>,
}

/// Native keyless Google AI tool powered by bxc gemini web session.
pub struct GoogleAiTool {
    definition: ToolDefinition,
}

impl GoogleAiTool {
    /// Create a new Google AI tool.
    #[must_use]
    pub fn new() -> Self {
        let mut properties = BTreeMap::new();
        properties.insert(
            "prompt".into(),
            JsonSchema::string(Some("Prompt to submit to Google AI.".into())),
        );
        properties.insert(
            "model".into(),
            JsonSchema::string(Some("Model tier: 'flash' (default) or 'pro'.".into())),
        );

        let definition = ToolDefinition::new(
            "google_ai",
            "Query Google AI models keylessly via native session and retrieve generated text.",
            JsonSchema::object(
                properties,
                Some(vec!["prompt".into()]),
                Some(AdditionalProperties::Boolean(false)),
            ),
        );

        Self { definition }
    }
}

impl Default for GoogleAiTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl ToolExecutor for GoogleAiTool {
    fn definition(&self) -> &ToolDefinition {
        &self.definition
    }

    async fn handle(&self, arguments: Value) -> Result<ToolOutput, ToolError> {
        let args: GoogleAiArgs = serde_json::from_value(arguments).map_err(|e| {
            ToolError::InvalidArguments { tool: "google_ai".into(), message: e.to_string() }
        })?;

        obscura_net::ensure_rustls_crypto_provider();
        let client = aphrody_gemini_web::GeminiWebClient::from_default_cookie_file("en")
            .await
            .map_err(|error| ToolError::Execution {
                tool: "google_ai".into(),
                message: error.to_string(),
            })?;
        let model = args.model.as_deref().map(|id| {
            aphrody_gemini_web::GeminiModel::from_id(id)
                .map_or_else(|| id.to_owned(), aphrody_gemini_web::GeminiModel::header)
        });
        let reply = tokio::time::timeout(
            Duration::from_secs(60),
            client.ask(&args.prompt, model.as_deref()),
        )
        .await
        .map_err(|error| ToolError::Execution {
            tool: "google_ai".into(),
            message: error.to_string(),
        })?
        .map_err(|error| ToolError::Execution {
            tool: "google_ai".into(),
            message: error.to_string(),
        })?;
        Ok(ToolOutput::ok(reply.text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn definitions_match_expected_names_and_contracts() {
        let search = WebSearchTool::new();
        assert_eq!(search.definition().name, "web_search");
        assert!(search.definition().description.contains("Search"));

        let scrape = WebScrapeTool::new();
        assert_eq!(scrape.definition().name, "web_scrape");
        assert!(scrape.definition().description.contains("Scrape"));

        let js = JsEvalTool::new();
        assert_eq!(js.definition().name, "js_eval");
        assert!(js.definition().description.contains("JavaScript"));

        let ai = GoogleAiTool::new();
        assert_eq!(ai.definition().name, "google_ai");
        assert!(ai.definition().description.contains("Google AI"));
    }
}

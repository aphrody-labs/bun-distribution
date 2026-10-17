// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Shared Rust Web tools for the Aphrody Agent Engine:
//! - [`WebSearchTool`]: public web search
//! - [`WebScrapeTool`]: markdown extraction
//! - [`JsEvalTool`]: in-process / sandboxed JavaScript VM execution
//! - [`GoogleAiTool`]: direct keyless Google AI generative interface

use std::{collections::BTreeMap, time::Duration};

use aphrody_toolcall::{
    AdditionalProperties, JsonSchema, ToolDefinition, ToolError, ToolExecutor, ToolOutput,
};
use aphrody_web_service::{
    fetch::{Profile, Request, fetch},
    session,
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

/// Native web search tool powered by the shared Rust Web client.
pub struct WebSearchTool {
    definition: ToolDefinition,
    budget: Duration,
}

impl WebSearchTool {
    /// Create a new web search tool.
    #[must_use]
    pub fn new() -> Self {
        let mut properties = BTreeMap::new();
        properties.insert(
            "query".into(),
            JsonSchema::string(Some("Search query keywords.".into())),
        );
        properties.insert(
            "num".into(),
            JsonSchema::integer(Some(
                "Maximum number of results to retrieve (default: 5).".into(),
            )),
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

        Self {
            definition,
            budget: Duration::from_secs(45),
        }
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
        let args: WebSearchArgs =
            serde_json::from_value(arguments).map_err(|e| ToolError::InvalidArguments {
                tool: "web_search".into(),
                message: e.to_string(),
            })?;

        if args.query.trim().is_empty() {
            return Ok(ToolOutput::error("web_search: the query must not be empty"));
        }
        // The shared SERP client of `aphrody web search`: cookie-authenticated when a jar is
        // present, anonymous otherwise.
        let num = args.num.unwrap_or(5).clamp(1, 100);
        let options = aphrody_google::search::SearchOptions {
            num: u8::try_from(num).ok(),
            ..aphrody_google::search::SearchOptions::default()
        };
        let search = aphrody_google::search::search_rich(&args.query, &options);
        match tokio::time::timeout(self.budget, search).await {
            Ok(Ok(results)) => {
                let mut out = format!("# Search results for: {}\n\n", args.query);
                if results.content.organic.is_empty() {
                    out.push_str("No results found.\n");
                } else {
                    for hit in results.content.organic.iter().take(num as usize) {
                        out.push_str(&format!(
                            "### {}. [{}]({})\n{}\n\n",
                            hit.position, hit.title, hit.url, hit.snippet
                        ));
                    }
                }
                Ok(ToolOutput::ok(out))
            }
            Ok(Err(e)) => Ok(ToolOutput::error(format!("web_search failed: {e}"))),
            Err(_) => Ok(ToolOutput::error(format!(
                "web_search exceeded its {}s budget",
                self.budget.as_secs()
            ))),
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

/// Native web scraper tool powered by the shared Rust Web client.
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
            JsonSchema::string(Some(
                "Target HTTP or HTTPS URL to scrape and convert.".into(),
            )),
        );
        properties.insert(
            "profile".into(),
            JsonSchema::string(Some(
                "Optional stealth profile: 'static', 'fast', 'http', 'stealth', 'max'.".into(),
            )),
        );

        let definition = ToolDefinition::new(
            "web_scrape",
            "Scrape and convert any public web page directly into clean Markdown.",
            JsonSchema::object(
                properties,
                Some(vec!["url".into()]),
                Some(AdditionalProperties::Boolean(false)),
            ),
        );

        Self {
            definition,
            budget: Duration::from_secs(60),
        }
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
        let args: WebScrapeArgs =
            serde_json::from_value(arguments).map_err(|e| ToolError::InvalidArguments {
                tool: "web_scrape".into(),
                message: e.to_string(),
            })?;

        let mut request = Request::new(args.url).with_timeout(self.budget);
        if let Some(name) = args.profile.as_deref() {
            let Some(profile) = Profile::parse(name) else {
                return Ok(ToolOutput::error(format!(
                    "web_scrape: unknown profile {name:?}; use static, fast, http, stealth or max"
                )));
            };
            request = request.with_profile(profile);
        }
        match fetch(&request).await {
            Ok(page) if page.body.trim().is_empty() => Ok(ToolOutput::error(
                "web_scrape failed: the page produced an empty body",
            )),
            Ok(page) => Ok(ToolOutput::ok(page.body)),
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

/// Fast JavaScript VM evaluation tool powered by the shared Rust Web client.
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
            "Execute JavaScript code in an isolated native V8 runtime and return output.",
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
        let args: JsEvalArgs =
            serde_json::from_value(arguments).map_err(|e| ToolError::InvalidArguments {
                tool: "js_eval".into(),
                message: e.to_string(),
            })?;

        let output = session::evaluate(&args.code, Duration::from_secs(10))
            .await
            .map_err(|e| ToolError::Execution {
                tool: "js_eval".into(),
                message: e.to_string(),
            })?;

        Ok(ToolOutput::ok(if output.trim().is_empty() {
            "Execution finished successfully with empty output.".into()
        } else {
            output
        }))
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

/// Native keyless Google AI tool powered by the shared Gemini web session.
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
        let args: GoogleAiArgs =
            serde_json::from_value(arguments).map_err(|e| ToolError::InvalidArguments {
                tool: "google_ai".into(),
                message: e.to_string(),
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

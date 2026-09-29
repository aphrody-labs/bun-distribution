// SPDX-License-Identifier: Apache-2.0
//! Gemini Web one-shot tool served directly by the Rust MCP host.

use std::{
    path::{Path, PathBuf},
    sync::LazyLock,
    time::Duration,
};

use aphrody_gemini_web::{GeminiModel, GeminiWebClient};
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::{Value, json};

const GEMINI_TIMEOUT: Duration = Duration::from_secs(120);

static TOOLS: LazyLock<Vec<Tool>> = LazyLock::new(|| {
    vec![serde_json::from_value(json!({
        "name": "aphrody_gemini_rust",
        "description": "Execute a one-shot Gemini Web query directly in the shared Rust runtime.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "Prompt to send." },
                "model": {
                    "type": "string",
                    "enum": ["flash", "flash-lite", "pro"],
                    "default": "flash",
                    "description": "Target model."
                },
                "cookiePath": { "type": "string", "description": "Cookie file path." }
            },
            "required": ["prompt"],
            "additionalProperties": false
        }
    })).expect("static Gemini tool schema")]
});

pub(crate) fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    TOOLS.iter().filter(|tool| !taken(tool.name.as_ref())).cloned().collect()
}

pub(crate) fn get(name: &str) -> Option<Tool> {
    TOOLS.iter().find(|tool| tool.name == name).cloned()
}

pub(crate) fn owns(name: &str) -> bool {
    get(name).is_some()
}

fn cookie_dir() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("APHRODY_COOKIES_DIR").filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(path));
    }
    let root = std::env::var_os("APHRODY_HOME")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".aphrody")))
        .ok_or_else(|| "cannot resolve Aphrody home for Gemini cookies".to_owned())?;
    Ok(root.join("cookies"))
}

fn resolve_cookie_path(input: Option<&str>, cookies: &Path) -> PathBuf {
    let input = input.filter(|value| !value.is_empty()).unwrap_or("gemini");
    if input.contains('/')
        || input.contains('\\')
        || input.ends_with(".json")
        || input.ends_with(".txt")
    {
        return PathBuf::from(input);
    }
    let json = cookies.join(format!("{input}.json"));
    let text = cookies.join(format!("{input}.txt"));
    if !json.is_file() && text.is_file() { text } else { json }
}

fn parse_request(args: &Value) -> Result<(&str, &str, Option<&str>), String> {
    let prompt = args
        .get("prompt")
        .and_then(Value::as_str)
        .ok_or_else(|| "prompt must be a string".to_owned())?;
    let model = args.get("model").map_or(Ok("flash"), |value| {
        value.as_str().ok_or_else(|| "model must be a string".to_owned())
    })?;
    if !matches!(model, "flash" | "flash-lite" | "pro") {
        return Err("model must be flash, flash-lite or pro".to_owned());
    }
    let cookie_path = args
        .get("cookiePath")
        .map(|value| value.as_str().ok_or_else(|| "cookiePath must be a string".to_owned()))
        .transpose()?;
    Ok((prompt, model, cookie_path))
}

async fn run(args: &Value) -> Result<Value, String> {
    let (prompt, model_id, cookie_path) = parse_request(args)?;
    let path = resolve_cookie_path(cookie_path, &cookie_dir()?);
    let model =
        GeminiModel::from_id(model_id).ok_or_else(|| "unsupported Gemini model".to_owned())?;
    let response = tokio::time::timeout(GEMINI_TIMEOUT, async {
        let client = GeminiWebClient::from_cookie_file(&path, "en").await?;
        client.ask(prompt, Some(&model.header())).await
    })
    .await
    .map_err(|_| format!("Gemini request timed out after {}s", GEMINI_TIMEOUT.as_secs()))?
    .map_err(|error| format!("Failed to execute Gemini request: {error}"))?;
    let raw = json!({
        "text": response.text,
        "conversation_id": response.metadata.conversation_id,
        "response_id": response.metadata.response_id,
        "choice_id": response.metadata.choice_id,
    });
    Ok(json!({
        "text": raw["text"],
        "conversationId": raw["conversation_id"],
        "responseId": raw["response_id"],
        "choiceId": raw["choice_id"],
        "engine": "rust",
        "model": model_id,
        "raw": raw,
    }))
}

pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let name = request.name.as_ref();
    let args =
        request.arguments.as_ref().map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    match run(&args).await {
        Ok(value) => {
            let mut result = CallToolResult::success(vec![ContentBlock::text(
                serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_owned()),
            )]);
            result.structured_content = Some(value);
            result
        },
        Err(error) => CallToolResult::error(vec![ContentBlock::text(format!("{name}: {error}"))]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_matches_source_request_shape() {
        assert!(owns("aphrody_gemini_rust"));
        assert_eq!(TOOLS.len(), 1);
        let schema = serde_json::to_value(get("aphrody_gemini_rust").unwrap()).unwrap();
        assert_eq!(schema["inputSchema"]["required"], json!(["prompt"]));
        assert_eq!(schema["inputSchema"]["properties"]["model"]["default"], "flash");
    }

    #[test]
    fn named_cookie_jar_and_explicit_paths_resolve_without_reading_secrets() {
        let dir = Path::new("/tmp/aphrody-cookies");
        assert_eq!(resolve_cookie_path(None, dir), dir.join("gemini.json"));
        assert_eq!(resolve_cookie_path(Some("google"), dir), dir.join("google.json"));
        assert_eq!(
            resolve_cookie_path(Some("/private/gemini.json"), dir),
            Path::new("/private/gemini.json")
        );
        assert_eq!(resolve_cookie_path(Some("relative.json"), dir), Path::new("relative.json"));
    }

    #[tokio::test]
    async fn malformed_request_fails_before_cookie_or_network_access() {
        assert_eq!(run(&json!({})).await.unwrap_err(), "prompt must be a string");
        assert!(
            run(&json!({ "prompt": "hello", "model": "invalid" }))
                .await
                .unwrap_err()
                .contains("model")
        );
        assert!(
            run(&json!({ "prompt": "hello", "cookiePath": 4 }))
                .await
                .unwrap_err()
                .contains("cookiePath")
        );
    }

    #[tokio::test]
    async fn missing_cookie_file_fails_without_contacting_gemini() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing.json");
        let error = run(&json!({ "prompt": "hello", "cookiePath": missing })).await.unwrap_err();
        assert!(error.contains("Failed to execute Gemini request"));
    }
}

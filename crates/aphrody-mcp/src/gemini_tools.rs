// SPDX-License-Identifier: Apache-2.0
//! Gemini Web one-shot tool served directly by the Rust MCP host.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock},
    time::Duration,
};

use aphrody_gemini_web::{ConversationMetadata, GeminiModel, GeminiWebClient};
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::{Value, json};
use tokio::sync::Mutex;

const GEMINI_TIMEOUT: Duration = Duration::from_secs(120);

static TOOLS: LazyLock<Vec<Tool>> = LazyLock::new(|| {
    [json!({
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
    }), json!({
        "name": "aphrody_gemini_ask",
        "description": "Query Google Gemini directly with automatic engine selection (Rust Bridge -> Web) using signed-in cookies.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "The user prompt or query." },
                "model": {
                    "type": "string", "enum": ["flash", "flash-lite", "pro"],
                    "default": "flash", "description": "Target model."
                },
                "engine": {
                    "type": "string", "enum": ["auto", "rust", "web"],
                    "default": "auto", "description": "Execution engine."
                },
                "cookiePath": {
                    "type": "string",
                    "description": "Custom cookie jar file path or name (default: gemini)."
                }
            },
            "required": ["prompt"],
            "additionalProperties": false
        }
    }), json!({
        "name": "aphrody_gemini_chat",
        "description": "Chat with Gemini keeping continuous conversation context across multi-turn exchanges.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "The message to send." },
                "conversationId": {
                    "type": "string",
                    "default": "aphrody-session",
                    "description": "Conversation session ID for continuity."
                },
                "model": {
                    "type": "string",
                    "enum": ["flash", "flash-lite", "pro"],
                    "default": "flash",
                    "description": "Target model."
                }
            },
            "required": ["prompt"],
            "additionalProperties": false
        }
    })]
    .into_iter()
    .map(|definition| serde_json::from_value(definition).expect("static Gemini tool schema"))
    .collect()
});

#[derive(Default)]
struct ChatSession {
    client: Option<GeminiWebClient>,
    metadata: ConversationMetadata,
}

static CHAT_SESSIONS: LazyLock<Mutex<HashMap<String, Arc<Mutex<ChatSession>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    TOOLS
        .iter()
        .filter(|tool| !taken(tool.name.as_ref()))
        .cloned()
        .collect()
}

pub fn get(name: &str) -> Option<Tool> {
    TOOLS.iter().find(|tool| tool.name == name).cloned()
}

pub fn owns(name: &str) -> bool {
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
    if !json.is_file() && text.is_file() {
        text
    } else {
        json
    }
}

fn parse_request(args: &Value) -> Result<(&str, &str, Option<&str>), String> {
    let prompt = args
        .get("prompt")
        .and_then(Value::as_str)
        .ok_or_else(|| "prompt must be a string".to_owned())?;
    let model = args.get("model").map_or(Ok("flash"), |value| {
        value
            .as_str()
            .ok_or_else(|| "model must be a string".to_owned())
    })?;
    if !matches!(model, "flash" | "flash-lite" | "pro") {
        return Err("model must be flash, flash-lite or pro".to_owned());
    }
    let cookie_path = args
        .get("cookiePath")
        .map(|value| {
            value
                .as_str()
                .ok_or_else(|| "cookiePath must be a string".to_owned())
        })
        .transpose()?;
    Ok((prompt, model, cookie_path))
}

async fn run(args: &Value) -> Result<Value, String> {
    let (prompt, model_id, cookie_path) = parse_request(args)?;
    let mut path = resolve_cookie_path(cookie_path, &cookie_dir()?);
    if cookie_path.is_none()
        && !path.is_file()
        && let Ok(default_path) = aphrody_gemini_web::Auth::default_cookie_path()
        && default_path.is_file()
    {
        path = default_path;
    }
    let model =
        GeminiModel::from_id(model_id).ok_or_else(|| "unsupported Gemini model".to_owned())?;
    let response = tokio::time::timeout(GEMINI_TIMEOUT, async {
        let client = GeminiWebClient::from_cookie_file(&path, "en").await?;
        client.ask(prompt, Some(&model.header())).await
    })
    .await
    .map_err(|_| {
        format!(
            "Gemini request timed out after {}s",
            GEMINI_TIMEOUT.as_secs()
        )
    })?
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

fn parse_ask_engine(args: &Value) -> Result<&str, String> {
    let engine = args.get("engine").map_or(Ok("auto"), |value| {
        value
            .as_str()
            .ok_or_else(|| "engine must be a string".to_owned())
    })?;
    if !matches!(engine, "auto" | "rust" | "web") {
        return Err("engine must be auto, rust or web".to_owned());
    }
    Ok(engine)
}

async fn run_ask(args: &Value) -> Result<Value, String> {
    let engine = parse_ask_engine(args)?;
    let (_, model_id, _) = parse_request(args)?;
    let rust_reply = run(args).await?;
    if engine == "web" {
        Ok(json!({ "text": rust_reply["text"], "engine": "web", "model": model_id }))
    } else {
        Ok(rust_reply)
    }
}

fn parse_chat_request(args: &Value) -> Result<(&str, &str, &str), String> {
    let prompt = args
        .get("prompt")
        .and_then(Value::as_str)
        .ok_or_else(|| "prompt must be a string".to_owned())?;
    let conversation_id = args
        .get("conversationId")
        .map_or(Ok("aphrody-session"), |value| {
            value
                .as_str()
                .ok_or_else(|| "conversationId must be a string".to_owned())
        })?;
    let model = args.get("model").map_or(Ok("flash"), |value| {
        value
            .as_str()
            .ok_or_else(|| "model must be a string".to_owned())
    })?;
    if GeminiModel::from_id(model).is_none() {
        return Err("model must be flash, flash-lite or pro".to_owned());
    }
    Ok((prompt, conversation_id, model))
}

async fn run_chat(args: &Value) -> Result<Value, String> {
    let (prompt, conversation_id, model_id) = parse_chat_request(args)?;
    let model =
        GeminiModel::from_id(model_id).ok_or_else(|| "unsupported Gemini model".to_owned())?;
    let mut path = resolve_cookie_path(None, &cookie_dir()?);
    if !path.is_file()
        && let Ok(default_path) = aphrody_gemini_web::Auth::default_cookie_path()
        && default_path.is_file()
    {
        path = default_path;
    }
    let session = {
        let mut sessions = CHAT_SESSIONS.lock().await;
        Arc::clone(sessions.entry(conversation_id.to_owned()).or_default())
    };
    let mut session = session.lock().await;
    let response = tokio::time::timeout(GEMINI_TIMEOUT, async {
        if session.client.is_none() {
            session.client = Some(GeminiWebClient::from_cookie_file(&path, "en").await?);
        }
        session
            .client
            .as_ref()
            .expect("client initialized above")
            .send(prompt, Some(&model.header()), &session.metadata, None)
            .await
    })
    .await;
    let response = match response {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => {
            *session = ChatSession::default();
            return Err(format!("Failed to execute Gemini chat: {error}"));
        }
        Err(_) => {
            *session = ChatSession::default();
            return Err(format!(
                "Gemini chat timed out after {}s",
                GEMINI_TIMEOUT.as_secs()
            ));
        }
    };
    session.metadata = response.metadata;
    Ok(json!({
        "text": response.text,
        "conversationId": conversation_id,
        "engine": "web",
        "model": model_id,
    }))
}

pub async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let name = request.name.as_ref();
    let args = request
        .arguments
        .as_ref()
        .map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    let response = match name {
        "aphrody_gemini_rust" => run(&args).await,
        "aphrody_gemini_ask" => run_ask(&args).await,
        "aphrody_gemini_chat" => run_chat(&args).await,
        _ => Err(format!("unknown Gemini tool: {name}")),
    };
    match response {
        Ok(value) => {
            let mut result = CallToolResult::success(vec![ContentBlock::text(
                serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_owned()),
            )]);
            if name == "aphrody_gemini_rust" {
                result.structured_content = Some(value);
            }
            result
        }
        Err(error) => CallToolResult::error(vec![ContentBlock::text(format!("{name}: {error}"))]),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_matches_source_request_shape() {
        assert!(owns("aphrody_gemini_rust"));
        assert!(owns("aphrody_gemini_ask"));
        assert!(owns("aphrody_gemini_chat"));
        assert_eq!(TOOLS.len(), 3);
        let schema = serde_json::to_value(get("aphrody_gemini_rust").unwrap()).unwrap();
        assert_eq!(schema["inputSchema"]["required"], json!(["prompt"]));
        assert_eq!(
            schema["inputSchema"]["properties"]["model"]["default"],
            "flash"
        );
        let chat = serde_json::to_value(get("aphrody_gemini_chat").unwrap()).unwrap();
        assert_eq!(chat["inputSchema"]["required"], json!(["prompt"]));
        assert_eq!(
            chat["inputSchema"]["properties"]["conversationId"]["default"],
            "aphrody-session"
        );
        let ask = serde_json::to_value(get("aphrody_gemini_ask").unwrap()).unwrap();
        assert_eq!(
            ask["inputSchema"]["properties"]["engine"]["default"],
            "auto"
        );
    }

    #[test]
    fn named_cookie_jar_and_explicit_paths_resolve_without_reading_secrets() {
        let dir = Path::new("/tmp/aphrody-cookies");
        assert_eq!(resolve_cookie_path(None, dir), dir.join("gemini.json"));
        assert_eq!(
            resolve_cookie_path(Some("google"), dir),
            dir.join("google.json")
        );
        assert_eq!(
            resolve_cookie_path(Some("/private/gemini.json"), dir),
            Path::new("/private/gemini.json")
        );
        assert_eq!(
            resolve_cookie_path(Some("relative.json"), dir),
            Path::new("relative.json")
        );
    }

    #[tokio::test]
    async fn malformed_request_fails_before_cookie_or_network_access() {
        assert_eq!(
            run(&json!({})).await.unwrap_err(),
            "prompt must be a string"
        );
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
        let error = run(&json!({ "prompt": "hello", "cookiePath": missing }))
            .await
            .unwrap_err();
        assert!(error.contains("Failed to execute Gemini request"));
    }

    #[test]
    fn malformed_chat_request_fails_before_cookie_or_network_access() {
        assert!(parse_chat_request(&json!({})).is_err());
        assert!(parse_chat_request(&json!({ "prompt": "hello", "conversationId": 4 })).is_err());
        assert!(parse_chat_request(&json!({ "prompt": "hello", "model": "invalid" })).is_err());
        assert_eq!(
            parse_chat_request(&json!({ "prompt": "hello" })).unwrap(),
            ("hello", "aphrody-session", "flash")
        );
    }

    #[tokio::test]
    async fn malformed_ask_engine_fails_before_cookie_or_network_access() {
        assert_eq!(parse_ask_engine(&json!({})).unwrap(), "auto");
        assert!(
            run_ask(&json!({ "prompt": "hello", "engine": "bogus" }))
                .await
                .is_err()
        );
        assert!(
            run_ask(&json!({ "prompt": "hello", "engine": 2 }))
                .await
                .is_err()
        );
    }
}

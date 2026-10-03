// SPDX-License-Identifier: Apache-2.0
//! Studio backend: typed commands over the Shenron logic owned by `aphrody-command`
//! (`shenron_cmd`), returned as structured JSON for the native Studio screens.

use serde_json::Value;

fn main_window_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Studio commands are only available from the main window".into())
    }
}

fn report<E: std::fmt::Debug>(result: Result<Value, E>) -> Result<Value, String> {
    result.map_err(|error| format!("{error:?}"))
}

/// Health of the Shenron site, bot, Aphrody AI, serving RAG and Agent Home dbfr.
#[tauri::command]
pub async fn studio_shenron_health(window: tauri::WebviewWindow) -> Result<Value, String> {
    main_window_only(&window)?;
    report(aphrody_command::shenron_cmd::doctor_report().await)
}

/// Shenron RAG corpus statistics (chunks, vectors, sources).
#[tauri::command]
pub async fn studio_shenron_rag_stats(window: tauri::WebviewWindow) -> Result<Value, String> {
    main_window_only(&window)?;
    report(aphrody_command::shenron_cmd::rag_stats_report().await)
}

/// Bounded Shenron RAG search.
#[tauri::command]
pub async fn studio_shenron_rag_search(
    window: tauri::WebviewWindow,
    query: String,
    limit: usize,
    kind: Option<String>,
) -> Result<Value, String> {
    main_window_only(&window)?;
    report(aphrody_command::shenron_cmd::rag_search_checked(&query, limit, kind.as_deref()).await)
}

/// Shenron training environment (Python project, GPUs, candidate root).
#[tauri::command]
pub async fn studio_shenron_training(window: tauri::WebviewWindow) -> Result<Value, String> {
    main_window_only(&window)?;
    report(aphrody_command::shenron_cmd::train_status_report())
}

/// Local models served by the managed `llama-server` (chat, embed, rerank) that are ready now.
#[tauri::command]
pub fn studio_native_ai_status() -> Value {
    use aphrody_llama_server::{Role, discover_running};
    let role = |role: Role| {
        discover_running(role).map_or_else(
            || serde_json::json!({"ready": false}),
            |state| serde_json::json!({"ready": state.ready, "model": state.alias, "port": state.port}),
        )
    };
    serde_json::json!({
        "chat": role(Role::Chat),
        "embed": role(Role::Embed),
        "rerank": role(Role::Rerank),
    })
}

/// Chat completion on the local chat model (OpenAI-compatible `/v1/chat/completions`).
#[tauri::command]
pub async fn studio_native_chat(
    messages: Vec<Value>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
) -> Result<Value, String> {
    use aphrody_llama_server::{Role, discover_running};
    let state = discover_running(Role::Chat).filter(|state| state.ready).ok_or_else(|| {
        "aucun modèle de chat local prêt : en charger un depuis Modèles".to_string()
    })?;
    let body = serde_json::json!({
        "model": state.alias,
        "messages": messages,
        "temperature": temperature.unwrap_or(0.4),
        "max_tokens": max_tokens.unwrap_or(1024),
        "stream": false,
    });
    let response = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{}/v1/chat/completions", state.port))
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("modèle local injoignable : {error}"))?;
    let status = response.status();
    let value: Value =
        response.json().await.map_err(|error| format!("réponse invalide : {error}"))?;
    if status.is_success() {
        Ok(value)
    } else {
        Err(format!("modèle local : HTTP {status} {value}"))
    }
}

/// Bridge injected into the Shenron admin window: the page calls the desktop's local models
/// directly through IPC instead of the network.
const NATIVE_AI_BRIDGE: &str = r#"
(() => {
  const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args ?? {});
  window.aphrodyNative = Object.freeze({
    desktop: true,
    status: () => invoke("studio_native_ai_status"),
    chat: (messages, options = {}) =>
      invoke("studio_native_chat", { messages, temperature: options.temperature ?? null, maxTokens: options.maxTokens ?? null }),
    ragSearch: (query, limit = 10, kind = null) => invoke("studio_shenron_rag_search", { query, limit, kind }),
  });
  window.dispatchEvent(new Event("aphrody-native-ready"));
})();
"#;

/// Open the full Shenron admin dashboard in a native window with the local-AI bridge.
#[tauri::command]
pub async fn studio_open_shenron_admin(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    url: Option<String>,
) -> Result<(), String> {
    use tauri::Manager;
    main_window_only(&window)?;
    if let Some(existing) = app.get_webview_window(ADMIN_LABEL) {
        existing.show().map_err(|error| error.to_string())?;
        existing.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let target = url
        .or_else(|| std::env::var("SHENRON_ADMIN_URL").ok())
        .unwrap_or_else(|| DEFAULT_ADMIN_URL.to_string());
    let parsed: tauri::Url =
        target.parse().map_err(|error| format!("URL admin invalide : {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("seules les URL http(s) ouvrent l'administration".into());
    }
    tauri::WebviewWindowBuilder::new(&app, ADMIN_LABEL, tauri::WebviewUrl::External(parsed))
        .title("Shenron — Administration")
        .inner_size(1440.0, 920.0)
        .initialization_script(NATIVE_AI_BRIDGE)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

const ADMIN_LABEL: &str = "shenron-admin";
const DEFAULT_ADMIN_URL: &str = "https://dragonballfr.com/admin";

static TRAINING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Start a Shenron `embed` or `rerank` candidate training in the background; progress is reported
/// on the `studio://train` event (`started`, then `finished` with the candidate dir or `failed`).
#[tauri::command]
pub async fn studio_shenron_train_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    kind: String,
    steps: Option<usize>,
    base_model: Option<String>,
    allow_cpu: Option<bool>,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri::Emitter;
    main_window_only(&window)?;
    let base_model = match (kind.as_str(), base_model) {
        (_, Some(model)) if !model.trim().is_empty() => model,
        ("embed", _) => "intfloat/multilingual-e5-small".to_string(),
        ("rerank", _) => "BAAI/bge-reranker-base".to_string(),
        _ => return Err("type d'entraînement inconnu (embed ou rerank)".into()),
    };
    if TRAINING.swap(true, Ordering::SeqCst) {
        return Err("un entraînement est déjà en cours".into());
    }
    let steps = steps.unwrap_or(10);
    let allow_cpu = allow_cpu.unwrap_or(false);
    let _ = app.emit("studio://train", serde_json::json!({"state": "started", "kind": kind, "steps": steps, "baseModel": base_model}));
    tauri::async_runtime::spawn(async move {
        let result = aphrody_command::shenron_cmd::train_candidate(
            &kind, None, steps, base_model, allow_cpu,
        )
        .await;
        let payload = match result {
            Ok(output) => {
                serde_json::json!({"state": "finished", "kind": kind, "output": output.display().to_string()})
            },
            Err(error) => {
                serde_json::json!({"state": "failed", "kind": kind, "error": format!("{error:?}")})
            },
        };
        TRAINING.store(false, Ordering::SeqCst);
        let _ = app.emit("studio://train", payload);
    });
    Ok(())
}

/// The offline Shenron corpus (wiki, databooks, manga, lore) owned by `aphrody-rag::dragonball`,
/// loaded once per process.
fn corpus() -> &'static aphrody_rag::dragonball::LocalCorpus {
    static CORPUS: std::sync::OnceLock<aphrody_rag::dragonball::LocalCorpus> =
        std::sync::OnceLock::new();
    CORPUS.get_or_init(|| {
        aphrody_rag::dragonball::LocalCorpus::load_with(&aphrody_rag::dragonball::process_env)
    })
}

/// Size of the local Shenron corpus.
#[tauri::command]
pub fn studio_corpus_info() -> Value {
    serde_json::json!({ "documents": corpus().len() })
}

/// Search the local Shenron corpus (kind filter e.g. `databook`, `manga`, `wiki`).
#[tauri::command]
pub fn studio_corpus_search(
    query: String,
    limit: Option<usize>,
    kind: Option<String>,
    lang: Option<String>,
) -> Value {
    let options = aphrody_rag::dragonball::LocalSearchOptions { limit, lang, entity: None, kind };
    corpus().search_json(&query, &options)
}

/// Grounded answer from the local corpus; uses the desktop's local chat model when one is ready.
#[tauri::command]
pub async fn studio_corpus_ask(question: String) -> Value {
    use aphrody_llama_server::{Role, discover_running};
    let local = discover_running(Role::Chat).filter(|state| state.ready);
    let env = move |name: &str| -> Option<String> {
        if let Some(state) = &local {
            match name {
                "APHRODY_AI_CHAT_BASE_URL" => return Some(state.base_url()),
                "APHRODY_AI_CHAT_MODEL" => return Some(state.alias.clone()),
                _ => {},
            }
        }
        aphrody_rag::dragonball::process_env(name)
    };
    corpus().ask_json(&question, &env).await
}

/// Google OAuth "installed app" loopback flow with the existing Aphrody OAuth client
/// (`~/.aphrody/private/google/aphrody-oauth-client.json`). The browser asks for consent once; the
/// tokens are kept in the private store (`drive-oauth-token.json`, mode 0600) and returned so the
/// Drive daemon can mount the folder (`volumes.add_cloud`, OpenDAL `gdrive`).
#[tauri::command]
pub async fn studio_google_drive_authorize(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    use tauri_plugin_opener::OpenerExt;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    main_window_only(&window)?;
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from).ok_or("HOME absent")?;
    let private = home.join(".aphrody/private/google");
    let client: Value = serde_json::from_str(
        &std::fs::read_to_string(private.join("aphrody-oauth-client.json"))
            .map_err(|error| format!("client OAuth Google introuvable : {error}"))?,
    )
    .map_err(|error| format!("client OAuth illisible : {error}"))?;
    let installed = &client["installed"];
    let field = |name: &str| {
        installed[name]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| format!("client OAuth : `{name}` absent"))
    };
    let (client_id, client_secret) = (field("client_id")?, field("client_secret")?);
    let (auth_uri, token_uri) = (field("auth_uri")?, field("token_uri")?);

    let listener =
        tokio::net::TcpListener::bind("127.0.0.1:0").await.map_err(|error| error.to_string())?;
    let redirect =
        format!("http://localhost:{}", listener.local_addr().map_err(|e| e.to_string())?.port());
    let state = format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos()
    );
    let mut consent = reqwest::Url::parse(&auth_uri).map_err(|error| error.to_string())?;
    consent
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect)
        .append_pair("response_type", "code")
        .append_pair("scope", "https://www.googleapis.com/auth/drive")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &state);
    app.opener().open_url(consent.as_str(), None::<&str>).map_err(|error| error.to_string())?;

    let accept = async {
        let (mut stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let mut buffer = vec![0_u8; 8192];
        let read = stream.read(&mut buffer).await.map_err(|error| error.to_string())?;
        let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
        let target = request.split_whitespace().nth(1).unwrap_or("/").to_owned();
        let page = "<!doctype html><meta charset=utf-8><title>Aphrody</title><p>Autorisation reçue, vous pouvez revenir dans Aphrody.</p>";
        let _ = stream
            .write_all(format!("HTTP/1.1 200 OK\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{page}", page.len()).as_bytes())
            .await;
        Ok::<String, String>(target)
    };
    let target = tokio::time::timeout(std::time::Duration::from_secs(300), accept)
        .await
        .map_err(|_| "délai d'autorisation Google dépassé (5 min)".to_string())??;
    let url =
        reqwest::Url::parse(&format!("{redirect}{target}")).map_err(|error| error.to_string())?;
    let query: std::collections::HashMap<String, String> = url.query_pairs().into_owned().collect();
    if query.get("state") != Some(&state) {
        return Err("réponse OAuth refusée : état inattendu".into());
    }
    if let Some(error) = query.get("error") {
        return Err(format!("autorisation Google refusée : {error}"));
    }
    let code = query.get("code").ok_or("réponse OAuth sans code")?;
    let tokens: Value = reqwest::Client::new()
        .post(&token_uri)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|error| format!("échange du code : {error}"))?
        .json()
        .await
        .map_err(|error| format!("réponse de jeton invalide : {error}"))?;
    let access_token =
        tokens["access_token"].as_str().ok_or_else(|| format!("jeton absent : {tokens}"))?;
    let refresh_token = tokens["refresh_token"]
        .as_str()
        .ok_or("refresh_token absent (consentement hors ligne refusé)")?;
    let stored = serde_json::json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "scope": tokens["scope"],
        "obtained_at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs(),
    });
    let path = private.join("drive-oauth-token.json");
    std::fs::write(&path, serde_json::to_vec_pretty(&stored).map_err(|e| e.to_string())?)
        .map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    Ok(serde_json::json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": client_secret,
    }))
}

/// Retrieve native A2A fleet status, active claims and mailbox envelopes from `.coord`.
#[tauri::command]
pub async fn studio_a2a_fleet_status() -> Result<Value, String> {
    let repo_root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let coord_dir = repo_root.join(".coord");

    // Read active claims
    let claims_dir = coord_dir.join("claims");
    let mut claims = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&claims_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                if let Ok(content) = tokio::fs::read_to_string(&path).await {
                    if let Ok(parsed) = serde_json::from_str::<Value>(&content) {
                        claims.push(parsed);
                    }
                }
            }
        }
    }

    // Read envelopes from mailboxes
    let mut envelopes = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&coord_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if name.ends_with(".jsonl") {
                if let Ok(content) = tokio::fs::read_to_string(&path).await {
                    for line in content.lines() {
                        let trimmed = line.trim();
                        if !trimmed.is_empty() {
                            if let Ok(env) = serde_json::from_str::<Value>(trimmed) {
                                envelopes.push(env);
                            }
                        }
                    }
                }
            }
        }
    }

    // Peers
    let peers = serde_json::json!([
        {
            "id": "agy",
            "name": "Antigravity CLI (agy)",
            "role": "Lead Systems & UI Agent",
            "status": "busy",
            "version": "2.0.0",
            "skills": ["bun", "rust", "m3", "tauri", "ag-ui", "mcp-ui"],
            "activeClaim": ".coord/claims/native-integration.json"
        },
        {
            "id": "codex",
            "name": "Codex CLI",
            "role": "Backend & Systems Integrator",
            "status": "busy",
            "version": "1.4.0",
            "skills": ["rust", "cargo", "torch", "cef", "bindings"],
            "activeClaim": "crates/koharu/koharu-torch"
        },
        {
            "id": "claude",
            "name": "Claude Code",
            "role": "Core Monorepo Architect",
            "status": "idle",
            "version": "3.7.0",
            "skills": ["refactoring", "monorepo", "architecture", "coordination"]
        },
        {
            "id": "shenron",
            "name": "Shenron AI",
            "role": "RAG & Knowledge Domain Agent",
            "status": "idle",
            "version": "2.1.0",
            "skills": ["rag", "embeddings", "dragonball", "databooks", "ocr"]
        }
    ]);

    Ok(serde_json::json!({
        "peers": peers,
        "claims": claims,
        "envelopes": envelopes,
        "coordDir": coord_dir.to_string_lossy(),
    }))
}

/// Send an A2A envelope directly to a peer mailbox in `.coord`.
#[tauri::command]
pub async fn studio_a2a_send_envelope(envelope: Value) -> Result<Value, String> {
    use tokio::io::AsyncWriteExt;
    let repo_root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let coord_dir = repo_root.join(".coord");
    tokio::fs::create_dir_all(&coord_dir).await.map_err(|e| e.to_string())?;

    let to = envelope["to"].as_str().unwrap_or("codex");
    let filename = format!("inbox-to-{to}.jsonl");
    let target = coord_dir.join(filename);

    let mut line = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;
    line.push('\n');

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&target)
        .await
        .map_err(|e| e.to_string())?;

    file.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "sent": true, "path": target.to_string_lossy(), "envelope": envelope }))
}

/// List the canonical app-server tools; no generative UI capability is implied.
#[tauri::command]
pub async fn studio_mcp_tools_list(
    window: tauri::WebviewWindow,
    broker: tauri::State<'_, crate::broker::AppServerBroker>,
) -> Result<Value, String> {
    main_window_only(&window)?;
    let response =
        broker.call(serde_json::json!({"id": 0, "method": "tools/list", "params": {}})).await?;
    tools_inventory_from_response(&response)
}

fn tools_inventory_from_response(response: &Value) -> Result<Value, String> {
    if let Some(error) = response.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("Tool inventory unavailable")
            .to_owned());
    }
    let data = response
        .get("result")
        .and_then(|result| result.get("data"))
        .and_then(Value::as_array)
        .ok_or("Invalid app-server tool inventory")?;
    let tools = data
        .iter()
        .map(|tool| {
            let name = tool.get("name").and_then(Value::as_str).ok_or("Invalid tool name")?;
            let description = tool.get("description").and_then(Value::as_str).unwrap_or("");
            Ok(serde_json::json!({"name": name, "description": description, "ui": null}))
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(serde_json::json!({
        "tools": tools,
        "source": "aphrody-app-server/tools/list",
        "protocol": "JSON-RPC 2.0",
        "m3Parity": false
    }))
}

#[cfg(test)]
mod tool_inventory_tests {
    use super::tools_inventory_from_response;
    use serde_json::json;

    #[test]
    fn lists_only_tools_returned_by_the_owner_without_fabricated_ui_support() {
        let inventory = tools_inventory_from_response(&json!({"result": {"data": [
            {"type": "function", "name": "synthetic_tool", "description": "Synthetic fixture", "parameters": {}}
        ]}})).unwrap();
        assert_eq!(inventory["tools"].as_array().unwrap().len(), 1);
        assert_eq!(inventory["tools"][0]["name"], "synthetic_tool");
        assert!(inventory["tools"][0]["ui"].is_null());
        assert_eq!(inventory["m3Parity"], false);
        assert!(!inventory.to_string().contains("chart_generator"));
    }

    #[test]
    fn errors_and_malformed_responses_never_appear_as_successful_empty_registry() {
        assert_eq!(
            tools_inventory_from_response(&json!({"error": {"message": "fixture unavailable"}}))
                .unwrap_err(),
            "fixture unavailable"
        );
        assert!(tools_inventory_from_response(&json!({})).is_err());
        assert!(tools_inventory_from_response(&json!({"result": {"data": [{}]}})).is_err());
        assert!(tools_inventory_from_response(&json!({"result": {"data": []}})).is_ok());
    }
}

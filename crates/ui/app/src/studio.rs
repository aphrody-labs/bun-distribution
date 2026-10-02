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
    let state = discover_running(Role::Chat)
        .filter(|state| state.ready)
        .ok_or_else(|| "aucun modèle de chat local prêt : en charger un depuis Modèles".to_string())?;
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
    let value: Value = response.json().await.map_err(|error| format!("réponse invalide : {error}"))?;
    if status.is_success() { Ok(value) } else { Err(format!("modèle local : HTTP {status} {value}")) }
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
    let parsed: tauri::Url = target.parse().map_err(|error| format!("URL admin invalide : {error}"))?;
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

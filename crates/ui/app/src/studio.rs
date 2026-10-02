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
        let result = aphrody_command::shenron_cmd::train_candidate(&kind, None, steps, base_model, allow_cpu).await;
        let payload = match result {
            Ok(output) => serde_json::json!({"state": "finished", "kind": kind, "output": output.display().to_string()}),
            Err(error) => serde_json::json!({"state": "failed", "kind": kind, "error": format!("{error:?}")}),
        };
        TRAINING.store(false, Ordering::SeqCst);
        let _ = app.emit("studio://train", payload);
    });
    Ok(())
}

/// The offline Shenron corpus (wiki, databooks, manga, lore) owned by `aphrody-rag::dragonball`,
/// loaded once per process.
fn corpus() -> &'static aphrody_rag::dragonball::LocalCorpus {
    static CORPUS: std::sync::OnceLock<aphrody_rag::dragonball::LocalCorpus> = std::sync::OnceLock::new();
    CORPUS.get_or_init(|| aphrody_rag::dragonball::LocalCorpus::load_with(&aphrody_rag::dragonball::process_env))
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

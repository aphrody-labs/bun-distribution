// SPDX-License-Identifier: Apache-2.0
use serde::{Deserialize, Serialize};

/// Embedding backend for the `[rag]` layer.
///
/// aphrody extension table; no upstream Codex equivalent exists ("Codex has
/// no embedding retrieval" — `docs/plans/codex-oss.md`, "Verified findings").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EmbedBackend {
    /// Pure-Rust in-process BERT/cross-encoder via `aphrody-embed::native`.
    Native,
    /// ONNX Runtime, in-process, via `aphrody-embed`.
    Ort,
    /// A locally supervised `llama-server` instance's `/v1/embeddings`.
    LlamaServer,
    /// Any OpenAI-compatible `/v1/embeddings` endpoint.
    OpenaiCompat,
}

/// Retrieval mode for `aphrody rag search|context`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum RagMode {
    /// Reciprocal-rank-fusion of lexical (FTS5) and vector search, then
    /// cross-encoder reranking.
    #[serde(rename = "hybrid+rerank")]
    HybridRerank,
    /// Reciprocal-rank-fusion of lexical and vector search, no reranker.
    #[serde(rename = "hybrid")]
    Hybrid,
    /// FTS5 only. The honest degrade mode when no embedder is reachable.
    #[serde(rename = "lexical")]
    Lexical,
}

/// When retrieved context is injected into a turn automatically.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AutoContext {
    /// Never inject automatically; only the `rag_search`/`rag_context` tools
    /// do.
    Off,
    /// Inject once, on the first user turn of a session.
    FirstTurn,
    /// Inject on every turn.
    EveryTurn,
}

/// `[rag]` — aphrody's retrieval-augmented-generation layer configuration.
///
/// Every field is optional/defaulted; see `aphrody-rag`'s effective-config
/// resolution (P8, `docs/plans/codex-oss.md`) for the runtime defaults this
/// crate does not itself invent (`db_path`, `embed_model`, ...).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RagConfig {
    /// Master on/off switch for the RAG layer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Path to the `SQLite` index file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub db_path: Option<String>,
    /// Embedding model identifier (catalog id or `ModelRef::Local`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub embed_model: Option<String>,
    /// Which backend serves `embed_model`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub embed_backend: Option<EmbedBackend>,
    /// Vector width required by the configured embedding model/index.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vector_dim: Option<usize>,
    /// OpenAI-compatible embedding endpoint. Authentication remains in the
    /// process environment; no key is accepted by this schema.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub embed_endpoint: Option<String>,
    /// Reranker model identifier.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rerank_model: Option<String>,
    /// HTTP reranker endpoint. Authentication remains outside `config.toml`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rerank_endpoint: Option<String>,
    /// Requested retrieval mode (may be honestly degraded at serve time).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<RagMode>,
    /// Number of candidates to fuse before reranking.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_k: Option<usize>,
    /// Number of fused candidates to actually rerank.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rerank_top_n: Option<usize>,
    /// When retrieved context is auto-injected into a turn.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_context: Option<AutoContext>,
    /// Token budget for auto-injected context.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_context_max_tokens: Option<usize>,
    /// Minimum fused/reranked score for a chunk to be kept.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_score: Option<f64>,
    /// Glob patterns to include when indexing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include: Option<Vec<String>>,
    /// Glob patterns to exclude when indexing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude: Option<Vec<String>>,
    /// Whether the incremental indexer watches the filesystem for changes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub watch: Option<bool>,
}

/// `[llama]` — local `aphrody-llama-server` supervisor configuration.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct LlamaConfig {
    /// How long an idle managed `llama-server` stays resident before the
    /// supervisor shuts it down, expressed as a duration string (e.g.
    /// `"5m"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_alive: Option<String>,
    /// Context size, in tokens, passed to `llama-server --ctx-size`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ctx: Option<u32>,
    /// Path to a `LoRA` adapter (GGUF) to load without applying, for hot-swap
    /// via `POST /lora-adapters`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lora: Option<String>,
    /// Extra raw arguments appended verbatim to the `llama-server` command
    /// line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_args: Option<Vec<String>>,
    /// Directory to search for the `llama-server` binary before `PATH`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_dir: Option<String>,
}

/// `[train]` — training surface configuration (P10, feature `train`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrainConfig {
    /// Path to the shared Python uv workspace, if not the `py/` directory
    /// of the checkout.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub python_project: Option<String>,
    /// Directory where trained artifacts (ONNX, GGUF, event logs) are
    /// written.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_dir: Option<String>,
}

/// `[compat]` — opt-in interoperability with an existing `~/.codex` install.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompatConfig {
    /// When `true`, an explicit `~/.codex/config.toml` layer is read and
    /// restricted to `mcp_servers` + `model_providers` (see
    /// [`crate::layer::restrict_codex_layer`]). Defaults to `false`:
    /// `~/.codex/config.toml` is never layered implicitly.
    #[serde(default)]
    pub read_codex_home: bool,
}

/// Target environment for the `computer` tool (P5b, feature `computer-use`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ComputerUseEnvironment {
    /// Native Windows desktop automation via `winclean` in-process.
    Windows,
    /// A controlled browser session via bxc's `browser_*` tools.
    Browser,
    /// Linux X11 automation via `x11rb`.
    Linux,
    /// Windows Subsystem for Linux (WSL) automation via `wsl_execute`.
    Wsl,
    /// Remote native Windows automation on an administrator's PC (e.g. via `WireGuard` peer).
    RemoteWindows,
    /// Remote WSL automation on an administrator's PC.
    RemoteWsl,
    /// Any RFB (VNC) server: `remote_host` is a tunnel member, `host[:port]` or `vnc://` URL.
    RemoteVnc,
}

/// `[computer_use]` — computer-use tool configuration.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComputerUseConfig {
    /// Master on/off switch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// Application allow-list. An app not in this list (when non-empty) is
    /// denied outright — the no-approval replacement for Codex's per-app
    /// human confirmation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allowed_apps: Option<Vec<String>>,
    /// Application deny-list, always enforced regardless of `allowed_apps`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub denied_apps: Option<Vec<String>>,
    /// Target environment/backend.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub environment: Option<ComputerUseEnvironment>,
    /// Optional remote administrator target host or IP (e.g. "omar", "10.200.77.10").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_host: Option<String>,
    /// Optional WSL distribution name when targeting WSL (e.g. "Ubuntu-24.04").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wsl_distribution: Option<String>,
    /// Optional custom remote endpoint override (e.g. `http://10.200.77.10:8793/mcp`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
}

#[cfg(test)]
#[path = "rag_tests.rs"]
mod rag_tests;

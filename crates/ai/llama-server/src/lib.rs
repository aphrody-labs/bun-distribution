// SPDX-License-Identifier: Apache-2.0
//! `aphrody-llama-server` — managed local inference on llama.cpp.
//!
//! llama.cpp is **driven, never linked** (CLAUDE.md §7): this crate supervises
//! the upstream `llama-server` binary and hands the rest of aphrody an
//! OpenAI-compatible endpoint on the loopback interface.
//!
//! The pieces, in the order a launch goes through them:
//!
//! 1. [`ModelFacts`] — what the GGUF file says (architecture, blocks, heads, experts, trained
//!    context), hence what the weights and the KV cache cost.
//! 2. [`ServerCapabilities`] — what the installed build supports, read from its own `--help`, so
//!    the command line only ever carries flags that build documents.
//! 3. [`plan`] — aphrody decides what the task needs (context, KV precision, adapters); placement
//!    is left to the runtime when it can fit itself (`--fit`), computed here otherwise.
//! 4. [`Supervisor::ensure`] — attach to the running instance with the same spec fingerprint, or
//!    start a detached [`daemon`] that owns the server, holds the GPU lease and shuts down after
//!    the keep-alive period.
//! 5. [`ServerClient`] — health, exact token counts, LoRA hot-swap, server properties.
//!
//! 6. [`provision_chat`] / [`launch_chat`] — the end-to-end local chat model of a desktop
//!    application (base GGUF + LoRA adapters in a caller-owned directory), also reachable as
//!    the JSON command line `aphrody llama provision|serve|status|stop` ([`chat_cli_main`]).
//!
//! Host-only: the crate spawns processes and is not part of the wasm matrix.

mod backend;
mod caps;
mod chat_cli;
mod cli;
mod client;
pub mod daemon;
mod ensure;
mod facts;
#[cfg(feature = "in-process")]
pub mod in_process;
mod local_chat;
mod managed;
mod plan;
pub mod router;
mod spec;
mod state;
mod supervisor;

#[cfg(feature = "in-process")]
pub use in_process::{InProcessLlama, InProcessServer, LlamaLoadError};

pub use backend::{BACKEND_ENV, BackendError, InferenceBackend};
pub use caps::{CapabilityError, FlashAttnSyntax, ServerCapabilities};
pub use chat_cli::chat_cli_main;
pub use cli::cli_main;
pub use client::{ClientError, Health, LoraStatus, ServerClient};
pub use ensure::{
    DEFAULT_LMSTUDIO_ENDPOINT, DEFAULT_LMSTUDIO_MODEL, DEFAULT_OLLAMA_ENDPOINT,
    DEFAULT_OLLAMA_MODEL, DEFAULT_OSS_MODEL, DEFAULT_VLLM_ENDPOINT, OssReadyError, OssReadyOptions,
    OssReadyOutcome, ensure_oss_ready,
};
pub use facts::{FactsError, KvQuant, ModelFacts};
pub use local_chat::{
    ArtifactSpec, ChatEndpoint, ChatLaunchOptions, ChatProvisionRequest, DEFAULT_CHAT_MODEL,
    LoraSpec, ProvisionProgress, ProvisionedArtifact, ProvisionedChat, chat_present, launch_chat,
    locate_llama_server, provision_chat,
};
pub use managed::{
    DEFAULT_EMBED_MODEL, DEFAULT_RERANK_MODEL, ManagedCategory, ManagedEndpoint, ManagedError,
    ManagedLaunchOptions, ManagedLlamaServer, ManagedRequest, PreparedManagedModel,
};
pub use plan::{
    Budget, DEFAULT_CHAT_CTX, DEFAULT_ENCODER_CTX, DEFAULT_MARGIN_MIB, Plan, PlanRequest, plan,
};
pub use spec::{LlamaServerSpec, LoraAdapter, Placement, Role};
pub use state::{RunState, StateDirs, discover_running};
pub use supervisor::{
    DEFAULT_KEEP_ALIVE, DEFAULT_LEASE_TIMEOUT, DEFAULT_READY_TIMEOUT, DaemonCommand, Endpoint,
    EnsureOptions, Supervisor, SupervisorError,
};

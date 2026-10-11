// SPDX-License-Identifier: Apache-2.0
#![forbid(unsafe_code)]
#![warn(clippy::pedantic)]
//! `aphrody-config` — the Codex-compatible `config.toml` model for aphrody.
//!
//! Ports the *shape* (not the implementation) of `openai/codex`
//! `codex-rs/config/src/config_toml.rs` (`ConfigToml`),
//! `codex-rs/model-provider-info/src/lib.rs` (`ModelProviderInfo`,
//! `WireApi`, `built_in_model_providers`, `create_oss_provider`),
//! `codex-rs/protocol/src/protocol.rs` (`AskForApproval`),
//! `codex-rs/protocol/src/config_types.rs` (`SandboxMode`), and the `-c
//! key=value` override parsing in `codex-rs/utils/cli/src/config_override.rs`
//! and `codex-rs/config/src/overrides.rs`, all Apache-2.0. Every module that
//! ports upstream shape cites the specific file it mirrors and documents
//! where aphrody deliberately diverges (see `docs/plans/codex-oss.md`, P1
//! and "Cross-cutting rules", and CLAUDE.md's No-Human-In-The-Loop doctrine,
//! §0.1).
//!
//! # Layout
//!
//! - [`ai_env`] — the canonical `APHRODY_AI_*` environment variable names (and their
//!   legacy aliases) that name aphrody's local/open-source AI stack; mirrors
//!   `tools/config/local-ai.json`.
//! - [`wire_api`] / [`policy`] — the small serde enums (`WireApi`, `AskForApproval`,
//!   `SandboxMode`).
//! - [`provider`] — [`provider::ModelProviderInfo`] and the built-in provider catalog
//!   ([`provider::builtin_providers`]).
//! - [`mcp`] — `[mcp_servers.*]`.
//! - [`rag`] — aphrody's extension tables (`[rag]`, `[llama]`, `[train]`, `[compat]`,
//!   `[computer_use]`); Codex has no equivalent for any of these.
//! - [`profile`] — `[profiles.*]`.
//! - [`config_toml`] — [`config_toml::ConfigToml`] itself, the top-level deserialization target,
//!   plus [`config_toml::ConfigWarning`].
//! - [`layer`] — [`layer::ConfigLayer`] / [`layer::merge_layers`] /
//!   [`layer::restrict_codex_layer`]: the pure layering primitives.
//! - [`overrides`] — `-c key=value` parsing ([`overrides::parse_override`]) and application
//!   ([`overrides::apply_override`]).
//! - [`resolve`] — [`resolve::resolve`], the entry point that turns a layer stack plus CLI flags
//!   into an effective [`resolve::Config`].
//! - [`load`] (host-only, `#[cfg(not(target_arch = "wasm32"))]`) — filesystem reads. Everything
//!   else in this crate is pure and compiles for `wasm32-unknown-unknown`.
//!
//! # Example
//!
//! ```
//! use std::collections::BTreeMap;
//!
//! use aphrody_config::{
//!     CliOverrides, ConfigLayer, LayerSource, builtin_providers_layer_value, resolve,
//! };
//!
//! let env = |_: &str| None;
//! let builtins = ConfigLayer::new(LayerSource::Builtin, builtin_providers_layer_value(&env));
//! let (config, warnings) =
//!     resolve(vec![builtins], &CliOverrides::default(), "llama", &BTreeMap::new())
//!         .expect("resolve");
//!
//! assert!(warnings.is_empty());
//! assert_eq!(config.provider.id, "llama");
//! ```

pub mod ai_env;
pub mod config_toml;
#[cfg(not(target_arch = "wasm32"))]
pub mod credential_file;
pub mod home_agent;
pub mod layer;
pub mod mcp;
pub mod overrides;
pub mod policy;
pub mod profile;
pub mod provider;
pub mod rag;
pub mod resolve;
pub mod wire_api;

#[cfg(not(target_arch = "wasm32"))]
pub mod load;

pub use config_toml::{
    ConfigToml, ConfigWarning, DEFAULT_PROJECT_DOC_MAX_BYTES, HistoryConfig, SandboxWorkspaceWrite,
    ShellEnvironmentPolicy,
};
pub use home_agent::{
    A2aConfig, AgentHomeConfig, DatabaseCache, DatabaseConfig, DatabaseType, OcrConfig, OcrEngine,
    PluginConfig, RedisConfig, SkillsConfig,
};
pub use layer::{ConfigLayer, LayerSource, merge_layers, merge_toml_values, restrict_codex_layer};
#[cfg(not(target_arch = "wasm32"))]
pub use load::{
    LoadError, load_codex_compat_layer, load_project_layer, load_toml_file, load_user_layer,
};
pub use mcp::{McpServerConfig, McpServerTransportConfig};
pub use overrides::{OverrideError, apply_override, parse_override};
pub use policy::{AskForApproval, SandboxMode};
pub use profile::ConfigProfile;
pub use provider::{
    DEFAULT_REQUEST_MAX_RETRIES, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_STREAM_MAX_RETRIES,
    ManagedRuntime, ModelProviderInfo, builtin_providers, builtin_providers_layer_value,
};
pub use rag::{
    AutoContext, CompatConfig, ComputerUseConfig, ComputerUseEnvironment, EmbedBackend,
    LlamaConfig, RagConfig, RagMode, TrainConfig,
};
pub use resolve::{CliOverrides, Config, ConfigError, ResolvedProvider, resolve};
pub use wire_api::WireApi;

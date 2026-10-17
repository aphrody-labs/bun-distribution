// SPDX-License-Identifier: Apache-2.0
//! Concrete [`ToolExecutor`](aphrody_toolcall::ToolExecutor)s for the aphrody
//! agent engine.
//!
//! These are the real, production capabilities the engine's
//! [`ToolRegistry`](aphrody_toolcall::ToolRegistry) exposes to the model:
//!
//! - [`ShellExecTool`] — runs a command (argv form, no shell parsing) with a configurable timeout
//!   and output cap, capturing the combined stdout/stderr stream and exit code. Optionally streams
//!   output chunks to a sink so the engine can emit
//!   [`EventMsg::ExecCommandOutputDelta`](aphrody_agent_proto::EventMsg::ExecCommandOutputDelta)
//!   events live.
//! - [`ApplyPatchTool`] — parses an `*** Begin Patch ... *** End Patch` document via
//!   [`aphrody_patch::parse_patch`] and applies it through a pluggable
//!   [`PatchFileSystem`](aphrody_patch::PatchFileSystem) (real disk by default, injectable for
//!   tests).
//!
//! - [`WincleanTool`] / [`WincleanGatewayTool`] — native Windows computer use and OS control
//!   through the in-process `aphrody-winclean` crate (166 tools, see [`winclean_tools`]).
//!
//! # Safety posture
//!
//! Per the aphrody autonomy contract, both tools are **permissive by default**:
//! no path jailing, and no command refusal unless explicitly opted in. The
//! [`ShellExecTool`] consults [`aphrody_guard`] command-safety as an **opt-in**
//! backstop: only when `APHRODY_GUARD` is enabled does it refuse a
//! provably-destructive command ([`Decision::Forbidden`](aphrody_guard::Decision::Forbidden)
//! — `rm -rf /`, `git push --force`, a fork bomb, …) before spawning. With the
//! guard off (the default), behaviour is unchanged: every command runs, so a
//! fully-autonomous agent is never impeded. `Allow`/`Prompt` commands always run;
//! only the known-destructive class is hard-blocked. Resource guardrails
//! (timeout / output cap) remain configurable via the builder.

mod apply_patch;
#[cfg(not(target_arch = "wasm32"))]
mod computer_use;
mod jev;
#[cfg(not(target_arch = "wasm32"))]
mod read_file;
#[cfg(not(target_arch = "wasm32"))]
mod search_text;
#[cfg(not(target_arch = "wasm32"))]
mod shell;
#[cfg(not(target_arch = "wasm32"))]
#[path = "web_tools.rs"]
mod web_tools;
#[cfg(not(target_arch = "wasm32"))]
mod winclean;

pub use apply_patch::ApplyPatchTool;
#[cfg(not(target_arch = "wasm32"))]
pub use computer_use::{
    BrowserComputerBackend, ComputerAction, ComputerBackend, ComputerEnvironment, ComputerPolicy,
    ComputerTool, ComputerUseTool, MockComputerBackend, RemoteComputerBackend, RemoteComputerMode,
    RemoteComputerTarget, UnsupportedComputerBackend, VncComputerBackend, WindowsComputerBackend,
    WslComputerBackend,
};
pub use jev::{JEV_TOOL, JevDecideTool};
#[cfg(not(target_arch = "wasm32"))]
pub use read_file::ReadFileTool;
#[cfg(not(target_arch = "wasm32"))]
pub use search_text::SearchTextTool;
#[cfg(not(target_arch = "wasm32"))]
pub use shell::{
    DEFAULT_MAX_OUTPUT_BYTES, DEFAULT_TIMEOUT, OutputSink, ShellExecConfig, ShellExecTool,
};
#[cfg(not(target_arch = "wasm32"))]
pub use web_tools::{
    GoogleAiArgs, GoogleAiTool, JsEvalArgs, JsEvalTool, WebScrapeArgs, WebScrapeTool,
    WebSearchArgs, WebSearchTool,
};
#[cfg(not(target_arch = "wasm32"))]
pub use winclean::{
    WINCLEAN_DIRECT_TOOLS, WINCLEAN_GATEWAY, WincleanGatewayTool, WincleanTool, winclean_tools,
};

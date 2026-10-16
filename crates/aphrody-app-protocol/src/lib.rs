// SPDX-License-Identifier: Apache-2.0
//! # aphrody-app-protocol — Codex app-server v2 protocol types
//!
//! Pure, wasm32-safe wire protocol implementation for the OpenAI Codex app-server v2
//! JSON-RPC dialect (Phase P7, `docs/plans/codex-oss.md`).
//!
//! ## Protocol invariants:
//! - "We do not do true JSON-RPC 2.0, as we neither send nor expect the 'jsonrpc': '2.0' field."
//! - Tolerates optional "jsonrpc" on input, never emits it on outbound frames.
//! - String and Integer RequestIds supported.
//! - Tier-1 method coverage: `initialize`, `thread/*`, `turn/*`, `model/*`, `config/*`,
//!   `account/*`, `mcpServerStatus/*`, `tools/list`, `notifications/drain`, `shutdown`,
//!   and streaming notifications. `command/exec*` was removed from the contract: it was
//!   never implemented anywhere and is tracked as a future greenfield PTY-exec effort,
//!   not stubbed here (`docs/API.md` §3.3).
//! - Extensible via `aphrody/*` when client declares `capabilities.aphrody`.

#![deny(unsafe_code)]
#![warn(clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]
#![allow(clippy::doc_markdown)]
#![allow(clippy::wildcard_imports)]

pub mod client_request;
pub mod rpc;
pub mod server_notification;
pub mod server_request;
pub mod types;

pub use client_request::ClientRequest;
pub use rpc::{
    JSONRPC_VERSION, JSONRPCError, JSONRPCErrorError, JSONRPCMessage, JSONRPCNotification,
    JSONRPCRequest, JSONRPCResponse, RequestId,
};
pub use server_notification::ServerNotification;
pub use server_request::ServerRequest;
pub use types::*;

// SPDX-License-Identifier: Apache-2.0
//! Google (Gemini) surface of the Aphrody MCP server.
//!
//! - [`gemini_tools`]: the `gemini_*` MCP tools over the Gemini web app.
//! - [`shenron_gemini_web`]: Gemini Web as a chat backend of the Shenron HTTP API.
//!
//! Host-only: the Gemini web client needs a cookie file and a network stack.
#![cfg(not(target_arch = "wasm32"))]

pub mod gemini_tools;
pub mod shenron_gemini_web;

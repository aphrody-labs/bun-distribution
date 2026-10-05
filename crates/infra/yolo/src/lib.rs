// SPDX-License-Identifier: Apache-2.0
//! Native Yolo repository engine modules.
#![forbid(unsafe_code)]

pub mod cli;
// The repository mapper and polyglot detector have one owner: yolo-core (feature `repository-tools`).
pub use yolo_core::{mapper, polyglot};

pub use cli::cli_main;

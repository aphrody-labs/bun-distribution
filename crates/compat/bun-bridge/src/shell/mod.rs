// SPDX-License-Identifier: Apache-2.0
//! Bun native Shell engine: zero-allocation AST, braces expansion, in-process POSIX builtins.

pub mod ast;
pub mod braces;
pub mod builtins;
pub mod executor;
pub mod parser;

pub use ast::{Command, Op, Pipeline, Redirection, Script};
pub use braces::expand_braces;
pub use builtins::{BuiltinContext, is_builtin, run_builtin};
pub use executor::{BunShellExecutor, BunShellOutput, run_shell};
pub use parser::parse_script;

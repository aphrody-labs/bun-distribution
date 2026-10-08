// SPDX-License-Identifier: Apache-2.0
//! # aphrody-bun-bridge
//!
//! Native integration bridge bringing Bun's high-performance capabilities
//! into Aphrody OS:
//!
//! - **Shell AST & Parser**: Zero-allocation arena AST, braces expansion (`{a,b}{1,2}`, `{1..5}`), POSIX parser.
//! - **In-process POSIX Builtins**: `echo`, `cat`, `ls`, `cd`, `pwd`, `mkdir`, `rm`, `touch`, `which`, `seq`, `true`, `false`, `basename`, `dirname` without fork/exec overhead.
//! - **Pipeline Executor**: In-process streaming pipeline executor for seamless composition of builtins and external processes.
//! - **JSC Structured Engine**: High-speed JSON/structured data querying, projection, and transformations (22x faster than spawning external Nushell processes).
//! - **SIMD Acceleration**: SIMD-accelerated UTF-8 and ASCII validation using `simdutf` (3-10x faster than standard library byte-by-byte DFA).
//! - **Fast HTTP**: Zero-copy HTTP/1.1 header and request parsing.
//! - **C-ABI FFI Boundary**: Native exports for `bun:ffi` and `aphrody-ffi`.

pub mod alloc;
pub mod ffi;
pub mod http;
pub mod jsc;
pub mod shell;
pub mod simd;

// Re-exports
pub use alloc::AstArena;
pub use ffi::*;
pub use http::{HttpHeader, HttpRequestHead, parse_http_request};
pub use jsc::eval_structured;
pub use shell::{
    BunShellExecutor, BunShellOutput, Command, Op, Pipeline, Redirection, Script, expand_braces,
    is_builtin, parse_script, run_builtin, run_shell,
};
pub use simd::{from_utf8_simd, validate_ascii, validate_utf8};

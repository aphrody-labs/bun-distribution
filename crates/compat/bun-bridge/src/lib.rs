// SPDX-License-Identifier: Apache-2.0
//! # aphrody-bun-bridge
//!
//! Comprehensive native integration bridge bringing Bun's full-spectrum capabilities
//! into Aphrody OS:
//!
//! - **Shell AST & Parser**: Zero-allocation arena AST, braces expansion (`{a,b}{1,2}`, `{1..5}`), POSIX parser.
//! - **In-process POSIX Builtins**: `echo`, `cat`, `ls`, `cd`, `pwd`, `mkdir`, `rm`, `touch`, `which`, `seq`, `true`, `false`, `basename`, `dirname` without fork/exec overhead.
//! - **Pipeline Executor**: In-process streaming pipeline executor for seamless composition of builtins and external processes.
//! - **JSC Structured Engine**: High-speed JSON/structured data querying, projection, and transformations (22x faster than spawning external Nushell processes).
//! - **SIMD Acceleration**: SIMD-accelerated UTF-8 and ASCII validation using `simdutf` (3-10x faster than standard library byte-by-byte DFA).
//! - **WyHash & High-Speed Hashing**: Bun's native 64-bit WyHash algorithm (`bun.hash()`), FNV-1a, and Murmur3.
//! - **Native DotEnv**: Variable expansion (`${VAR}`, `${VAR:-default}`), quotes, and multiline parsing (`thirdparty/dotenv`).
//! - **Radix Tree URL Router**: High-throughput URL route resolution with parameter extraction (`:param`) and wildcards (`*path`).
//! - **SemVer Engine**: Semantic version parsing and constraint matching (`^`, `~`, ranges).
//! - **Glob Matcher**: Fast filesystem and path pattern matching (`*`, `**`, `[a-z]`, `!negation`).
//! - **Valkey / Redis RESP**: Zero-copy RESP2/RESP3 protocol parser and serializer (`bun_valkey` / `Bun.redis`).
//! - **Fast Base64**: Standard and URL-safe Base64 encode and decode (`bun_base64`).
//! - **Fast HTTP**: Zero-copy HTTP/1.1 header and request parsing (`bun_picohttp`).
//! - **C-ABI FFI Boundary**: Native exports for `bun:ffi` and `aphrody-ffi`.

pub mod alloc;
pub mod base64;
pub mod dotenv;
pub mod ffi;
pub mod glob;
pub mod hash;
pub mod http;
pub mod jsc;
pub mod router;
pub mod semver;
pub mod shell;
pub mod simd;
pub mod valkey;

// Re-exports
pub use alloc::AstArena;
pub use base64::{decode as base64_decode, decode_url_safe as base64_decode_url_safe, encode as base64_encode, encode_url_safe as base64_encode_url_safe};
pub use dotenv::parse_dotenv;
pub use ffi::*;
pub use glob::GlobMatcher;
pub use hash::{fnv1a, murmur3_32, wyhash};
pub use http::{HttpHeader, HttpRequestHead, parse_http_request};
pub use jsc::eval_structured;
pub use router::{RouteMatch, Router};
pub use semver::{Version, VersionReq};
pub use shell::{
    BunShellExecutor, BunShellOutput, Command, Op, Pipeline, Redirection, Script, expand_braces,
    is_builtin, parse_script, run_builtin, run_shell,
};
pub use simd::{from_utf8_simd, validate_ascii, validate_utf8};
pub use valkey::{encode_command as valkey_encode_command, parse_resp as valkey_parse_resp, RespError, RespValue};

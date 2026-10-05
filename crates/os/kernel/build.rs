// SPDX-License-Identifier: Apache-2.0
//! Link settings for binaries of this package. The kernel is now a library reached through the
//! `aphrody` multi-call binary: the final executable (`apps/cli`) must pass `/OPT:NOICF` itself.
//!
//! The kernel embeds V8 through the browser subsystem (`aphrody-browser` -> Obscura ->
//! `deno_core`). On MSVC, rustc links optimized builds with `/OPT:REF,ICF`; identical COMDAT
//! folding merges distinct V8 external references and V8 aborts at startup with
//! `Check failed: table->address(index) == table->address(encoded_index)`. `/OPT:NOICF`, passed
//! after rustc's own arguments, keeps `/OPT:REF` and turns folding off for the binary only, so no
//! global rustflags (and no full-graph rebuild) are needed.

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_env == "msvc" {
        println!("cargo:rustc-link-arg-bins=/OPT:NOICF");
    }
}

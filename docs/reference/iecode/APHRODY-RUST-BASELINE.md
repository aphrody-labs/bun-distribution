# Aphrody Rust baseline for IECODE

Checked on 2026-09-29 against the existing Aphrody category manifests and
NIE's Cargo workspace. The new Aphrody monorepo now stages a copy of Infra's
`@aphrody/workspace`, validated by its typecheck, tests and IECODE doctor; its
clean-clone and publication gates are not yet qualified. Old `src/` manifests are comparison inputs, not new
package owners.

## Adopted baseline

| Policy | IECODE decision | Aphrody evidence |
| --- | --- | --- |
| Compiler | Stable `1.98.1`, same components and targets as Infra | `../src/aphrody-infra/rust-toolchain.toml`; AI, OS, Native and Contracts pin the same channel |
| Language | Rust 2024, resolver 3, MSRV 1.97 | Sibling root `Cargo.toml` files |
| Formatting | Shared stable-only `rustfmt.toml`; `cargo fmt --all --check` | `../src/aphrody-ai/rustfmt.toml`, `../src/aphrody-native/rustfmt.toml` |
| Dependency ownership | One `[workspace.dependencies]`, members inherit versions; enable only consumed features | Sibling root manifests |
| Safety | Deny unsafe operations in unsafe functions and unused must-use values; Clippy errors in gates | Sibling workspace lints and gates |
| Distribution | Preserve each upstream SPDX/license and track effective combined GPL terms | `LICENSES.md` and source notices |

IECODE's common dependency families already overlap Aphrody's: `anyhow` 1,
`clap` 4, `goblin` 0.10, `hex` 0.4, `iced-x86` 1.21, `rustls` 0.23,
`serde` 1, `serde_json` 1, `thiserror` 2, `tokio` 1, `uuid` 1 and
`zerocopy` 0.8. Feature sets differ by consumer and must not be widened just
to make manifests textually identical. Aphrody OS/AI currently request
`rusqlite` 0.40; IECODE and NIE now both declare 0.40 and their separate
lockfiles resolve 0.40.2. The active IECODE workspace has 11 members, including
the private `iecode-ievr-data` crate; its `serde`/`serde_json` declarations
match NIE's major version and preserve their narrow feature sets.

The isolated IECODE Cryoglyph and Iced fork manifests now pin `wgpu` exactly
to NIE's `29.0.3`; Gecko's imported lockfile already resolves 29.0.3.
Cryoglyph's local check passes, and Iced's manifest parses with its existing
29.0.3 lock. Dust remains on wgpu 23 and is not silently retargeted: that
requires an actual GPU API port and boot/render fixtures. Iced's development
`glam` 0.25 also differs from NIE's 0.32; it is not shared with an IECODE
public type. Bevy and the other upstream fork workspaces remain isolated.

For new emulation code, first look for a compatible Aphrody-owned Rust crate
and use a versioned dependency/API instead of copying its source. IECODE is the
integration sandbox: only a measured foreign emulator fork is trialed under an
IECODE name, with source revision, license, GUI removal, native ABI and legal
boot test recorded before claiming integration. Stable, deduplicated Rust code
is promoted to the appropriate Aphrody repository with tests and provenance;
game-engine extensions are developed directly in the separate Bevy fork.

## Gate after each dependency batch

```sh
cargo fmt --all --check
cargo check --workspace --tests --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo nextest run --workspace --locked
bun run doctor
git diff --check
```

On 2026-09-29 the IECODE workspace's formatter, locked check and Clippy
`-D warnings` pass after the IEVR data extraction. The locked offline Rust
test run reports 1,516 passed and 1 ignored across 129 suites. NIE's
`nie-ocgen` consumer compiles against the extracted crate, while `nie-core`
remains blocked by three missing game-derived JSON files. IECODE now calls
the new Infra workspace through its thin `scripts/aphrody-ops.ts` binding;
the transitional source checkout remains until the new monorepo passes its
clean-clone and publication gates.

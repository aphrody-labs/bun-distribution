<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Bun platform

This is the cross-repository map and integration plan for using Bun as an
Aphrody runtime and native platform. Repository ownership remains authoritative:
Infra maps the system; each owner repository keeps its source, ABI and release.
The generated [ecosystem catalogue](./ecosystem/ECOSYSTEM.md) is the full inventory
of crates and Bun packages; this page records the Bun-related subset and how it
fits together.

## Current ownership map

| Capability | Owner and source | Existing interface and consumers |
| --- | --- | --- |
| Bun runtime and package manager | [`bun/`](../../bun/), Aphrody remote `aphrody-code/bun`, upstream `oven-sh/bun`; Bun uses Rust and C++/JavaScriptCore | Runtime, bundler, test runner, package manager, shell, HTTP, SQL, SQLite and Web APIs. Aphrody `main` now includes `bun:aphrody`; its Linux debug build and eight focused checks pass. The [fork guide](../upstream-bun/APHRODY-FORK.md) owns contribution and upstream sync. |
| Bun/Node runtime discovery | [`aphrody-toolchains`](../../aphrody-compat/crates/aphrody-toolchains/) | Resolves installed Bun, repository pins and launch environment without a shell. Compat owns the crate; OS consumes it through a path dependency. |
| Node-to-Bun migration | [`aphrody-compat/crates/aphrody-n2b*`](../../aphrody-compat/crates/) | Eleven Rust crates cover scanners, registries, rules, CLI, reports, AI enrichment, GitHub audit, shared types and native ABI. The [current surface inventory](../compat/n2b/BUN-SURFACE.md) lists all crates, packages, schemas and CLI arguments. |
| Bun-facing N2B packages | [`aphrody-compat/packages/n2b*`](../../aphrody-compat/packages/) | `@aphrody/n2b-core` invokes the Rust CLI; `@aphrody/n2b-plugin` registers a `Bun.plugin()` build-time plugin that prefers the fork's native scanner and falls back to the CLI. Shims and generated report types are separate packages. |
| N2B native helper | [`aphrody-n2b-native`](../../aphrody-compat/crates/aphrody-n2b-native/) | ABI v2 exposes UTF-16 newline offsets, read-only scan and scan options (`mode`, `ignore`, `dry_run`) with an owned JSON v2 report. The Bun fork binds it through `bun:ffi`; it remains a separate library. |
| Oxc toolchain | [`oxc/`](../../oxc/) | Aphrody `main` merges Oxc upstream at `0.152.0` and adds `aphrody-oxc-bridge` for in-process JS/TS format, minify and lint. Bun loads this bridge via `bun:ffi`. N2B rules now pin the fork commit `3369b5f993a5eb889c14e4a0efe9e258664c4ef5` for five Oxc crates. |
| Offline Bun knowledge | [`aphrody-bun-docs`](../../aphrody-compat/crates/aphrody-bun-docs/) and Compat [`docs/n2b/bun/`](../../aphrody-compat/docs/n2b/bun/) | OS kernel tools search/read Bun docs and look up Node equivalents in the N2B registry. Bun docs source is the Compat submodule, separate from `bun/`. |
| Aphrody runtime FFI | [`aphrody-ffi`](../../aphrody-ai/crates/aphrody-ffi/) | Cross-platform C ABI loads Aphrody's Rust CLI in-process from Bun using `bun:ffi` (or another C host); currently a dynamic library, not linked into Bun. |
| UI native Rust library | [`aphrody-bun`](../../aphrody-ui/crates/aphrody-bun/) and UI `@aphrody/bun` | `bun:ffi` bindings for M3 token/color operations, Sass, validation, SVG/icons and rendering. UI owns this crate and package. |
| Web crawling (optional) | [`@aphrody/bxc`](../../aphrody-web/apps/bxc/) and [`aphrody-web-ffi`](../../aphrody-web/crates/aphrody-web-ffi/) | Existing Bun crawler and Rust FFI remain in Web. BXC is excluded from `bun:aphrody`; the planned `aphrody-web` Rust port is the direction for future central integration. |
| Browser engine | [`obscura`](../../aphrody-web/crates/aphrody-obscura/) workspace | Rust browser/framework implementation with its own `obscura-js`, DOM, network, CDP and render crates. It is a separate engine today; no in-process Bun/JSC integration is established. |
| BXC crawl helpers and consumers | [`shenron`](../../shenron/) and [`rg`](../../rg/) | Bun scripts and services call BXC for crawl/index workflows. They consume BXC as a package/process boundary; they do not add Bun runtime internals. |

## Rust and N-API code in the Bun fork

The following names come from the fork's checked-in manifests, not from a
generic description of Bun or an assumed Rust rewrite:

| Manifest | Actual package or crate | Boundary |
| --- | --- | --- |
| [`packages/bun-native-plugin-rs/Cargo.toml`](../../bun/packages/bun-native-plugin-rs/Cargo.toml) | `bun-native-plugin` v0.2.0 | Experimental Rust wrapper for Bun's native **bundler** plugin C API; its documented hook is `onBeforeParse`. |
| [`packages/bun-native-plugin-rs/bun-macro/Cargo.toml`](../../bun/packages/bun-native-plugin-rs/bun-macro/Cargo.toml) | `bun-macro` v0.1.0 | Procedural macro used by `bun-native-plugin`; depends on `napi`. |
| [`packages/bun-build-mdx-rs/Cargo.toml`](../../bun/packages/bun-build-mdx-rs/Cargo.toml) | `bun-mdx-rs` v0.0.0 | MDX N-API `cdylib` that depends on `bun-native-plugin`; its package manifest also names `bun-mdx-rs`. |
| [`bench/ffi/src/Cargo.toml`](../../bun/bench/ffi/src/Cargo.toml) | `ffi_napi_bench` | FFI/N-API benchmark fixture, not a shipped Aphrody runtime API. |

No manifest named `bun-rs`, `rs-bun` or `bunffi` appeared in the checked-in
Cargo or package manifests of the Bun fork or the inspected Aphrody owner
repositories. These names should not be treated as existing dependencies until
a manifest or source path establishes them. Bun's current source uses Rust,
C++ and JavaScriptCore; a full-Rust rewrite is not established by these files.

## `bun:aphrody` dynamic-library contract

The fork's [`bun:aphrody` source](../../bun/src/js/bun/aphrody.ts) adds a
built-in module that lazily opens these separately built libraries. The library
path may be set explicitly or the module probes the directory of the running
Bun executable. Every owned string is copied before its library's free function
is called.

| Module functions | Owner library and ABI check | Explicit path | Verified runtime scope |
| --- | --- | --- | --- |
| `version`, `runCaptured` | `aphrody-ffi`, `aphrody_abi_version() == 1` | `APHRODY_FFI_LIB` | Linux x86-64 wrapper call returned `1.0.0-canary` and a successful captured `--version`; fork runtime pending. |
| `scanNodeProject` | `aphrody-n2b-native`, `node2bun_abi_version() == 2` | `N2B_NATIVE_LIB` | Compiled fork returned JSON report schema v2 through the native library with scan options. |
| `formatSource`, `minifySource`, `lintSource` | `aphrody-oxc-bridge`, `aphrody_oxc_abi_version() == 1` | `APHRODY_OXC_LIB` | Compiled fork formatted, compactly minified and linted JS through the native Oxc library. |

The Aphrody FFI wrapper call used installed Bun with public `bun:ffi`; the
N2B/Oxc calls above used the compiled fork. No cross-platform fork artifact or
OS selection of that artifact follows from these checks. Earlier BXC wrapper
experiments remain in Git history but are no longer part of `bun:aphrody`.

## What is integrated today

- Aphrody CLI, UI rendering, BXC native hot paths, N2B and Oxc have separate
  owner libraries. The Bun fork's `bun:aphrody` module binds Aphrody, N2B and
  Oxc functions through `bun:ffi`; focused debug-build checks pass on Linux.
- N2B runs as a Rust CLI and native scan library. Its Bun plugin checks sources
  during `Bun.build()` using the native scan when available; its shims cover
  selected Node APIs for migration work.
- `aphrody-bun-docs` exposes offline docs and Node-equivalent lookup to the OS
  kernel. The runtime itself is still discovered and launched as an external
  executable through `aphrody-toolchains`. The OS `runtime_resolve` source now
  probes the selected Bun binary for the static `bun:aphrody.moduleVersion`
  and reports `aphrody_module_version`; a missing or failed probe reports null.
  This records capability but does not yet select or install a fork artifact.
- Bun's repository contains `bun-native-plugin`, an experimental Rust/N-API
  **bundler transform hook** (`onBeforeParse`). This does not expose a general
  Rust runtime extension ABI or let an external crate register new `Bun.*`
  runtime APIs. `bun:ffi` and N-API are dynamic-library interfaces, not proof
  that a library is built into the Bun executable.

## Target architecture

Treat Bun as Aphrody's cross-platform JS/TS execution and packaging base. Keep
existing Aphrody Rust crates as owner libraries, and add a supported native
boundary that Bun can ship and invoke. Use these layers:

1. **Aphrody runtime facade:** an Aphrody-owned Bun package for runtime
   discovery, capability checks and access to the platform APIs already in Bun.
2. **Native capability modules:** versioned, narrow Rust ABIs for Aphrody,
   N2B and Oxc functionality, with explicit ownership, allocator, thread-safety,
   async, error and memory-lifetime rules. Prefer one process-wide host runtime
   and avoid redundant subprocesses where an owner API is available.
3. **Node compatibility:** retain N2B's static analysis and build plugin, then
   use its registry and observed incompatibilities to prioritize Bun runtime
   compatibility fixes. Each Node behavior change needs parity fixtures and
   upstream/fork tests; migration advice alone does not close runtime gaps.
4. **Web crawler:** keep the current BXC integration optional while Web is
   unstable. Reconsider central Bun integration after the `aphrody-web` Rust
   port has stable APIs and measured hot paths.
5. **Aphrody distribution:** pin the Aphrody Bun fork revision and build targets
   in Infra's release/toolchain catalogue. Produce reproducible Linux, macOS
   and Windows runtime artifacts, then let owner packages depend on those
   artifacts through documented ABI/package contracts.

Native runtime inclusion inside `bun` is a deeper option than `bun:ffi` or the
existing bundler plugin. It needs an explicit design for the Bun/JSC lifecycle,
Cargo dependency closure, allocator and panic boundaries, async/event-loop
integration, platform builds, licensing and upstream maintenance. Do not claim
  that Bun is Aphrody's own runtime until its fork builds and distributes that
  integration, and its artifact is the one the OS and applications actually run.

## Next work and acceptance evidence

1. Keep the [N2B surface inventory](../compat/n2b/BUN-SURFACE.md)
   aligned with manifests, CLI, schemas and Oxc API versions as canary branches move.
2. Evolve the capability set from `aphrody-ffi`, N2B and Oxc. Define a shared ABI/versioning and packaging contract
   without merging their ownership or linking unrelated application stacks.
3. Prototype the smallest end-to-end path in the Bun fork: launch one Aphrody
   operation from a Bun process with no per-call process spawn, then verify
   lifecycle, errors, repeated calls and all declared OS targets.
4. Add fork-level Node parity fixes only from concrete N2B findings and parity
   cases. Document unsupported Node surfaces and run the fork's debug build and
   relevant Node compatibility tests.
5. Extend the pinned N2B/Oxc migration beyond the tested AST and report cases,
   and define how Oxc format/lint/minify can participate in Bun's build and test
   workflows without duplicating Bun's own parser implementation.
6. Integrate Obscura only after choosing one direction (Bun hosts Obscura or
   Obscura hosts Bun) and demonstrating a small embedded-browser/runtime
   prototype; package/process interoperability is not native integration.

Completion evidence must include a populated ownership/API matrix, a pinned and
diverged Aphrody Bun fork with the selected native path built into its artifacts,
cross-platform builds, Node parity results, and consumer
proof from Aphrody OS plus at least one of AI/Web/UI. The `bun:aphrody` branch
is merged into Aphrody `main`; cross-platform artifact proof and
unified consumer validation remain open.

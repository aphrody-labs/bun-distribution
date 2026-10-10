<!-- SPDX-License-Identifier: Apache-2.0 -->
# Microsoft and uutils utility provenance

This document records the source-selection boundary for the headless
`aphrody-coreutils` subsystem. It prevents a Windows packaging layer from
silently becoming a second implementation of the same command contract.

## Core utilities

[`microsoft/coreutils`](https://github.com/microsoft/coreutils) is an active
MIT-licensed Windows package, but it is not an independent portable utility
implementation. Its own
[`CONTRIBUTING.md`](https://github.com/microsoft/coreutils/blob/main/CONTRIBUTING.md)
states that the implementations live in submodules: a Microsoft fork of
uutils/coreutils, uutils/findutils, and a fork of uutils/grep. Its
[`Cargo.toml`](https://github.com/microsoft/coreutils/blob/main/Cargo.toml)
also deliberately removes several commands and describes Windows-only extras.

Therefore Aphrody uses the pinned upstream uutils sources directly for the
portable command runtime. This gives Linux and Windows one upstream contract
and keeps a single place to accept behavior fixes. The Microsoft project is a
compatibility and packaging oracle for Windows only; it must not be linked,
vendored, or added as a competing runtime dependency.

The Microsoft package is useful as an interoperability test target on Windows:

- compare an explicitly selected command and arguments against the upstream
  uutils build;
- record a deliberate exception only when the Windows API makes the POSIX
  behavior unavailable;
- upstream portable fixes to the relevant uutils project before accepting a
  local compatibility patch.

This policy also avoids PowerShell command-name resolution conflicts. The
headless kernel executes the pinned multi-call binary directly, rather than
depending on aliases or `PATH` precedence.

## Microsoft Rust crates

The workspace already owns its Windows API boundary through the official
Apache-2.0 [`microsoft/windows-rs`](https://github.com/microsoft/windows-rs)
`windows` and `windows-sys` crates. They are the right broad bindings for the
existing Windows-only binary crates, with feature-gating at each call site.

No additional `windows-rs` crate is selected without a concrete owner and an
observed missing contract:

| Candidate | Decision | Reason |
| --- | --- | --- |
| `windows-registry` | Defer | A safe focused wrapper is attractive only after a targeted registry contract replaces an existing raw binding; importing it pre-emptively would duplicate `windows` access. |
| `windows-services` | Defer | It authors a Windows service process; service lifecycle and deployment are owned by `aphrody-infra`, and no new service is in scope. |
| `windows-threading` | Reject for current code | The OS workspace already uses Tokio. This Windows-only thread pool would create a second scheduling model without an identified blocking workload. |
| `windows-bindgen` | Defer | Use only when a required Windows API is absent from the published projection, and generate a minimal private binding. |
| UI crates (`windows-reactor`, `windows-webview`, `windows-canvas`) | Out of scope | Desktop and rendering belong to `aphrody-ui`, not the headless OS layer. |

The upstream crate guide makes the same distinction: use focused crates when a
specific contract exists, otherwise use `windows-bindgen` for a minimal private
binding or `windows`/`windows-sys` for binary applications. Each candidate
above is Windows-only; none improves Linux/Windows command parity by itself.

## Admission criteria

Before adding a Microsoft crate to the workspace, the owning Aphrody crate
must document all of the following:

1. the existing command or MCP contract it replaces or extends;
2. why the current `windows`/`windows-sys` projection cannot satisfy it;
3. a `cfg(windows)` boundary and a truthful non-Windows result;
4. a Windows runtime test in addition to Linux compilation; and
5. license, version, and feature selection in the workspace dependency table.

This keeps the coreutils API headless and portable while preserving native
Windows integration where it has a demonstrated system-level owner.

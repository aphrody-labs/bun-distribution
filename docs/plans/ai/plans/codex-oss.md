<!-- SPDX-License-Identifier: Apache-2.0 -->
# Codex OSS Integration & Absorption Plan

**Completed on 2026-10-09.** Codex OSS capabilities from [openai/codex](https://github.com/openai/codex) are absorbed into Aphrody's native architecture and backed by the private fork [aphrody-labs/codex](https://github.com/aphrody-labs/codex) (commit `bd274564e1b1b3febb3886d274e6d97c2a3d275e`).

The absorption mapping is canonically defined in [tools/config/codex-absorption.json](../../../../tools/config/codex-absorption.json) and tracked in [tools/config/upstream-sources.json](../../../../tools/config/upstream-sources.json). Detailed upstream attribution and interface parity are recorded in [THIRD_PARTY_CODEX.md](../../../reference/ai/THIRD_PARTY_CODEX.md).

## 1. Upstream Fork & Provenance
- **Upstream Repository**: `https://github.com/openai/codex` (Apache-2.0)
- **Private Fork**: `https://github.com/aphrody-labs/codex`
- **Observed Commit**: `bd274564e1b1b3febb3886d274e6d97c2a3d275e`
- **Policy**: Absorb capability interfaces and verified contracts into Aphrody capability owners; no duplicate runtimes or competing stacks.

## 2. Completed Absorption Matrix

| Capability Domain | Upstream Codex Reference | Aphrody Native Owner | Verification Status |
|---|---|---|---|
| **App-Server Protocol v2** | `codex-rs/app-server-protocol` | `crates/contracts/app-protocol` | **PASSED** (17 tests: JSON Schema fixtures, Tier-1 contracts, RPC serialization) |
| **App-Server Engine & Daemon** | `codex-rs/app-server`, `app-server-daemon` | `crates/ai/app-server` | **PASSED** (48 tests: stdio/HTTP loops, turns, threads, rollouts) |
| **Configuration & Model Profiles** | `codex-rs/config/src/config_toml.rs` | `crates/ai/config` | **PASSED** (TOML layer parsing, `gpt-6-sol` / `gpt-6-astra` resolution) |
| **Session Tracking & History** | `codex-rs/history`, `rollout` | `crates/ai/rollout`, `crates/ai/session` | **PASSED** (durable JSONL rollouts, external sync `codex.rs`) |
| **CLI & Process Execution** | `codex-cli`, `exec` | `crates/infra/aphrody`, `bin/codex.cmd` | **PASSED** (elevation-safe non-daemon wrapper, end-to-end execution) |
| **Python SDK Client** | `sdk/python/src/openai_codex` | `py/packages/aphrody/src/aphrody/agent.py` | **PASSED** (JSONL transport, turn/thread routing) |
| **Bun / TS Native Bridge** | `sdk/python/src/openai_codex` | `packages/interop/native/src/agent.ts` | **PASSED** (Bun subprocess streams, typed turn handles) |
| **Project Documentation** | `codex-rs/core/src/agents_md.rs` | `crates/ai/project-doc` | **PASSED** (hierarchical AGENTS.md parsing & character boundary truncation) |

## 3. Windows Elevation & Daemon Resolution
On Windows, Codex CLI upstream enforces a daemon elevation security boundary (`backend::windows::ensure_not_elevated()`). When invoked from an administrative shell, attempts to start the shared daemon return:
`Error: start the Windows daemon from a non-elevated terminal; shared clients must not inherit administrator privileges. To work without the background server, rerun the same command with --no-daemon.`

This is resolved transparently in Aphrody:
1. `bin/codex.cmd` and `%USERPROFILE%\.local\bin\codex.cmd`: inspects token elevation via `net session` and injects `--no-daemon` automatically when elevated.
2. `Microsoft.PowerShell_profile.ps1`: exports `global:codex` detecting `TokenElevation` and routing interactive and non-interactive calls seamlessly with zero latency.
3. Model configuration in `~/.codex/config.toml` aligned to verified ChatGPT account models (`gpt-6-sol`).

## 4. Live Verification Evidence
- `cargo test -p aphrody-app-protocol`: 17 passed, 0 failed.
- `cargo test -p aphrody-app-server`: 48 passed, 0 failed.
- End-to-end CLI execution: `echo "ping" | codex.cmd exec -` executed successfully, generating turn completion with `gpt-6-sol`.

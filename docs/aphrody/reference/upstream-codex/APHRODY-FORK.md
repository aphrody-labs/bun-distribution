# Codex in Aphrody: the aphrody-labs/codex fork

Canonical Aphrody page about Codex. Every other page that discusses the Codex runtime, its sources, its patches or
its updates links here. Modeled strictly after the Bun fork precedent ([docs/reference/upstream-bun/APHRODY-FORK.md](../upstream-bun/APHRODY-FORK.md)).
Verified against the fork checkout and native crates on 2026-10-09.

## Rules

- The Codex of Aphrody is the fork [aphrody-labs/codex](https://github.com/aphrody-labs/codex) (local checkout
  `APHRODY_CODEX_CHECKOUT`, else `C:\codex` on Windows). Any change to Codex itself (CLI engine, protocol,
  built-in tools, app-server daemon, schemas) lands in the fork as a commit on `main`, with a test under
  `codex-rs/` or `tests/`.
- Aphrody keeps no foreign patch queue, no duplicate runtimes, and no raw vendored Git repository polluting the
  Aphrody repository root. Aphrody consumes and absorbs Codex through first-party capability crates:
  `crates/contracts/app-protocol` (pure wire protocol v2), `crates/ai/app-server` (local daemon & engine),
  `crates/ai/config` (configuration layering and profiles), and `crates/infra/aphrody` (multi-call CLI).
- `openai/codex` is reached only through the fork's `upstream` remote; it is not a direct source of Aphrody.

## Repository

- Remotes: `origin` = `https://github.com/aphrody-labs/codex.git`, `upstream` = `https://github.com/openai/codex.git`.
  One working branch, `main` (also the default branch) = upstream `main` plus the Aphrody commits.
- Upstream arrives by merge only, never by rebase or force push.

## Fork patches (kept when merging upstream)

- Windows non-elevation daemon guard: On Windows, Codex daemon rejects invocation from an administrative token
  (`backend::windows::ensure_not_elevated()`). The Aphrody fork and wrappers (`bin/codex.cmd`, `~/.local/bin/codex.cmd`,
  PowerShell profile `global:codex`, and `aphrody codex`) automatically inspect elevation and pass `--no-daemon`
  when running in an elevated shell, eliminating the privilege-inheritance failure.
- Sol model family and account profiles: Full support for the new-generation `gpt-6.1-sol`, `gpt-6-sol` and `gpt-6.1-sol-wm`
  slugs in `models_cache.json`, `config.toml`, and TUI availability NUX.
- Local keyless App-Server Protocol v2: In `crates/contracts/app-protocol` and `crates/ai/app-server`, pure JSON-RPC
  v2 compatibility with zero mandatory OpenAI cloud dependencies, local RAG retrieval, and full turn/thread streaming.
- Multi-call and FFI integration: `aphrody codex` acts as the multi-call entry point, dispatching to native execution
  or local app-server daemon with zero startup overhead.

## Upstream synchronization

`bun scripts/tools/codex-sync-upstream.ts [--push] [--dry-run]`, merges `upstream/main` into `main`,
preserves Aphrody's fork patches, and updates `tools/config/codex-absorption.json` and `tools/config/upstream-sources.json`.

## Distribution

| Artifact | Producer in the fork | Published as |
| --- | --- | --- |
| Codex CLI binary | `codex-cli` / `aphrody` multi-call | `codex`, `aphrody-codex`, `aphrody codex` |
| App-Server Daemon | `crates/ai/app-server` | `aphrody app-server`, `aphrody codex app-server` |
| Protocol Crates | `crates/contracts/app-protocol` | crates.io `aphrody-app-protocol` |
| Server Crate | `crates/ai/app-server` | crates.io `aphrody-app-server` |
| Python SDK | `py/packages/aphrody` | PyPI `aphrody` (`aphrody.agent`) |
| Bun SDK | `packages/interop/native` | npm `@aphrody/native` |

Versions follow `<base>-aphrody.<n>`.

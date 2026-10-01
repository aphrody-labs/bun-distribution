---
name: docs
description: "Look up current, version-matched docs for any library, framework, SDK, CLI, API or cloud service (Context7, Microsoft Learn, llms.txt, source) before writing code that uses it, when an API seems changed, or for setup and migration questions."
version: "1.1.0"
---

# docs: one documentation lookup method

## 1. Use the tools that exist in this session

Tool names differ by host. Check the available and deferred tool lists first and load
schemas in one `ToolSearch` call. In order of preference:

| Need | Tool, when present |
| --- | --- |
| Multi-source fan-out (Context7 + Microsoft Learn + code samples + GitHub `llms.txt`) | an MCP tool named `docs_auto_search` |
| Open-source library docs, version-pinned | Context7: `resolve-library-id`, then `query-docs` (any `*Context7*` / `context7_*` tool) |
| Microsoft (Azure, .NET, PowerShell, Win32, Windows) | Microsoft Learn: `microsoft_docs_search`, then `microsoft_docs_fetch`; samples: `microsoft_code_sample_search` |
| GitHub repos and `llms.txt` discovery | `github_docs_search` |
| Prompt-ready digest of a repo or directory | `git_ingest` |
| A specific page or changelog | `WebFetch` (or a fetch/scrape MCP tool such as `universal_web_fetch`) |
| Nothing above available | `WebSearch` restricted to the official domain, then `WebFetch` |

Cheap high-signal sources to try directly: `https://<site>/llms.txt`, the project's
`CHANGELOG.md` / GitHub releases, and installed type definitions or sources
(`node_modules/<pkg>/*.d.ts`, `~/.cargo/registry/src/*/<crate>-<version>/`, `site-packages/`).

## 2. Method

1. Find the version actually used: lockfile (`Cargo.lock`, `bun.lock`, `package-lock.json`,
   `pnpm-lock.yaml`, `uv.lock`, `poetry.lock`, `go.sum`, `packages.lock.json`) or manifest.
2. Resolve the library ID once (skip when the user gives `/org/project`); choose by name
   match, source reputation and snippet count; pin the version when the tool supports it.
3. Ask one precise concept per call ("serde_json Value pointer access", not "serde"). Stop
   at about three calls per question, or as soon as the answer is clear.
4. Cross-check the answer against the locked version (installed types or source beat
   docs for the wrong version). Say so when the docs describe a newer release than the one
   installed.
5. Cite the URL or library ID for non-obvious facts.

To keep large doc dumps out of the main context, delegate to a docs-research subagent
(for example `docs-researcher`, when defined) with this same method.

## 3. Writing code from the docs

Use the target repository's toolchain and package manager (detect from lockfiles and
`packageManager`; for example `bun`/`bunx` in Bun repos, `uv` for Python, `cargo` for Rust).
Keep identifiers and commit messages in the repository's language; reply in the user's
language.

**Aphrody CLI equivalents** (when the `aphrody` binary is on `PATH`): `aphrody docs search
<query>` (same fan-out as `docs_auto_search`), `aphrody ingest <repo-or-dir>` (digest),
`aphrody docs awesome ...` (curated awesome lists).

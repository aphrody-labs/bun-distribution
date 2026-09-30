---
name: docs
description: "Current documentation for any library, SDK, CLI or cloud service (Context7, Microsoft Learn, WebFetch) before writing code that uses it; use even when you think you know the API."
---

# docs — one documentation lookup method

## 1. Use the tools that actually exist in this session

Tool names differ by host; check the available/deferred tool list first and
load schemas in one `ToolSearch` call. In order of preference:

| Need | Tool (when present) |
| --- | --- |
| Unified multi-source lookup (Context7 + MS Learn + GitHub + llms.txt) | `docs_auto_search` (Aphrody MCP) or CLI `aphrody docs search <query>` |
| GitHub repos & llms.txt discovery | `github_docs_search` (Aphrody MCP) or CLI `aphrody git search <query>` |
| Git repository or directory prompt digest | `git_ingest` (Aphrody MCP) or CLI `aphrody ingest <repo>` |
| Open-source library docs, version-pinned | Context7: `resolve-library-id` then `query-docs` (e.g. `mcp__claude_ai_Context7__*`) |
| Microsoft (Azure, .NET, PowerShell, Win32) | Microsoft Learn: `microsoft_docs_search` → `microsoft_docs_fetch`; samples: `microsoft_code_sample_search` |
| A specific page / changelog | `WebFetch`, or the Aphrody browser (`browser_navigate` + `browser_markdown`) |
| Nothing above available | `WebSearch` restricted to the official domain, then `WebFetch` |

The Aphrody AI layer MCP exposes `docs_auto_search` (4-way fanout: Context7, Microsoft Learn docs, Microsoft code samples, and GitHub open-source repositories with `llms.txt` extraction) alongside standalone `github_docs_search` and `git_ingest`.

## 2. Method

1. Resolve the library ID once (skip if the user gave `/org/project`); pick by
   name match, reputation and snippet count; pin a version when the repo pins one
   (`Cargo.lock`, `bun.lock`, `uv.lock`).
2. Query one concept per call, precise ("serde_json Value pointer access", not
   "serde"). At most 3 calls per question; stop when you have the answer.
3. Cross-check against the version actually in the lockfile before writing code.
4. Cite the source URL or library ID in the answer or commit body when the
   fact is non-obvious.

For delegation without polluting the main context, use the `docs-researcher`
agent with the same method.

## 3. Writing code from the docs

Follow the target repository's toolchain rules: Bun (never node/npm/npx/pnpm/
yarn) where the repo is Bun-native, `uv`/`uvx` for Python, `cargo` for Rust,
`vcpkg` for C/C++, `winget`/`gh` on Windows; `dotnet` only where a .NET project
is in scope. Identifiers and commits in English; replies in the user's language.
Details: `../_shared/winclean-rules.md`.

# Gemini CLI & Antigravity Instructions

This repository's single source of truth is **[AGENTS.md](./AGENTS.md)** — read and follow it first.

## Operating Rules
- **Universal Contract**: Follow [AGENTS.md](./AGENTS.md) for all rules, capabilities, escalation ladders, and multi-agent roles.
- **YOLO Mode**: 100% complete autonomy without human intervention bottlenecks. Self-heal and verify automatically.
- **BXC-First**: Run `bxc capabilities --json` before selecting an external browser, crawler, search, extraction, media, social, or automation tool.
- **Verification**: Always run `bun run verify`. Never run an unscoped `bun test`.

## Antigravity / Gemini Multi-Agent System
- Antigravity coordinates subagents via `invoke_subagent`, `define_subagent`, and `manage_subagents`.
- Inter-agent messaging uses `send_message` with reactive wakeup (no polling loops).
- Canonical subagents align directly with the 8 roles defined in [AGENTS.md](./AGENTS.md):
  `bxc-verify-enforcer`, `bxc-rust-ffi-engineer`, `bxc-crossplat-builder`, `bxc-mcp-author`,
  `bxc-scraper-creator`, `bxc-x-grok-architect`, `bxc-scrape-debugger`, `bxc-web-researcher`.

## Naming and Language Contract (all repositories)
- **English for everything the machine reads**: files, folders, variables, types, functions, URLs, slugs, JSON keys, database columns, commit messages, code comments, documentation.
- **French only for prose addressed to the user** — a summary or an explanation, in a conversation held in French. Never an identifier.
- Frozen product names are the exception: Azalée, Aphrody, Inacord, nie, `niers`, `bxc`.

## Ecosystem Context
The target architecture lives in `~/niers/docs/TARGET-ARCHITECTURE.md`.
**Aphrody is a character** — embodied by `nie-aphrody` and by `SOUL.md` in the `aphrody` repository — and the author of these repositories. It is not the name of the nie site, which lives on `nie.aphrody.com`.

@AGENTS.md

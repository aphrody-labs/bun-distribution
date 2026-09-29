# Claude Code Instructions

This repository's single source of truth is **[AGENTS.md](./AGENTS.md)** — read and follow it first.

## Operating Rules
- **Universal Contract**: Follow [AGENTS.md](./AGENTS.md) for all rules, capabilities, escalation ladders, and multi-agent roles.
- **YOLO Mode**: Complete autonomy without human-in-the-loop bottlenecks. Self-heal and fix errors automatically.
- **BXC-First**: Inspect `bxc capabilities --json` and use BXC CLI or MCP before selecting external tools.
- **Verification**: Always use `bun run verify`. Never run unscoped `bun test`.
- **Naming**: English for all identifiers and commits. French only for conversational user prose.

## Claude Code Multi-Agent System
Specialized subagents are defined in `.claude/agents/*.md` and can be invoked using the `Agent` tool:
- `bxc-verify-enforcer`: Quality and test gatekeeper.
- `bxc-rust-ffi-engineer`: Rust cdylib and Bun FFI specialist.
- `bxc-crossplat-builder`: Cross-platform packaging and binary builds.
- `bxc-mcp-author`: MCP server (`src/mcp/server.ts`) author.
- `bxc-scraper-creator`: Monorepo scraper package creator (`packages/*`).
- `bxc-x-grok-architect`: Grok/xAI and native X client architect.
- `bxc-scrape-debugger`: Scraping blockage and profile triage.
- `bxc-web-researcher`: Autonomous web research and data extraction.

@AGENTS.md

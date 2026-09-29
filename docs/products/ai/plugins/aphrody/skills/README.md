# `skills/` — aphrody plugin skill registry

Single source of truth for the **agent skills** bundled with the aphrody
Claude Code plugin. Each skill is a directory whose `SKILL.md` declares
its triggers, scope, and operating instructions.

Last updated: 2026-09-28 (unified Aphrody, AI/LLM and Dragon Ball skills; descriptions capped at 260 chars by scripts/validate-plugin.sh).

## Skill format (`SKILL.md`)

Every skill **MUST** start with a YAML frontmatter block:

```yaml
---
name: my-skill                # kebab-case, matches directory name
description: One-line summary of what the skill does and when it fires.
---
```

Optional siblings:

| File / dir    | Purpose                                          |
|---------------|--------------------------------------------------|
| `references/` | Supporting docs (playbooks, catalogs, links).    |
| `scripts/`    | Helper automation (Rust / `cargo run` wrappers). |
| `evals/`      | Evaluation harness (deterministic test cases).   |

> **Toolchain policy** (`docs/BUN.md`): helper automation is Rust
> (`cargo run -p …`) or Bun (`bun …`, `bunx …`), or a one-shot shell/pwsh
> wrapper. Never `node`, `npm`, `npx`, `pnpm` or `yarn`.

## Highlights

| Skill | Trigger |
|---|---|
| `yolo` | "yolo", "grind", "start", "loop until perfect" (aliases: `yolo-grind`, `yolo-perfect-grind`, `start`) |
| `deploy` | deploy, restart, provision, free disk — via `aphrody-infra` |
| `ecosystem` | "is there a crate/command/tool for …" — generated catalog in `aphrody-infra/docs/ecosystem/` |
| `docs` | any library / SDK / cloud API question |
| `web` | browsing, crawling, scraping (`aphrody web capabilities --json`) |
| `winclean` | Windows diagnostics and automation |
| `rust-target-check` | parallel 3-target `cargo check` |
| `agent-browser` | browser automation CLI |
| `bun` | Bun APIs, Node to Bun equivalents |
| `m3` | `@aphrody/m3` apps: `m3 dev` / `build` / `tokens`, `m3.config.ts`, the plugin, `M3App` |
| `rust-bun` | Rust to Bun bridges: bun:ffi, napi-rs, WASM, subprocess, packaging |
| `nie-re-workflow`, `formats-level5`, `jouer-ievr` | the `nie` repository (Inazuma Eleven RE, formats, play loop; merged from the retired `nie` plugin) |

Before adding a skill, extend an existing one: every description is loaded
into each session.

The full catalogue is auto-discovered from `skills/<name>/SKILL.md`; the
plugin manifest (`.claude-plugin/plugin.json`) and the plugin
[`README.md`](../../../_source/plugins/aphrody/README.md) carry the authoritative counts.

## Agents (`../agents/`)

Invokable sub-agents with their own toolset and system prompt
(`rust-architect`, `rust-engineer`, `cargo-auditor`, `cpp-engineer`,
`ffi-architect`, `zig-engineer`, `cross-platform-validator`,
`aphrody-cli`, `explore`, `build`, `code-review`, `yolo-prod-ready`,
`design-google-curator`, plus the infra/quality specialists). See the
plugin [`README.md`](../../../_source/plugins/aphrody/README.md) for the full table.

## Vendored third-party skills

Imported 2026-09-23 with `bunx skills add`, reviewed, and given an "Aphrody OS context" section. All are MIT-licensed.

| Skill | Upstream |
|---|---|
| `tauri-v2` | `nodnarbnitram/claude-code-extensions` |
| `material-3` | `hamen/material-3-skill` |
| `rust-async-patterns` | `wshobson/agents` |
| `nushell-pro` | `hustcer/nushell-pro` |

Refresh one with `bunx skills add <owner/repo> -s <skill> -a claude-code -y` in a scratch directory, review the diff, then copy `SKILL.md` and `references/` back (keep the context section).
All Aphrody AI/LLM, OS, Web, WinClean and Dragon Ball skills are bundled in this
single plugin. Runtime implementations remain in their owning repositories.

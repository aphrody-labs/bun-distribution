# `skills/`: aphrody plugin skill registry

Agent skills bundled with the aphrody Claude Code plugin. Each skill is a directory whose
`SKILL.md` declares its triggers, scope and instructions. Skills are auto-discovered from
`skills/<name>/SKILL.md`; the plugin manifest (`.claude-plugin/plugin.json`) and the plugin
[`README.md`](../README.md) carry the authoritative counts.

Last updated: 2026-10-01 (general-purpose engineering skills made project-agnostic and
re-verified against crates.io, npm, RustSec and upstream release notes).

## Skill format (`SKILL.md`)

Every skill starts with a YAML frontmatter block, checked by `scripts/validate-plugin.sh`:

```yaml
---
name: my-skill        # kebab-case, must match the directory name
description: "What it does and when to use it, on one line, at most 260 characters."
---
```

Optional siblings:

| File / dir    | Purpose |
|---------------|---------|
| `references/` | Detailed docs loaded on demand (keep `SKILL.md` lean). |
| `scripts/`    | Helper automation, referenced relative to the skill directory (`${CLAUDE_PLUGIN_ROOT}/skills/<name>/scripts/...` in a plugin install). |
| `evals/`      | Trigger and task prompts with assertions. |

## Portability rules

The plugin is meant to work in any project, not only the Aphrody monorepo:

- **Detect, do not assume.** Read the project's manifests, lockfiles and toolchain files
  (`Cargo.toml`, `rust-toolchain.toml`, `package.json`, `bun.lock`, `*.csproj`, ...) and use
  its package manager and gates. No absolute paths or user-specific locations.
- **Tools are optional.** Refer to MCP tools by their bare name (`bun_docs_search`,
  `docs_auto_search`, `nu_eval`) and say what to do when they are absent.
- **Monorepo specifics go last**, in an "In the Aphrody monorepo" section that states how
  to recognise the monorepo (root `package.json` named `aphrody`) and uses real,
  repo-relative paths (`crates/<domain>/<crate>`, `packages/<domain>/<package>`).
- **Versions carry a date.** Pin facts to a verification date and tell the agent how to
  re-check (crates.io, npm, release notes) instead of presenting them as "latest".

## Skill groups

| Group | Skills |
|---|---|
| General engineering (portable) | `docs`, `bun`, `rust-best-practices-2026`, `rust-async-patterns`, `rust-target-check`, `best-stack-2026`, `rust-bun`, `cpp-pro`, `csharp-async`, `powershell-expert`, `nushell-pro`, `cross-platform-cli-toolbelt`, `developing-genkit-js`, `skill-creator` |
| UI (portable) | `tauri-v2`, `tailwindcss`, `shadcn`, `material-3`, `responsive-adaptive`, `remotion-best-practices`, `color-expert` |
| Aphrody UI | `m3` (`@aphrody/m3`), `render-pipeline` (`aphrody-render`) |
| Aphrody OS, AI and web | `yolo` (+ `yolo-grind`, `yolo-perfect-grind`, `start`), `deploy`, `ecosystem`, `web`, `web-*`, `cloud`, `a2a-protocol`, `aphrody-*`, `n2b`, `unified-workflow`, `winclean`, `_shared` |
| Reverse engineering | `auto-re`, `deep-analysis`, `pe-symbol-recovery`, `protocol-reverse-engineering`, `dpapi-timing-audit` |
| NIE (Inazuma Eleven) | `nie-*`, `formats-level5`, `jouer-ievr`, `ievr-terminologie`, `assembler-modeles-textures`, `creer-assets-3d`, `peaufiner-rendu-3d`, `pixel-perfect` |
| Dragon Ball / Shenron | `dragon-ball*`, `databooks-ocr`, `shenron-admin`, `toriyama-svg` |

Before adding a skill, extend an existing one: every description is loaded into each
session. The `ecosystem` skill and `docs/` (`ECOSYSTEM.md`, `CLI.md`, `MCP-TOOLS.md`) list
existing crates, commands and MCP tools.

## Agents (`../agents/`)

Sub-agents with their own toolset and prompt, for example `rust-architect`,
`rust-engineer`, `cargo-auditor`, `cpp-c-engineer`, `csharp-engineer`, `ffi-architect`,
`cross-platform-validator`, `docs-researcher`, `explore`, `build`, `code-review`,
`test-runner`, `lint-workflow`, `pwsh-expert`, `win32-expert`, `web-engineer`,
`yolo-prod-ready`. See the plugin [`README.md`](../README.md) for the full table.

## Vendored third-party skills

Reviewed copies of upstream skills, adapted to the portability rules above (upstream
attribution kept in each file).

| Skill | Upstream | Licence |
|---|---|---|
| `tauri-v2` | `nodnarbnitram/claude-code-extensions` | MIT |
| `material-3` | `hamen/material-3-skill` | MIT |
| `rust-async-patterns` | `wshobson/agents` | MIT |
| `nushell-pro` | `hustcer/nushell-pro` | MIT |
| `shadcn` | `shadcn-ui/ui` (`skills/shadcn`) | MIT |
| `remotion-best-practices` | `remotion-dev/skills` | see upstream (no licence file) |
| `developing-genkit-js` | Genkit team agent skill (`genkit-ai`) | see upstream |
| `skill-creator` | `microsoftdocs/mcp` (`microsoft-skill-creator`) | MIT |
| `color-expert` | `meodai/skill.color-expert` (SKILL.md only; references fetched from upstream) | CC-BY-4.0 |

Refresh one with `bunx skills add <owner/repo> -s <skill> -a claude-code -y` in a scratch
directory, review the diff, then merge it back while keeping the portability changes.

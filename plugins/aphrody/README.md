<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody — the unified Aphrody plugin

The single first-party agent plugin of the Aphrody monorepo. It bundles skills,
agents and slash commands (Rust/Bun engineering, web research, AI/RAG, reverse
engineering, Windows/Linux administration, Material 3 UI, NIE, Dragon
Ball/Shenron) for Claude Code, Codex and Antigravity (`agy`), and declares one
MCP server: the Aphrody kernel (`aphrody-kernel mcp`).

**Version: 1.6.0** · License: Apache-2.0 · Source:
[`plugins/aphrody`](https://github.com/aphrody-labs/aphrody/tree/main/plugins/aphrody)
in the Aphrody monorepo. Current component counts are printed by
`scripts/validate-plugin.sh`.

## Use it in any project

The plugin is not tied to the Aphrody checkout. Add the marketplace once, then
enable the plugin from any repository:

```bash
# From a checkout of the monorepo at any path. The marketplace manifest is
# plugins/aphrody/.claude-plugin/marketplace.json (the repository root carries
# a different marketplace), so add the plugin directory, not the repo root.
claude plugin marketplace add <path-to-aphrody>/plugins/aphrody
claude plugin install aphrody@aphrody-local
```

What works where:

| Situation | Skills, agents, commands | Kernel MCP tools | Hooks |
|---|---|---|---|
| Aphrody monorepo, kernel installed | yes | yes | yes |
| Any other project, kernel installed | yes | yes (OS, web, AI, docs tools; monorepo-only tools such as `infra_*` need `APHRODY_INFRA_DIR`/`APHRODY_INFRA_PATH`) | yes |
| No kernel binary | yes | the `aphrody` server shows as failed in `/mcp`; nothing else breaks | silent no-ops |

Skills that describe monorepo paths (`crates/...`, `packages/...`) apply only
inside the monorepo; outside it, agents follow the current repository's own
instructions.

## Binaries

| Binary | Required | Provides |
|---|---|---|
| `aphrody-kernel` | optional (for MCP tools) | the `aphrody` MCP server: `aphrody-kernel mcp` |
| `aphrody` | optional | the CLI used by several skills/commands (`aphrody web`, `aphrody doctor`, `aphrody n2b`, ...) |
| `jq` | optional | faster, exact JSON parsing in hooks and the validator (sed/python3 fallbacks exist) |

Build them from the monorepo root and put them on `PATH`:

```bash
cargo build --release --locked -p aphrody-kernel   # crates/os/kernel
cargo build --release --locked -p aphrody-mcp      # crates/ai/mcp, internal AI/Web provider
```

## Configuration

Machine-wide settings are environment variables, read when the client starts:

| Variable | Read by | Effect |
|---|---|---|
| `APHRODY_KERNEL_BIN` | `.mcp.json`, SessionStart hook | kernel binary name or absolute path (default `aphrody-kernel` on `PATH`) |
| `APHRODY_PLUGIN_QUIET=1` | SessionStart hook | suppress the one-line kernel summary |
| `APHRODY_ALLOW_BARE_BUN_TEST=1` | PreToolUse hook | disable the bare `bun test` guard |
| `APHRODY_OS_SOCKET` | kernel | local endpoint to relay to (default: per-user socket/pipe) |
| `APHRODY_KERNEL_AUTH_FILE`, `APHRODY_KERNEL_EXEC_POLICY` | kernel | optional session auth policy and tool exec policy |
| `APHRODY_AI_MCP_BIN`, `APHRODY_WEB_MCP_BIN`, `APHRODY_BROWSER_MCP_BIN` | kernel | override (or, with an empty value, disable) internal providers |
| `APHRODY_INFRA_DIR`, `APHRODY_INFRA_PATH` | kernel `infra_*` tools | locate the infra workspace when not running inside the monorepo |

The kernel has no project-root variable: tools that need a workspace resolve it
from the process working directory, which the client sets to the project.
Secrets (Google, Gemini, GitHub tokens) stay in the host environment.

Per-project settings go in `.claude/aphrody.local.md` (template:
[`examples/aphrody.local.md.example`](examples/aphrody.local.md.example)); keep
`.claude/*.local.md` out of Git and restart the client after editing.

## Client manifests

| Client | Manifest | MCP declaration | Hooks |
|---|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` (+ `marketplace.json`) | `.mcp.json` | `hooks/hooks.json` |
| Codex | `.codex-plugin/plugin.json` | `.mcp.json` | — |
| Antigravity (`agy`) | `plugin.json` | `mcp_config.json` | `hooks.json` |

All three share the server key `aphrody` (Claude Code tool names are
`mcp__plugin_aphrody_aphrody__*`). `.mcp.json` uses
`${APHRODY_KERNEL_BIN:-aphrody-kernel}`; `mcp_config.json` keeps the literal
binary name because agy's support for default-value expansion is unverified.
The root `plugin.json`, `mcp_config.json` and `hooks.json` are read by agy
(`.agents/plugins.json` points it at this directory) and by
`aphrody-agent-runtime` manifest discovery; they are not duplicates to remove.

## MCP server: `aphrody-kernel mcp`

`mcp` relays to a running kernel (`aphrody-kernel serve`) or runs one
in-process. The kernel routes to its built-in subsystems (shell/Nushell,
coreutils, systemd, compat runtimes, cloud, infra, Bun docs, window/desktop,
WinClean on Windows) and to internal providers (`aphrody-mcp` for AI, RAG,
Dragon Ball/Shenron and Google/web; the Aphrody Web browser provider). The
catalog depends on the build and on installed providers; `aphrody-kernel tools`
and MCP `tools/list` are authoritative. Tools carry MCP annotations
(`readOnlyHint`, `destructiveHint`, ...).

WinClean is Rust-only and exposed through the same kernel; see
`docs/reference/os/WINCLEAN-RUST-CONVERGENCE.md` in the monorepo.

## Hooks

- `SessionStart` (`hooks/scripts/session-start.sh`): one line with the kernel
  tool count when the kernel is installed; silent otherwise (4 s cap).
- `PreToolUse` on `Bash` (`hooks/scripts/enforce-web-test-scope.sh`): blocks a
  bare `bun test` only in a package that has both `package.json` and
  `vendor/`, where Bun would also run the vendored suites. No-op elsewhere.

## Components

- Slash commands: `commands/` (`/status`, `/package`, `winclean-*`). `/docs`,
  `/n2b` and `/web` are skills only (`skills/docs`, `skills/n2b`,
  `skills/web`), so Codex, agy and OpenCode share them; Claude Code still
  exposes them as `/aphrody:docs`, `/aphrody:n2b`, `/aphrody:web`.
- Agents: `agents/` (Rust build/test/lint/review, web, N2B, Windows,
  Material 3, Dragon Ball/Shenron, ...).
- Skills: `skills/` (autonomy/YOLO, docs lookup, Aphrody CLI and AI, web, RE,
  Rust/C++/Bun/shell, UI and design, NIE, Dragon Ball/Shenron).

Every skill, agent and command description is loaded into each session, so
descriptions stay single-line and at most 260 characters.

## Validation

```bash
plugins/aphrody/scripts/validate-plugin.sh      # works from any cwd
claude plugin validate plugins/aphrody
```

The script checks JSON, manifest/marketplace/changelog version consistency, the
single `aphrody` MCP server, skill/agent/command frontmatter, hook scripts, and
warns about user-specific absolute paths and cited monorepo paths that no longer
exist.

## Documentation

[Dragon Ball integration](docs/DRAGON-BALL.md) records Shenron ownership,
research rules and MCP boundaries. Monorepo architecture lives under
`docs/architecture/` of the Aphrody repository.

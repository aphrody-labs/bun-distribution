---
description: One-screen read-only status of the current project (binary, git, open plan items, A2A peer, plugin version).
allowed-tools: Bash, Read
argument-hint: "(no arguments)"
model: sonnet
---

# /status — project status snapshot

Read-only diagnostics, rendered as one tight report. Each step is skipped
cleanly (and reported as `n/a`) when its precondition is absent; the
Aphrody-specific steps apply when the `aphrody` binary is on `PATH`.

## Steps

1. **Binary and plugin**
   - When `aphrody` is on `PATH`: `aphrody --version`.
   - Read `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` for the plugin
     version.

2. **Git state** (skip outside a Git repository)
   - `git status --short | head -20` for the uncommitted file count.
   - `git log --oneline -5` and `git branch --show-current`.

3. **Open plan items**
   - Locate the plan: PLAN.md or docs/PLAN.md at the repository root.
   - Count open items: `grep -c -e '- \[ \]' -e '⏳' <plan>`; show the first 10
     with `grep -n`.

4. **A2A peer** (when `aphrody` is present)
   - `aphrody doctor --json | jq -r '.peer_a2a.heartbeat_detail, .peer_a2a.is_stale'`.

5. **Toolchain** (when `aphrody` is present)
   - `aphrody self bootstrap --check | head -20` (inventory only).

## Output format

```
status — <iso-date>

binary    : <version> (or n/a)
plugin    : <version>
branch    : <name> (<N> uncommitted)
last      : <sha> <subject>
plan      : <N> open items in <file> (first 5 line numbers shown)
A2A peer  : <heartbeat detail> [stale|fresh]
toolchain : <inventory summary>
```

End with a short action list only if state is degraded (stale peer, many open
items, missing tools).

## Anti-stub

- Never fabricate a state when a command fails; surface stderr verbatim.
- Never invent plan items that are not in the plan file.
- Informational only: no `git add`, no daemon start, no writes.

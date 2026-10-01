---
name: ecosystem
description: "Find what already exists across all aphrody repos before writing code: crates, features, binaries, Bun/uv packages, exact CLI commands and every MCP tool, from the generated catalog in aphrody-infra. Triggers: which crate, is there a command/tool for, reuse."
---

# ecosystem — check the generated catalog first

The catalog lives in `aphrody-infra/docs/ecosystem/` (sibling path from any aphrody repo:
`../aphrody-infra/docs/ecosystem/`). It is generated from the checkout, never hand-written:

| File | Content |
| --- | --- |
| `ECOSYSTEM.md` | repositories and roles, crates (description, binaries, features), Bun and uv packages |
| `CLI.md` | exact subcommand tree of every shipped binary, read from its clap definitions |
| `MCP-TOOLS.md` | every MCP tool name and description, grouped by server / kernel subsystem |
| `ecosystem.json` | the same data, machine-readable (full descriptions) |

Workflow:

1. Search the catalog (`rg -n '<keyword>' ../aphrody-infra/docs/ecosystem/`) before adding a crate,
   command, MCP tool or package.
2. If something covers the need, reuse or extend its owner; do not create a parallel one.
3. After changing crates, clap commands or MCP tools, regenerate in `aphrody-infra`:
   `bun scripts/ecosystem.ts` (`--check` fails when the committed catalog is stale; it also
   runs in `bun run test`).

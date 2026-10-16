<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody workspace rules

## Autonomous execution — No human in the loop

Apply the user's global Codex agent policy: complete authorized work without
approval prompts, confirmation loops or interactive questions. Choose routine
implementation details, inspect available evidence and continue independently.
When information is missing, use a reversible assumption and state it briefly.
An actual access or technical failure is reported with evidence; never invent a
successful result. NHITL does not change the task scope or a product's runtime policy.

## Workflow

- Read the owning repository's `AGENTS.md`, README and active plan before editing.
- Reuse existing owners and APIs; keep changes and commits in their repositories.
  Cross-repository work is allowed when the task requires it, with separate commits.
- Inspect Git status before changes. Preserve concurrent edits, stage only your
  work, commit coherent batches and push to the configured branch. Never force-push
  shared history; do not stash/reset another contributor's work to enable a push.
- Keep credentials, cookies, private keys and runtime databases out of Git and logs.
- Use pinned Rust/Bun/uv toolchains and the global Cargo `sccache` wrapper;
  set `RUSTC_WRAPPER=` only for an intentional opt-out. Keep workspace
  dependency/lint inheritance. Scope formatting to owned files; preserve upstream notices.
- Validate the changed scope. Documentation: links, anchors, generated docs when
  applicable, and `git diff --check`. Code: focused checks, then the owner's gates.
  A skipped or failed check stays visible; no fake success or weakened tests.
- Keep updates concise. Continue active goals until completed; report concrete evidence without terminal status labels.

## Authorities

| Topic | Owner |
| --- | --- |
| Architecture and repository boundaries | [Architecture](../../architecture/workspace/ARCHITECTURE.md) |
| Target consolidation, unified FFI and repository migration | [Root plan](../../PLAN.md) |
| Navigation | [Documentation index](../../README.md) |
| Workstation Nushell setup | [Nushell guide](./nu.md) |
| Cross-repository delivery | [AI plan](../../plans/ai/PLAN.md) |
| Desktop behavior and appearance | [GUI](../../../m3/docs/reference/GUI.md), [UI](../../../m3/docs/architecture/UI-DESIGN.md), [UX](../../../m3/docs/architecture/UX-DESIGN.md) |
| Native desktop/framework migration | [M3 host plan](../../../m3/docs/plans/design/M3-MULTI-HOST-PLAN.md) |
| Hosts, services, routes and releases | Root `config/`, `inventory/` and `crates/infra/` in this monorepo; see [Infra authority](../infra/UNIFIED-AGENT-CONTEXT.md) |
| Existing crates, commands and tools | [Generated ecosystem](../../ecosystem/ECOSYSTEM.md) |

`AGENTS.md` owns execution rules, README owns entry points, PLAN owns remaining
work and acceptance. Link to these authorities instead of copying their content.
Historical reports describe their recorded revision, not current runtime health.

## CLI and shell references

- Host CLI inventory and official docs: `~/.codex/CLI.md`.
- Aphrody WSL Nushell configuration: [Nushell guide](./nu.md).

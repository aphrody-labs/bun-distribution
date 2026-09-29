<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody source workspace

Git superproject for the independent `aphrody-*` repositories and domain products.
Implementation, toolchains, checks and releases belong to each child repository;
the root records checkout revisions and shared architecture. There is no root
Cargo, Bun or uv workspace.

IECODE is checked out separately in the user's personal directory, above this
source workspace. It is not a submodule or member of this superproject.

| Start here | Purpose |
| --- | --- |
| [AGENTS.md](../../reference/workspace/AGENTS.md) | Autonomous execution and contribution rules |
| [Architecture](../../architecture/workspace/ARCHITECTURE.md) | Ownership and process boundaries |
| [Documentation index](../../reference/workspace/INDEX.md) | Repository entry points |
| [Nushell setup](../../reference/workspace/nu.md) | Aphrody WSL shell config, plugins, scripts and environment |
| [Delivery plan](../../plans/ai/PLAN.md) | Workstation milestones and release evidence |
| [Consolidation plan](../../plans/workspace/PLAN.md) | Unified FFI, Rust + Bun monorepo, complete Python repository and GitHub migration |
| [GUI](../../reference/ui/GUI.md) | Chat, Files, Web and Models in one M3 shell |
| [Native framework plan](../../plans/ui/design/M3-MULTI-HOST-PLAN.md) | Rust desktop target; current Tauri integration remains transitional |

`.gitmodules` and gitlinks define recorded members; `manifest.json` is a generated
checkout snapshot. Neither proves deployment. A local directory outside that list
is not disposable. `target/` is active build output and may be shared by builds.

Use `just --list` for available root orchestration and each child's README for
its commands. Snapshot synchronization must preserve active child worktrees.
Update child commits first, then intentionally record their gitlinks and manifest.

Contracts owns wire schemas; Infra owns infrastructure and the generated
[ecosystem catalogue](../../reference/infra/ecosystem/ECOSYSTEM.md).
[Historical root documentation](../../reference/workspace/INDEX.md#historical-material) stays in Git.

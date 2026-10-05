<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Python workspace rules

The active extraction plan is [the Aphrody plan](../aphrody/PLAN.md).
`../src` is a legacy source archive, not the default development root.
IECODE/NIE sources still present here are transitional; their canonical owner
is `../iecode`. Do not add new game-domain implementation to this workspace.
This repository will contain all first-party Python projects, tools, apps,
notebooks, training and Python packaging, grouped under `packages/`, `apps/`,
`tools/`, `environments/`, and categorized `docs/`.

Rust extension source and the shared native ABI belong to the `aphrody` Rust +
Bun monorepo. Python bindings and wheels are built from pinned source revisions;
no checkout-neighbor path is a published runtime dependency.

Keep source checkouts and protected datasets intact until their map, licenses,
imports, clean installs, wheels and consumer gates pass. Do not copy secrets,
model weights, game databases, or caches into Git.

## Plugin scoping and runtime isolation

- `aphrody` plugin: enabled for this workspace (along with `/home/aphro/aphrody`).
- `yolo` plugin: global NHITL autonomous execution runtime.
- `bun-ts7` / Bun: global tooling available across all workspaces.
- `iecode` plugin: strictly isolated to `/home/aphro/iecode`.

## Dependency acquisition

Prefer PyPI through uv for external packages. Preserve required fork extensions
with an exact Git revision from a standalone private repository; no neighbor
checkout or manual clone is a runtime installation prerequisite. Keep first-party
Python projects in this root workspace and retain consumer/wheel checks before
removing duplicate upstream source.

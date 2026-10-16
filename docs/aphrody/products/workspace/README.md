<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody source workspace

The active repository is the root Rust + Bun monorepo. Python services and
IECODE remain in their canonical sibling repositories. Ownership and execution
rules live in root [AGENTS.md](../../AGENTS.md) and [PLAN.md](../../PLAN.md).

Documentation has one controller: `@aphrody/workspace` and `yolo ops docs`.
The [documentation guide](../../guides/workspace/documentation.md) describes
source references, provenance, duplicate review, agent indexes and private web
exports. Markdown pages remain canonical; generated views are never edited.

- [Documentation index](../../README.md)
- [Agent entrypoint](../../llms.txt)
- [Layout](../../reference/workspace/LAYOUT.md)
- [Workspace state](../../reference/workspace/STATE.md)
- [Generated ecosystem](../../ecosystem/ECOSYSTEM.md)

Use `bun run docs -- --help` and the owning package manifests for commands.
A generated catalogue does not prove deployment readiness. Preserve concurrent
source changes and protected runtime data during cleanup or migration.

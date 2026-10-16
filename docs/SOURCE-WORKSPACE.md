# Source workspace integration

Bun OS consolidates Bun Libraries and Aphrody through the existing root
workspace. Shenron, IECODE and Android are outside this absorption. Existing
Bun runtime, Material and APT distribution inputs keep their pinned contracts.

Aphrody retains AI (models, agents, memory, A2A and MCP) and infrastructure
(hosts, deployment, services, pipelines and cloud). Other capabilities belong
to Bun or Bun Libraries. Moving source requires moving its consumers,
dependencies, history and notices together.

## Flat product layout

The product has one root `crates/`, one `packages/` and one `apps/`. Each
product member is a direct child. The root Cargo and Bun manifests own
membership, dependency resolution and orchestration. A nested source checkout
is provenance, not evidence that its members have been flattened.

Rust owners use `crates/<package-name>` Git submodules with the shared root
Cargo workspace and nightly toolchain. JavaScript/TypeScript packages and
applications use `packages/<name>` and `apps/<name>` in the root Bun workspace.
Do not retire source duplicates before the canonical implementation and its
consumers qualify. Active Bun capability transfers retain their existing owner.

## Source graph and inventory

`infra/source-workspace.json` resolves source locations relative to this
checkout; explicit `checkouts` configuration can override them.

`bun src/cli.ts workspace` reports source revisions, local changes, physical
locations, workspace owners and migration state; `--config factory.local.json`
supplies checkout overrides. It identifies excluded repositories, linked
worktrees and unclassified siblings. Inventory coverage does not imply physical
consolidation, native qualification or application behavior.

`sources.lock.json` has 86 source mounts and 77 repository/revision identities,
including 76 gitlinks. The original 85 inputs are unchanged; Aphrody is the
additional selected source pin. Bun Libraries history through
`ec9539815a8a38ab306bc2cec3fc55adb8046b5b` is integrated into the distribution
ancestry without replacing the distribution tree.

The factory exporter consumes these pins and explicit checkout locations. Its
capacity, cleanliness, Git-object, LFS and license checks still apply. Local
receipts belong under `.local/`; a source inventory never imports dirty work.

## Preserved state

Active checkouts and the composition worktree remain available during the
migration. Earlier source checkpoints and pulls are retained in history;
they do not expand the selected absorption scope. The composition branch is
published as `codex/material-work` and has not been merged into `os`.

Provider authentication, raw sessions, cookies, protected local stores,
databases, datasets and model weights stay outside source migration. Production
DBFR authority remains with Omar. No inventory result qualifies deployment or
production activation.

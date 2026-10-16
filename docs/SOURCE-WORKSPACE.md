# Source workspace integration

Bun OS consolidates product capabilities through the existing root workspace,
following the current owner direction in PLAN.md. Existing
Bun runtime, Material and APT distribution inputs keep their pinned contracts.

Bun OS integrates AI, Infra and Workspace with the other product capabilities.
Each capability has one implementation owner. Moving source requires moving its consumers,
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
supplies checkout overrides. It identifies external source owners, linked
worktrees and unclassified siblings. Inventory coverage does not imply physical
consolidation, native qualification or application behavior.

Android and IECODE use `absorbed-source` entries whose revisions identify root
import commits. These entries prove the import is in root history, rather than
claiming the complete upstream history was merged or sibling checkouts retired.

`sources.lock.json` records the current source mounts and revision identities;
the workspace inventory reports their live coverage separately from migration
and qualification. Bun Libraries history through
`ec9539815a8a38ab306bc2cec3fc55adb8046b5b` is integrated into the distribution
ancestry without replacing the distribution tree.

The factory exporter consumes these pins and explicit checkout locations. Its
capacity, cleanliness, Git-object, LFS and license checks still apply. Local
receipts belong under `.local/`; a source inventory never imports dirty work.

## Preserved state

Active checkouts and the composition worktree remain available during the
migration. Earlier source checkpoints and pulls are retained in history;
their source history remains available. The composition branch is
published as `codex/material-work` and has not been merged into `os`.

Provider authentication, raw sessions, cookies, protected local stores,
databases, datasets and model weights stay outside source migration. Production
DBFR authority remains with Omar. No inventory result qualifies deployment or
production activation.

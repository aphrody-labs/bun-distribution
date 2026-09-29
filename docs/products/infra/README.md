<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Infra

Infrastructure authority for hosts, services, routes, toolchains and releases.
Application repositories retain business logic and data schemas.

| Source | Authority |
| --- | --- |
| `config/service-catalog.json`, `nginx-routes.json` | Workloads and routing |
| `config/production-topology.json`, `scheduler-policy.json` | Placement and timers |
| `inventory/targets.json`, dated inventory files | Targets and sanitized observations |
| `config/application-contracts.json`, `local-ai.json` | Shared application/AI integration |
| `config/pipeline.json` | Cross-repository delivery stages |
| `systemd/`, `nginx/`, `host/` | Reviewable host templates and policy |
| `crates/`, `scripts/` | Native control plane, SSH/Git/VPN/OVH and operational adapters |

The development Discord application is an Infra-owned service at
`https://bot.aphrody.com`, bound to loopback port `4010`; DNS, TLS, Nginx,
systemd, immutable releases, and its external env file are managed here. Its
current deployment and OAuth redirect registration are recorded in
[`docs/IMMUTABLE-RELEASES.md`](../../operations/infra/IMMUTABLE-RELEASES.md) and
[`docs/PLAN.md`](../../plans/infra/PLAN.md). Reusable Discord code and upstream bot
architecture audits belong to the separate
[Aphrody Discord monorepo](https://github.com/aphrody-code/aphrody-discord).
Its Carbon OAuth flow requests the published standard scopes and the
Administrator install bit for the fixed development guild; Discord-specific
scope/approval limits are documented in that repository's
[`docs/carbon-oauth.md`](https://github.com/aphrody-code/aphrody-discord/blob/main/docs/carbon-oauth.md).

## Operations

Use the pinned Rust/Bun tools; Python checks use the sibling AI uv workspace.
Run `cargo run --bin aphrody-infra -- --help` for current commands. `doctor --strict`
checks the pinned Rust/Bun/uv toolchains, the installed Aphrody CLI set, the
Codex NHITL/plugin configuration and the local source-sync user unit without
reading secret values. `status`,
`validate`, `service`, `pipeline`, `deploy`, `ssh`, `git`, `vpn` and `ovh` share
the catalogues above. Mutation flags such as `--apply` remain explicit command
semantics; NHITL agents select them autonomously within the authorized task.

The source workspace has a separate, safe upstream synchronizer. `bun run source:sync`
discovers Git worktrees below the sibling source root (including the Bun fork
and Aphrody UI); repeat `--repo NAME` to limit a pass to named worktrees.
`bun run source:sync -- --apply` fetches remotes and fast-forwards
only clean, non-diverged branches. `--push` is opt-in and pushes only commits
whose author and local Git identity are `aphrody-code <contact@aphrody.com>` to
an Aphrody-owned remote. Dirty worktrees, detached branches, divergent histories,
unowned remotes and modified submodules are preserved. `bun run source:sync:watch`
polls every 60 seconds; it is a local poller, not a server-side
webhook. A private lock prevents concurrent passes. Each pass atomically writes
an ignored `0600` report in `target/research/source-sync.json`.

`bun run github:audit` runs the native `aphrody-git` local/GitHub audit and saves
REST/GraphQL data for repositories, forks, branches, pull requests, recent
commits, releases, Git submodules, GitHub Packages and Awesome Rust to the same
ignored research directory. GitHub pagination is bounded; package visibility
requires the runtime token's `read:packages` scope. `bun run workspace:workflow`
runs source sync, GitHub audit and the full non-UI crate/source inventory in
sequence, pushing only eligible Aphrody-authored commits on Aphrody-owned
remotes. Follow findings with the selected repo's `crates:scan -- --deep` and
YOLO/MRX `bun run crates:dispatch -- --repo aphrody-NAME` (add `--apply` to
dispatch one scoped tick); apply crate updates only through the owner's
reviewed `update|fix|clean --apply` path.

- [Open work](../../plans/infra/PLAN.md), [agent rules](../../reference/infra/AGENTS.md)
- [Aphrody Bun platform map and integration plan](../../reference/infra/APHRODY-BUN-PLATFORM.md)
- [Aphrody Bun fork operations and pin](../../operations/infra/BUN-FORK-OPERATIONS.md)
- [GitHub organization ownership and repository transfer](../../reference/infra/GITHUB-OWNERSHIP.md)
- [GitHub identity, CI, release and upstream automation plan](../../plans/infra/GITHUB-AUTONOMY-PLAN.md)
- `nu scripts/scan-ui-crates.nu --skip-ui` (from any working directory; optional
  `--ui-root path`; `--skip-ui` never opens the UI repository or dependency targets into UI)
  compares first-party Aphrody crate names and Rust sources,
  and inventories workspace and crate-level path dependencies across first-party repos,
  workspace and crate-level Git dependencies, local/Git patches, Cargo.lock version multiplicity,
  Cargo packages and identical Rust files under vendor/third-party trees and local `patches`
  directories at any depth, plus their generated outputs (read-only).
  crates.io candidates only pass the static path, version and package `publish` checks; confirm
  an actual release, compatible API, license and target graph before migrating. The scan skips
  `.git`, `target`, `node_modules`, `dist`, `.bun-cache`, `.venv`, `venv`, `.tox` and `.nox` while
  locating vendor roots. Lockfile multiplicity is a triage signal; confirm active target
  reachability with `cargo tree -d` before consolidation.
- `bun run crates:scan -- --json` gives a fast offline Cargo.lock and
  workspace summary across catalogued Rust repositories, including UI when it has a Cargo workspace. Use `scan --repo aphrody-infra
  --deep` for `cargo-machete` candidates, cached RustSec advisories and a Cargo
  update preview. `--registry name@version` checks an exact crates.io release and
  yanked state through the public API. `--online` allows a registry refresh for
  previews. The Rust command reads only catalogued sibling repositories and requires a clean selected repository before any `--apply` action.
- `bun run crates:update|crates:fix|crates:clean -- --repo aphrody-infra` previews
  a selected repository action. Add `--apply` to update its lockfile, run `cargo fix`,
  or remove only its Cargo workspace artifacts. Mutations require a clean Git tree;
  `clean` also requires a target directory within the selected checkout. `update`
  checks dependency resolution after writing the lockfile. Follow with the owner's
  compile and test gates before accepting a dependency update. The scanner uses
  installed Cargo tools; it adds no workspace crates. See [crate maintenance](../../reference/infra/CRATE-MAINTENANCE.md).
- `bun run crates:build` compiles the maintenance CLI to `target/aphrody-crates`
  with Bun embedded; Cargo, Git, Nu and the Rust YOLO CLI remain host tools.
  `target/aphrody-crates scan --workspace-root /home/aphro/src --full --json` runs
  the non-UI Nu inventory. `dispatch --repo aphrody-infra` previews YOLO
  plan/check/detect preflight and up to three scoped maintenance missions;
  `--apply` builds the native YOLO CLI if needed and runs those missions
  sequentially in one bounded tick.
- [Immutable release runbook](../../operations/infra/IMMUTABLE-RELEASES.md), [Shenron migration](../../reference/infra/SHENRON-MIGRATION.md)
- [Operations index](./ops/README.md), [VPS](./vps/README.md), [OVH](./ovh/README.md)
- [Shared automation migration](../../reference/infra/AUTOMATION-MIGRATION.md)
- [Authority map](../../reference/infra/UNIFIED-AGENT-CONTEXT.md), [repository layering](../../reference/infra/REPO-LAYERING.md)
- [Generated ecosystem](../../reference/infra/ecosystem/ECOSYSTEM.md), [CLI](../../reference/infra/ecosystem/CLI.md), [MCP](../../reference/infra/ecosystem/MCP-TOOLS.md)

Optional interactive developer tools are separate from server provisioning:
`nu scripts/setup.nu --developer-cli` reports missing commands;
`nu scripts/setup.nu --developer-cli --apply` installs prebuilt Rust CLI releases
and the declared Nu plugin binaries from crates.io, then registers those plugins
with the local Nu installation. The inventory is
`config/developer-cli-tools.json`; none of these tools are workspace dependencies.

`aphrody-infra dev-env --local wsl --apply` also installs the explicitly declared
Rust development tools in `config/system-packages.json` through `cargo-binstall`.
The current declaration is `cargo-nextest`; it is available for fast Rust test
execution without becoming an Infra workspace dependency.

Keep distribution systemd as host supervisor. Templates are not automatically
installed; a catalogue or old health report does not establish a live deployment.
Protect runtime data with the runbook's verified backup/rollback procedure and
exclude secrets from Git/logs. Never reset an active child checkout to build a bundle.

## Validation

Documentation-only: links/anchors and `git diff --check`. For implementation or
release tooling, use the relevant gates below; deployment additionally needs live probes.

```bash
bun scripts/check-infra.ts
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo deny check
cargo run -- validate
cargo run -- pipeline --stage plan
cargo run -- service catalog
bun test scripts/
aphrody-infra pipeline --stage check
```

Deploy adapters (Linux or WSL, as root; systemd, Nginx, curl and Bun are stubbed):

```bash
bun run test:adapters   # test-atomic-deploy-{rg,shenron,bundle}.sh
```

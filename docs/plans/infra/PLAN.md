<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Infra plan

Open infrastructure work. `config/` owns topology/routing and
[inventory](../inventory/) holds dated observations. Execute authorized tasks
under [NHITL](../../reference/infra/AGENTS.md); backups, integrity checks and rollback remain technical gates.
Each live result is dated and scoped in the decision ledger; historical host
observations below must be revalidated before operational use.

## 1. Objective

One declared control plane and reproducible releases from pinned owner repositories.
Use [immutable releases](../../operations/infra/IMMUTABLE-RELEASES.md), [Shenron migration](../../reference/infra/SHENRON-MIGRATION.md)
and [authority map](../../reference/infra/UNIFIED-AGENT-CONTEXT.md); avoid duplicate registries or supervisors.

## 2. Current state (observed 2026-09-26, read-only ssh)

Historical observation, to revalidate before operations: VPS ran RG/Shenron;
Aphrody/NIE/IECode services were retired. VPS PostgreSQL and monitoring had failures.
DBFR held data/backups; WSL was the reference build host; Windows received off-host
backups. Bundle tooling was prepared but not activated. Exact identities, paths,
retirement markers and backup records belong to `inventory/` and the runbooks.

## 3. Open work, ordered

### P0 — Aphrody Bun fork

- Treat the [Aphrody Bun fork](../../operations/infra/BUN-FORK-OPERATIONS.md) as the primary platform
  development track. Pin its `main` and upstream revisions in
  [`config/bun-fork.json`](../config/bun-fork.json), qualify native ABI and
  cross-platform artifacts, then connect verified consumers.

### P0 — correctness of the working tree

Port migration, single service registry and the recorded local gate were completed
in the prior ledger. Revalidate catalogue consistency against the intended revision;
do not treat old counts or Git state as current evidence.

### P1 — data safety

- Verify the first scheduled DBFR PostgreSQL/SQLite and Windows pull cycles,
  hashes, acknowledgement and control restore; manual runs alone do not close this.
- After the Shenron release/shared backup location exists, qualify the VPS runtime
  SQLite backup timer and restore; retain unverified data-class markers until then.

### P1 — production activation

Build/activate the all-in-one bundle only after these runbook prerequisites pass:

1. Recover VPS PostgreSQL and verify integrity.
2. Pin a clean source closure; build on WSL with the required Shenron database tunnel.
3. Provision the fresh-host environment; restore the retained 2026-09-25 dumps without
   dropping existing data. Provision certificates, E5 weights and private credentials.
4. Install adapters matching the Infra pin, assemble RG and validate bundle/smoke attestations.
5. Deploy through the bundle adapter with rollback; prove MCP tools, real RAG/LLM/OCR
   and indexed crawl. Only then update retired markers and live inventory.

Existing RG deployment and prepared Shenron adapter do not prove this activation.

### P2 — host hygiene

- Decide required PostgreSQL/Redis/Docker boot behavior from live workloads.
- Re-declare VPN/forwarding only for an observed need.
- Refresh VPS inventory after mutations and add DBFR/WSL inventories.

### P3 — control-plane consolidation

- Generate nginx/systemd from service and route catalogues.
- Keep host `sync` distinct from source synchronization. The first-party source
  sync now fetches remotes, fast-forwards only clean/non-diverged worktrees, and
  gates pushes on Aphrody commit identity plus an Aphrody-owned destination;
  its optional poller is local, not a GitHub webhook.
- Run the native `workspace-git-audit` periodically to refresh submodule gitlinks,
  branches, forks, PRs, commits, releases, packages and Awesome Rust candidates.
  Complete package visibility requires the `read:packages` GitHub scope.
- Continue adopting Compat's `aphrody-toolchains`, remove redundant subprocesses where
  an owner API exists, and triage fork/vendor/documentation duplication.
- Run `nu scripts/scan-ui-crates.nu` from Infra to identify first-party crate/source duplicates,
  local dependency candidates for crates.io publication, vendor/third-party footprint across
  Aphrody owners and generated output sizes; migrate only after owner/API/license review and
  consumer validation.
- Continue the [Aphrody Bun platform](../../reference/infra/APHRODY-BUN-PLATFORM.md) plan from the P0
  fork track above. `bun:aphrody` is now on Aphrody `main`; native libraries
  remain dynamic, and cross-platform releases and consumer selection are open.
- Keep the consolidation controller in Infra: `@aphrody/workspace` owns the
  source inventory and guarded docs import for `/home/aphro/aphrody` and
  `/home/aphro/aphrody-py`; domain implementation moves to those monorepos.
  The first 2026-09-29 scan/import is recorded in Aphrody's generated migration
  maps. Link/attachment closure, nested submodule discovery, source conflicts,
  scripts, crates, apps/packages and Python extraction remain open; never infer
  completion from the copied document count.

### Post-split follow-ups (step-back review 2026-09-25, `src/docs/governance/STEP-BACK-REVIEW-2026-09-25.md`)

- Qualify remaining API inconsistencies in [API](../../apis/contracts/API.md),
  lenient app-server methods and hard-coded web origins against current owners.
- Recheck the standalone OVH test's missing rustls `ring` feature.
- Recheck AI deploy/comment paths and the UI native-build owner against current source;
  `aphrody-bun` is in UI, `aphrody-toolchains` in Compat.
- NIE/IECode CRI/VFS reuse remains owner work. Earlier CPU raster/search ports do not
  close it. Legacy repository archival is not part of a documentation update.

### Open decisions

- Resolve the Shenron asset CDN/media-proxy owner from live requirements.
- Keep distribution systemd as PID 1; alternatives require a disposable-host trial.

Previously listed domain/port questions were closed later in the old ledger:
`rpbey.fr` was sold and references removed; RG storage/realtime were absorbed into
RG API; orphan templates were neutralized; retired and reserved routes were distinguished.
Do not reopen these as unresolved solely because an earlier section listed them.
See [ports and domains](../../reference/infra/PORTS-AND-DOMAINS.md) and current catalogues.

## 4. Protected data (never reclaim without a verified off-host copy)

Protect application PostgreSQL/SQLite, runtime caches with user data, model/data
stores, published media and shared release state. Use the runbook's encrypted,
checksum-verified off-host backup and restore proof before destructive migration.
Source cleanup never authorizes removal of active runtime data.

## 5. Done (verified)

The previous ledger records registry consolidation, layered dependencies, utility
moves, retirement/backup operations, route fixes and bundle adapter checks. Those
results apply to their named revisions and dates, not current host health.

## 6. Decision ledger (append-only)

- **2026-09-29:** refreshed the `@aphrody/workspace` consolidation inventory
  against live Git state and added categorized script import. The latest scan
  covered 19 direct worktrees and 77,859 paths; 6,538 documents are indexed,
  with 202 byte-identical aliases and 1,297 unresolved local links. 454
  hash-qualified scripts were copied. The copied IECODE source snapshot was
  clean at `550066b66181c4aeffb90b4067e8af742b0c112b`; the latest scan sees
  IECODE at `797507d675690579e7bd632d83c212c7ae970e09`; later user-owned edits
  are preserved and represented in the live source map. The copied crate
  remains byte-identical. One 254-file IEVR data crate was
  copied into the new Cargo workspace, hash-compared with its source and
  checked via `cargo check --all-targets --locked --offline`. Its provenance
  and license boundary are recorded in
  `/home/aphro/aphrody/docs/migration/ievr-iecode-extraction.json`. The Bun
  binding/plugin and the NIE MCP child-process bridge remain unintegrated; no
  API parity is claimed. Nested submodules and missing checkouts remain open.
  The workspace package now resolves compiler TypeScript 7.0.2 and the explicit
  compiler API compatibility package `@typescript/typescript6` 6.0.2. Bun frozen
  install, package typecheck, oxlint and oxfmt check passed at this source state.
  Targets: `/home/aphro/aphrody` and `/home/aphro/aphrody-py`.

The pre-cleanup ledger is retained at [revision 917cb93c0afd](https://github.com/aphrody-code/aphrody-infra/blob/917cb93c0afd7b8883ad1dd5ee6397365609af10/docs/PLAN.md).
Retrieve locally with `git show 917cb93c0afd7b8883ad1dd5ee6397365609af10:docs/PLAN.md`.
Append new dated decisions here with owner/revision/evidence; keep the open-work
sections current and store operational detail in its existing runbook.

- **2026-09-28:** condensed documentation; preserved outstanding backup, activation,
  hygiene and consolidation gates; removed questions already closed in later entries.
  No live state was changed or requalified.
- **2026-09-28:** restored the dedicated Discord development endpoint as an Infra-owned
  Bun service on `bot.aphrody.com` (`:4010`), with a pinned bundle builder and rollback-capable
  activator. The app uses Carbon's signed HTTP interactions and OAuth2 routes, plus its Gateway
  plugin with Gateway interaction dispatch disabled; test slash commands target only the test
  guild. DNS already points at the VPS. TLS is issued, the route is live, Discord accepted
  `https://bot.aphrody.com/interactions`, the Gateway is READY, and the test guild's `/ping`
  command is registered. OAuth's callback URL is not in the app's registered redirect list;
  Discord's supported bot API omits redirect URI mutation, so portal registration remains the
  only required account-side setup. The SSH CLI compile blocker was fixed by enabling the Rustls
  `ring` provider feature in `aphrody-ssh`.
- **2026-09-28:** made Discord endpoint TLS renewal durable by installing the
  executable Certbot deploy hook at
  `/etc/letsencrypt/renewal-hooks/deploy/aphrody-nginx-reload`; a forced dry-run
  renewal invoked the hook successfully, and public HTTPS health remained
  `{"status":"ok","gatewayConnected":true}`. The provisioning runbook now
  installs the hook for new hosts. Shared Discord runtime/package consolidation
  is owned by Aphrody Discord; its architecture audit and Bun messaging port are
  tracked in that repository's `docs/PLAN.md`.
- **2026-09-28:** closed the Discord OAuth portal prerequisite: the callback
  `https://bot.aphrody.com/oauth/callback` is now in the application's redirect
  allowlist. A read-only Discord API check confirmed the registration, and the
  public `/oauth/login` route returned HTTP `302`; `/healthz` still reported
  Gateway readiness. The earlier ledger entry describes the pre-registration
  state at that point in time.
- **2026-09-28:** activated Aphrody Discord release
  `30f49b8913c01ef5cbc92e7ff557e757e20b776e`. Live `/oauth/login` returned 302
  with `identify`, profile/guild, bot-install, command, entitlement, webhook,
  and role-connection scopes; permission bitfield `8`; guild install type `0`;
  the fixed test-guild ID; consent prompt; and matching state cookie setup.
  `/healthz` continued to report Gateway readiness. The requested scope set is
  limited to Discord's published standard scopes; partner-only/local-RPC,
  deprecated, or flow-incompatible scopes remain excluded as cataloged by the
  application owner.
- **2026-09-28:** first-party Rust audit found 190 crates across Aphrody repos, no duplicate
  crate names and no byte-identical Rust source files in crate `src/` trees. The UI workspace
  manifest still references missing `aphrody-icons/vendor/woff2` and Obscura `vendor/taffy`
  paths, so Cargo metadata/build cannot validate that graph. UI third-party checkout is about
  1.1 GiB; Tailwind's ignored standalone output/cache account for 585 MiB and 499 MiB locally.
  These generated files are not tracked by Git and were not removed during this audit.
- **2026-09-28:** UI owner confirmed `third_party/base-ui` and `third_party/tailwindcss` are
  maintained Aphrody forks optimized for Bun and adapted for M3. Keep their source and fork
  patches; the scanner's size totals include ignored local build outputs and do not represent
  committed repository size.
- **2026-09-28:** the UI lockfile inventory contains 1,316 crates.io package entries across
  1,396 total lock entries (23 Git-sourced and 57 local/workspace entries); 123 registry crate
  names occur at multiple versions (175 extra
  version entries). This includes optional and target-specific packages; after the missing UI
  paths are repaired, use `cargo tree -d` on supported targets to identify reachable conflicts
  before attempting version consolidation.
- **2026-09-28:** across 10 first-party top-level lockfiles, the scan counted 8,124 package
  entries and 350 registry crate names with version skew between independent repositories. The
  skew is not itself a defect: these workspaces may target different platforms and do not share
  one resolved graph. Use it to prioritize common build-heavy packages and inspect each owner's
  supported target graph before changing version constraints.
- **2026-09-28:** shell/install split: `aphrody-shell` no longer compiles Nu's CLI command set or
  plugin manager; it keeps the in-process evaluator and inherits host environment values directly.
  Its lockfile drops `nu-cli` and all three `nu-plugin-*` crates (98 lockfile lines removed).
  Infra's optional developer suite now installs the ten global Nu plugin crates from crates.io
  and registers them on the local Nu installation. WSL check-only reported 25/25 Rust CLI
  commands and 10/10 plugin binaries and registrations already present. Focused offline
  `cargo check -p aphrody-nu` passed in 9.88 s; test suites were not run. Revisions:
  [Shell `17f4227`](https://github.com/aphrody-code/aphrody-shell/commit/17f422745fc565687b3bbcab44a87337679287c2),
  [Infra `98a901b`](https://github.com/aphrody-code/aphrody-infra/commit/98a901bccda18737a9fbf03cedfd2479fed8fb20),
  [OS `283a7153`](https://github.com/aphrody-code/aphrody-os/commit/283a71534194a111d04f2458bda7cd897d8bcab7).
- **2026-09-28:** registry audit of OS uutils companions found no safe crates.io substitution for
  the current source pins: registry `findutils` is 0.10.0 while the local tree is at 0.11.0;
  `uu_grep` 0.2.0 exists but the source checkout is 14 commits past that tag; the local `sed`
  0.3.0, `diffutils` 0.6.0 and `tarapp` 0.0.1 package versions are not published. Keep these
  source pins until matching releases or a compatibility comparison exists. The exact coreutils
  release remains on the crates.io installer path established in the earlier OS migration.
- **2026-09-28:** removed 12 unused direct dependency declarations identified by `cargo machete`
  in Infra (`aphrody-infra`, `aphrody-ovh`, `aphrody-ssh`, `aphrody-vpn`) and OS (`aphrody-compat`,
  `aphrody-systemd`). Their offline package checks passed; Infra's workspace scan is clean. OS's
  workspace scan still cannot load two local uutils manifests against the current workspace and
  reports the `md-5` crate alias, so those source-tree findings remain outside this cleanup.
- **2026-09-28:** removed 23 redundant direct Nushell feature declarations in Shell (27 reduced
  to the four top-level `network`, `os`, `rustls-tls` and `sqlite` capabilities; the resolved Nu
  feature graph is unchanged). In Web, removed two unused application dependencies and eight
  unused direct dependencies from Obscura crates, recording the fork manifest cleanup in
  `OBSCURA-UPSTREAM.txt`. Shell's offline `aphrody-nu` check, Web's offline all-target Obscura
  package checks and Web/Obscura Cargo Machete checks passed.
- **2026-09-28:** crates.io now publishes Taffy 0.14.0, but that source lacks three custom APIs
  consumed by Obscura render (`item_aspect_ratio_is_intrinsic`, `intrinsic_size_containment`,
  `set_calc_resolver`). Upstream Obscura still patches Taffy 0.12; retain its 1.1 MiB source until
  a compatible release or a separately validated replacement exists. Evidence: downloaded and
  inspected the 0.14.0 crate source and checked the current upstream Obscura manifest.

- **2026-09-28:** expanded the read-only scanner's footprint section to all Aphrody owner
  repositories and their nested vendor/third-party trees, excluding `.git` metadata from source
  footprint totals. Current source trees include 26 MiB under `aphrody-os/third_party`, 14 MiB
  under `aphrody-web/third_party`, and 1.2 GiB under UI's maintained fork tree; 1.1 GiB of UI
  generated Tailwind outputs remain ignored local artifacts. The OS submodule Git metadata has
  1.1 GiB in Bun and 217 MiB in uv history. Existing submodule checkouts are locally modified;
  no cleanup or pin changes were made.
- **2026-09-28:** narrowed Tokio features in Contracts, Shell and OS instead of enabling the
  `full` feature. Focused offline all-target checks passed for Contracts' six Tokio consumers,
  Shell's complete workspace and OS's selected kernel/runtime consumers. Their lockfiles no
  longer carry unused Tokio parking-lot/signal support. The broader OS package check exposed an
  unrelated Linux compile error in `aphrody-search/src/everything.rs` (`Path` is missing in the
  non-Windows stub); it remains open. Revisions:
  [Contracts `17cb078`](https://github.com/aphrody-code/aphrody-contracts/commit/17cb078),
  [Shell `85631d4`](https://github.com/aphrody-code/aphrody-shell/commit/85631d4),
  [OS `7d388fdc`](https://github.com/aphrody-code/aphrody-os/commit/7d388fdc).
- **2026-09-28:** fixed the Linux-only missing `Path` import found by that OS check;
  `cargo check --offline --workspace --all-targets` now passes. Revision:
  [OS `8cf333d9`](https://github.com/aphrody-code/aphrody-os/commit/8cf333d9).
- **2026-09-28:** the Infra scanner now resolves its default UI root relative to its script,
  finds vendor roots at arbitrary depth, and inventories workspace/crate path and Git
  dependencies plus local/Git patches across Aphrody owners. A synthetic sibling-workspace run
  from `/tmp` found a direct local dependency, workspace and crate Git dependencies, a four-level
  vendor tree, and its generated `target`; no live UI checkout was scanned. Revision:
  [Infra `bf3390a`](https://github.com/aphrody-code/aphrody-infra/commit/bf3390a).
- **2026-09-28:** Web's workspace Tokio `full` request is also enabled by upstream
  `deno_core 0.412`, whose manifest hardcodes Tokio `full`; narrowing the Web root declaration
  would not reduce the resolved graph, so no manifest change was retained. Its workspace check
  exposed a Rust 2024 extern-block error in the index benchmark; the focused all-target check now
  passes after the fix in [Web `ee641f0`](https://github.com/aphrody-code/aphrody-web/commit/ee641f0).
- **2026-09-28:** the scanner's `--skip-ui` path now avoids opening UI manifests and lockfiles,
  including when another repository's local dependency points into UI. A temporary sibling
  fixture with deliberately invalid UI `Cargo.toml` and `Cargo.lock` plus a path dependency into UI
  completed successfully. The live scan excluded UI and found 169 first-party crates, no repeated
  crate names or byte-identical crate sources, 192 local path dependencies, 28 static crates.io
  candidates, two Git dependencies, nine lockfiles with 248 cross-lockfile version-skew groups,
  and no generated output under vendor/patch roots. `cargo info` confirmed representative local
  candidates (`aphrody-a2a@0.3`, `aphrody-n2b-core@0.6.2`, `aphrody-subsystem@1.0.0-canary`) are
  not available at those registry versions; do not replace local contracts with missing releases.
  Current non-UI source footprints include 26 MiB in OS third-party, 14 MiB in Web third-party,
  1.1 MiB Obscura Taffy and 124 KiB of Shell patches. No UI checkout contents were read.
- **2026-09-28:** Shell replaced its Rio `rio-vt` source path with the exact crates.io
  `=0.5.28` package and removed the unused 26 MiB copied Rio workspace. The published crate's
  `.cargo_vcs_info.json` identifies the same upstream commit previously copied; its library files
  match the registry source, and `cargo info` reports MIT. Shell's focused backend check and OS's
  kernel all-target check pass offline and locked; `cargo tree` confirms the PTY feature stays off.
  OS's lockfile now records the same registry source. Revisions:
  [Shell `198b024`](https://github.com/aphrody-code/aphrody-shell/commit/198b024),
  [OS `d7b95c78`](https://github.com/aphrody-code/aphrody-os/commit/d7b95c78).
- **2026-09-28:** the two Koharu Git dependencies remain justified by registry compatibility.
  `hf-hub@1.1.0` is absent from crates.io; the available `1.0.0` source lacks the 1.1 transport,
  redirect and cache fixes used by the current Git revision. Crates.io `tauri-specta@2.0.0-rc.25`
  depends on Tauri 2, while Koharu pins Tauri 3 alpha and uses its matching fork tag. Do not
  substitute either dependency until compatible releases exist.
- **2026-09-28:** `aphrody-git` was exercised against the source workspaces and their GitHub
  remotes, including local branch/commit/worktree inspection, REST metadata/forks/branches/PRs/
  commits/releases, account GraphQL, Git submodules, and the Awesome Rust index. The audit found
  the Compat Bun checkout clean but at `ad0d3192`, while the parent gitlink pins `bf80d21c`; seven
  other initialized submodules have local modifications and were left intact. The eight owned
  Aphrody repos each returned zero forks, PRs and releases at observation time. GitHub Packages
  returned 403 because the active token has no `read:packages` scope. Obscura upstream commit
  `1a3169da276d7720732c7b20535474942917fb83` was API-verified and fetched into ignored
  `target/research/obscura-upstream`; the digest covered 382 files. Reports are local research
  artifacts and do not prove a permanent external archive.
- **2026-09-28:** added `scripts/source-sync.ts`, `workspace-git-audit` and package workflow aliases.
  Source sync plans by default; apply fetches all remotes and only fast-forwards clean branches.
  Pushes require an explicit flag, exact Aphrody author/local identity and an Aphrody-owned remote.
  Dirty/diverged worktrees and submodules are preserved. A 60-second local polling mode is
  available; it is not server-side real-time replication. `workspace:workflow` sequences source
  sync, the GitHub audit and non-UI full crate/source inventory; dependency mutation stays scoped
  to the selected clean owner repository. Validation and delivery evidence are recorded at the
  revision that implements this entry.
- **2026-09-28:** local RAG/model review found the dedicated SQLite/BM25/vector/hybrid crates and
  model catalog already exist in AI. The local catalog contains 17 model entries; its runtime
  store is separate from source synchronization. The Bun fork at `/home/aphro/src/bun` was clean
  and matched `upstream/main`, so no Bun-specific delta exists in this checkout to learn from.
  AI's LoRA worker is full-precision and QLoRA is explicitly unimplemented; train-on-Bun remains
  AI owner work requiring a curated/evaluated dataset and a QLoRA-capable path for larger code
  models. The 4070 has 12 GiB VRAM; download only catalog models required by enabled workflows,
  not every optional OCR/speech/vision/chat model. A repository-RAG plugin candidate (`rag-rat`)
  uses executable hooks outside the sandbox and must pass source/hook review before installation.
- **2026-09-28:** the scanner now inventories Cargo package manifests and hashes Rust files under
  copied vendor/third-party/patch roots, using only outermost roots to avoid counting nested trees
  twice. The non-UI scan found 130 package manifests, no package-name overlap with first-party
  crates, two repeated names (`uufuzz`, `uucore-fuzz`) and eight exact Rust-source groups. These
  copies are inside locally modified uutils submodules, mainly fuzz/test fixtures; preserve them
  pending the owners' changes. Eleven packages pass only static publication-policy/version
  checks: exact registry queries show some are absent, while published `uufuzz` copies are adapted
  to local uutils sources, `proc-macro-error2` fixes a compiler compatibility issue, Taffy carries
  Obscura APIs, and the modified `agent-browser` CLI is not on crates.io. No replacement was made.
  The UI-invalid fixture also passes the expanded copied-package scan without opening UI files.
- **2026-09-28:** installed the locked `aphrody-train` full Python extra in its isolated
  `py/aphrody-train/.venv`; Torch 2.8 CUDA 12.9 imports successfully and detects the RTX 4070.
  Aphrody's model pull for `qwen3-coder-30b-a3b-q4km` was paused at 7.26/17.28 GiB in the
  user model store and can be resumed with `target/debug/aphrody model pull
  qwen3-coder-30b-a3b-q4km`. Bun remains identical to `upstream/main`; training is pending a
  curated Bun rollout/gold dataset and a QLoRA-capable trainer. The existing RAG/index/model
  stack needs no duplicate Codex plugin; `rag-rat` remains uninstalled because its hooks execute
  outside the sandbox.

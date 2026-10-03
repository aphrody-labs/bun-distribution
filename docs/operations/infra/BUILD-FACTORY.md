<!-- SPDX-License-Identifier: Apache-2.0 -->
# VPS build factory and DBFR Shenron runtime

Owner: Infra. Policy: [`config/build-factory.json`](../../../config/build-factory.json).
Requested placement: [`production-topology.json`](../../../config/production-topology.json).

## Authority and execution

VPS (`ssh vps`) owns heavy Rust, Bun and Python builds, tests and releases.
WSL and Windows retain sources, editing, help, plans and scoped static checks.
Shenron runtime moves to DBFR; RG runtime is requested stopped completely.
These are desired placements, not a claim that migration is complete.

Use the Workspace factory facade and existing native Infra SSH operations.
Read their current help before running. Source transfer uses
`aphrody-infra ssh sync --host vps --source <clean-owner-checkout> --destination <repository-root>`;
review the dry run before adding `--apply`. Generated build trees and `.git/**` are excluded. Bootstrap each remote
first-party checkout through its private Git remote or a verified Git bundle
before source sync; sync alone cannot create revision provenance. The existing
`scripts/prepare-release-workspace.sh SOURCE FULL_SHA DEST` supports current
first-party monorepos without submodules as well as historical source layouts. Preserve
that remote Git metadata and require it to match the requested source revision.
The factory verifies a full requested Git revision and clean tracked source
before execution. Do not synchronize credentials, protected data, model weights
or another repository's generated artifacts into the build source.

A single factory lock bounds heavy jobs across owners. Rust additionally uses
`scripts/build/rust/cargo-serial.sh`, at most six rustc jobs, incremental disabled
and sccache enabled. Bun heavy jobs run singly against the frozen lockfile.
Caches live outside source snapshots under `/srv/aphrody-build/cache`; immutable
artifacts under `/srv/aphrody-build/artifacts`. Provision directory ownership and
pinned toolchain through Infra before execution. Keep cache reuse and record
source revision, toolchain versions, command, exit status and artifact hashes.

## Shutdown and migration gates

Stop and disable all RG workload services, timers and watchdogs discovered
both through the catalogue and live unit listing. Preserve PostgreSQL, Redis,
shared objects, releases, private environment files and backups; shared services
must not be stopped merely because RG consumed them. Host swap such as
`rg-zram-swap` is an OS resource, retained for factory stability. Observe no RG processes
or listeners after shutdown. A disabled timer or supervisor must not restart RG.

Before Shenron cutover, checksum backup and transfer its mutable shared state,
private host configuration and immutable release to DBFR. Preserve host-local
secret permissions. Build on VPS, transfer the sealed artifact, install Infra
adapters on DBFR and perform the existing deploy plan before applying. Verify
loopback application readiness, database/Redis access, routing and public TLS.
Do not run two Discord gateway consumers. Stop the VPS bot before starting the
DBFR bot. Keep the old release and routing as rollback until DBFR is qualified.

The VPS PostgreSQL tunnel is retained until DBFR consumers use local private
PostgreSQL and have passed readiness; never move primary DB files with source
sync. DNS/proxy changes and cache retention remain Infra-owned workflows.

## Read-only observation, 2026-10-03

Native `aphrody-infra ssh exec` found VPS: 12 CPUs, 47,035 MiB RAM,
29,322 MiB available, 127 GiB free on the root filesystem. DBFR: 6 CPUs,
11,671 MiB RAM, 7,311 MiB available, 51 GiB free. Both expose Bun,
Cargo/Rust, sccache and uv on the observed SSH PATH.

VPS still had five RG services and Shenron site/bot/PostgreSQL tunnel active.
DBFR had nginx, PostgreSQL 18 and Redis active, without Shenron runtime units.
No shutdown or deployment was performed by this observation. Root capacity
must be rechecked before large native builds; missing native SDKs and model
assets are not implied by the installed toolchains.

## Shenron artifact contract

The existing atomic adapter accepts `sourceLayout: "monorepo"` and
`target: "dbfr"` in `release.json`, with `repository: "aphrody-labs/aphrody"`.
Absent fields retain legacy VPS behavior. Monorepo source maps to
`apps/shenron/site` and `apps/shenron/bot`; artifact schema remains
`shenron-site-artifact/v1`. Assembly renders unit paths before sealing hashes.
DBFR requires private 0600 environment files and loopback PostgreSQL on port
5432 before removing the VPS tunnel dependency. This validates configuration;
application readiness still establishes live database access.

## Existing owner commands on the qualified VPS checkout

Load `SITE_BUILD_DATABASE_URL` from the existing private host environment.
Prepare the pinned IECODE archives before the root frozen install. Run serially:

```sh
bun run --filter @shenron/bot compile
bun scripts/build/shenron/scripts/ops/build-site-external.ts
bun scripts/build/shenron/scripts/ops/package-site-artifact.ts artifacts/site-build.tar.gz --release-dir artifacts/shenron-release
```

The first command compiles the bot; the second runs site owner prebuild and
Next, then seals the site artifact. The third packages the exact clean Git
revision plus compiled bot and verified pinned IECODE archives into the existing
Infra payload shape. Transfer the payload to DBFR, then use the existing adapter
`assemble` mode and native Infra deployment plan/apply. Packaging fixture gates
do not establish a successful real site build or runtime deployment.

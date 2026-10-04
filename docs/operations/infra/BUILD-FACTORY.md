<!-- SPDX-License-Identifier: Apache-2.0 -->
# Build factory transition and DBFR Shenron runtime

Owner: Infra. Policy: [`config/build-factory.json`](../../../config/build-factory.json).
Requested placement: [`production-topology.json`](../../../config/production-topology.json).

Current owner decision, 2026-10-03: [Yolo PLAN](../../../../yolo/PLAN.md#build-et-release)
reserves VPS for execution and retires its build toolchains and factory workspace.
The previous VPS setup below is historical procedure, not authority to recreate
that role. `executionOnlyTargets: ["vps"]` in the current factory configuration
refuses build dispatch there and keeps heavy local execution blocked by default.
A replacement build host must be designated before executable CLI tests,
engine builds or releases can resume. Explicit scoped local static diagnostics
retain the existing owner policy; they do not designate a build host.

## Authority and execution

Before the retirement decision, VPS (`ssh vps`) owned heavy Rust, Bun and Python builds, tests and releases.
WSL and Windows retain sources, editing, help, plans and scoped static checks.
Shenron runtime moves to DBFR; RG runtime is requested stopped completely.
These are desired placements, not a claim that migration is complete.

Use the Workspace factory facade and existing native Infra SSH operations.
Read their current help before running. Source transfer uses
`aphrody-infra ssh sync --host vps --source <clean-owner-checkout> --destination <repository-root>`;
review the dry run before adding `--apply`. Generated build trees and `.git/**` are excluded. Bootstrap each remote
first-party checkout through its private Git remote or a verified Git bundle
before source sync; sync alone cannot create revision provenance. The factory
works from the monorepo checkout only; the former superproject preparation script was
retired. Preserve
that remote Git metadata and require it to match the requested source revision.
The factory verifies a full requested Git revision and clean tracked source
before execution. Do not synchronize credentials, protected data, model weights
or another repository's generated artifacts into the build source.

Factory dispatch gives native SSH a finite six-hour deadline through
`APHRODY_SSH_COMMAND_TIMEOUT_SECS`; short inspections keep the thirty-second
default. The calling Infra binary must include this option. Both factory and
Cargo locks use `flock --close` so a persistent sccache daemon cannot retain
build locks after the owner command ends.

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
bun scripts/build/shenron/scripts/ops/build-site-external.ts --release-dir artifacts/shenron-release
```

The first command compiles the bot; the second runs site owner prebuild and
Next, then invokes its packager once to seal the site and release payload.
The exact clean Git revision, compiled bot, owner-built dependencies and
verified pinned IECODE archives use the existing Infra payload shape. Transfer the payload to DBFR, then use the existing adapter
`assemble` mode and native Infra deployment plan/apply. Packaging fixture gates
do not establish a successful real site build or runtime deployment.

## Direct shared-state migration

Existing VPS-to-DBFR SSH authentication was verified read-only on 2026-10-03;
no temporary credentials or WSL data relay are required. Invoke the existing
Infra-owned migration adapter from the qualified VPS checkout:

```sh
bash scripts/migration/shenron-shared-transfer.sh prepass
bash scripts/migration/shenron-shared-transfer.sh prepass --apply
# Pause source site, bot, backup service/timer through Infra before final pass.
bash scripts/migration/shenron-shared-transfer.sh final --apply
```

The destination and `/srv/aphrody-infra/migrations/shenron-transfer-partial`
must already exist with owner write access. Only `site`, `bot` and `coord` are
transferred; historical backup stores remain on VPS. Transfer defaults to
50 MiB/s, bounded by validated `SHENRON_TRANSFER_KIB_PER_SEC`. Partial files
stay in the Infra migration directory outside protected shared stores. Prepass keeps
source services running; final pass refuses active source writers and checks
all source file hashes on DBFR. It never deletes destination stores. Evidence
manifests remain private host-local files, and all large objects move directly
between servers. Private runtime environment files require separate scoped
host-to-host transfer through Infra, retaining 0600 permissions.

## Private runtime configuration and Nginx qualification

`shenron-env-transfer.sh` plans by default. Run `--apply` only on VPS through
Infra SSH: site/bot and optional compute environment streams directly to DBFR,
with no private payload stored in the source checkout or on WSL. Source files
must be regular 0600 files. Runtime PostgreSQL and Redis URLs become DBFR-local;
explicit remote/build database URLs retain their semantics. Destination files
are root-owned 0600, installed atomically, with private preexisting-file backups.
Run the same adapter `--probe` on DBFR to test its configured local PostgreSQL
connection without putting credentials in argv or logs. This is a connection
probe, not schema or product qualification.

DBFR Nginx 1.28.3 was observed with SSL and HTTP/3 modules; certificates for
site, bot and CDN were readable through root. Install the committed Infra
adapters/catalogs before assembling and activating. The current catalog probes
are site `http://127.0.0.1:5011/api/health` and bot
`http://127.0.0.1:5006/health`. The atomic adapter checks public TLS with local
`--resolve` before completing activation. Keep source runtime/routing for
rollback; quiesce the VPS bot before starting the DBFR gateway, and change DNS
or proxy routing only after DBFR is qualified.

## Install only the target adapter without a production source clone

From a clean committed VPS factory checkout, export the existing installer:

```sh
bash scripts/install-vps-adapter.sh --stack shenron --package ~/.cache/aphrody/shenron-adapter-FULL_SHA
```

Transfer that small sealed directory directly VPS-to-DBFR into
`/srv/aphrody-infra/adapters/FULL_SHA`. It contains only the installer,
Shenron adapter, three catalogs and `SOURCE-MANIFEST.json`; no Git metadata,
private configuration, dependency trees or source workspace is required.
Install on DBFR as root:

```sh
bash /srv/aphrody-infra/adapters/FULL_SHA/scripts/install-vps-adapter.sh --stack shenron --source-manifest /srv/aphrody-infra/adapters/FULL_SHA/SOURCE-MANIFEST.json --revision FULL_SHA
```

The requested full revision, exact file set, hashes and contained regular file
paths are checked before installation. Default invocation from a clean checkout
continues to install all four adapters. Target-only installation leaves unrelated
adapter executables alone and records its installed hashes in `ADAPTER.json`.

When heavy builds hold the current factory checkout, export a newer fetched
commit without switching HEAD or requiring another clone. Stage the committed
installer outside the checkout and set `APHRODY_ADAPTER_SOURCE_ROOT` to its
existing Git root:

```sh
APHRODY_ADAPTER_SOURCE_ROOT=/srv/aphrody-build/workspaces/aphrody bash ~/.cache/aphrody/install-vps-adapter-current.sh --stack shenron --package ~/.cache/aphrody/shenron-adapter-FULL_SHA --revision FULL_SHA
```

This explicit revision mode reads the five regular files directly from Git
objects and seals their hashes. It verifies the requested commit is present
and leaves HEAD and working files untouched. Default HEAD export retains its
clean-source requirement. No fake Git metadata is installed on DBFR.

## Old-IP compatibility during DNS propagation

The observed VPS file `/etc/nginx/conf.d/shenron.conf` owns only apex, www,
bot and CDN; unrelated hosts have separate files. The bounded existing Infra
migration adapter `shenron-nginx-forwarder.sh` plans by default. Apply it as
root on VPS only after DBFR has passed TLS/readiness and source site/bot are
stopped. It uses the fixed DBFR IPv4 from the Ubuntu SSH alias, forwards over
verified HTTPS with explicit SNI and original Host, and preserves WebSockets.
It backs up only the dedicated Shenron file and rolls back on Nginx or local
TLS probe failure. No Shenron application process remains on VPS.

Keep this compatibility route through the longest published TTL (600 seconds
at the observation) plus propagation margin. Change only apex/www/bot/CDN DNS;
`files` already targets DBFR and retired MCP is excluded. After authoritative
and client DNS checks converge and old-IP traffic has drained, remove only the
temporary dedicated file through Infra, retain its backups and validate/reload
Nginx. `restore BACKUP` restores the old configuration for coordinated runtime
rollback; it does not restart application services.

## Isolated Bun runtime dependencies

Monorepo assembly and activation require Next under the site owner:
`apps/shenron/site/node_modules/next/dist/bin/next`. Generated site units use
that same path before sealing; only legacy artifacts retain the root fallback.
The source payload includes compiled first-party directories selected by the
existing Workspace dependency build plan for site and bot. Owner manifests
determine `dist`/`build` roots; missing outputs or tracked-source collisions fail
packaging. The observed plan selects Discord Kit, M3 Motion and M3 Primitives.
Their generated files are sealed inside the source archive and their owners
recorded in `firstPartyArtifacts`; DBFR does not rebuild those dependencies.

## Backup ownership after cutover

Read-only DBFR observation found both PostgreSQL and SQLite backup timers
active/enabled with successful jobs on 2026-10-03. Existing PG archives used
242 MiB and SQLite archives 380 MiB. The new active `bot.db` measured
286,408,704 bytes. Site/media assets are excluded from this database backup.

Retarget the existing `shenron-sqlite-replica-backup.service` to the active
`/srv/shenron/shared/bot/data/bot.db`; keep its timer and existing destination
for the Windows offsite acknowledgement contract. The source VPS backup timer
is disabled at cutover, not duplicated on DBFR. Export/install the committed
small adapter package with `--backup-owner` to include the canonical libexec
script and service. Reload units separately; do not disable existing DBFR
PostgreSQL or SQLite timers.

SQLite backup uses read-only VACUUM INTO, private files, a 2 GiB archive budget
and 4 GiB free-space floor with conservative temporary-space accounting.
Capacity failures preserve existing backups; age retention still requires
verified offsite acknowledgements. No media is recursively archived.

Final shared-state transfer requires inactive runtime writers on both hosts.
Source checkpoint removal of SQLite WAL/SHM is handled by quarantining stale
target sidecars only for matching source main databases. Relative paths,
checksums and file metadata are retained outside protected stores; no broad
`--delete` or deletion of protected database files is used.

## Observed compiler boundary

The first real Shenron build under Bun 1.4.2/Next 16.3.8 remained idle in
compile: thirty sleeping threads, no child process or TCP connection and no
output progress for over four minutes. It was stopped after 393 seconds; these
observations do not identify the missing callback. Shenron now reuses the
existing immutable Next boundary from the RG assembler: cached Node 22 Docker
image, inspected full image ID, no pull, six CPU quota, 16 GiB container memory
and 8 GiB Node heap. Bun retains dependency preparation, packaging and runtime.
Compiler image identity and resource limits are sealed with successful artifacts.

## External outputs and runtime-only assembly

Future factory jobs write to the declared artifact store, with a default
`shenron-FULL_SHA` namespace. `APHRODY_ARTIFACT_ROOT` can select an absolute
subdirectory only inside that declared store on the VPS factory. Absolute or
traversing output arguments and escaping symlinks are refused. Legacy callers
retain relative checkout outputs. Factory packaging leaves the checkout clean,
including untracked files, so the next pinned job passes its source guard.

`build-site-external.ts --release-dir RELATIVE_DIRECTORY` passes the release
request to its packager once; avoid running a second packaging command after
that invocation. Existing qualified artifacts retain their original source
pin; these tooling fixes do not repackage or repin earlier releases.

DBFR monorepo assembly installs with `bun install --frozen-lockfile
--ignore-scripts`. Registry prebuilts and sealed first-party outputs are consumed;
native lifecycle compilation stays on VPS. Legacy assembly behavior remains
compatible. If runtime qualification reveals a required generated native
artifact, build/seal it on VPS and transfer it rather than compile on DBFR.

### Redis state cutover

Redis is shared infrastructure. Keep source Redis running; stop only Shenron writers before the final snapshot. The existing replica owner preserves the complete RDB, including all logical databases; this migration follows that contract rather than selecting keys.

Run `bash scripts/migration/shenron-redis-transfer.sh` on VPS for the plan, then `bash scripts/migration/shenron-redis-transfer.sh --apply` through Infra SSH after both hosts' site/bot units are inactive. The adapter requires identical Redis versions, target AOF disabled, target `/var/lib/redis/dump.rdb`, and an empty active target. It captures a fresh source snapshot with `redis-cli --rdb`, checks it privately with `redis-check-rdb`, and streams it directly to DBFR. Root-private evidence and the original target RDB/AOF remain under `/srv/aphrody-infra/migrations/shenron-redis-*`; nothing transits WSL.

Only DBFR Redis restarts; its enabled state is unchanged. SHA-256 must match before import. Qualification requires equal nonexpiring counts per database and allows expiring keys to disappear during transport. Changes in source nonexpiring counts refuse import. Failed target qualification restores the previous target RDB and restarts Redis. Keep every target client inactive throughout this operation, including other potential Redis writers. Aggregate count checks prove transport/expiry consistency; they do not prove application behavior. Do not activate a second bot.

### Shared compute transport

Shenron's compute client requires a loopback HTTP endpoint. Keep the existing VPS compute service and protected model store in place; supervise the VPS→DBFR reverse tunnel with `yolo/config/host/systemd/aphrody/aphrody-compute-dbfr-tunnel.service`. Install its helper at `/usr/local/libexec/aphrody-infra/shenron-compute-dbfr-tunnel.py` and the unit under `/etc/systemd/system`, then reload and enable it through Infra. Root reads only the port from the existing private compute environment before dropping to Ubuntu for SSH. No token is transferred or placed in process arguments. The SSH forward binds DBFR `127.0.0.1` to the same VPS loopback port, with forwarding failure and keepalive checks. Verify DBFR's listener is loopback-only and run the existing authenticated compute client probe before Shenron activation. This generic compute tunnel remains after the obsolete PostgreSQL tunnel is retired.

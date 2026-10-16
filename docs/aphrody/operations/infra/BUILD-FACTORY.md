<!-- SPDX-License-Identifier: Apache-2.0 -->

# VPS build factory and DBFR Shenron runtime

Owner: Infra. Policy: [`tools/config/build-factory.json`](../../../../tools/aphrody/config/build-factory.json).
Requested placement: [`production-topology.json`](../../../../infra/config/production-topology.json).

Current placement: Omar's Windows PC (`omar-pc`) is the native Windows build
factory, in addition to the SSH VPS factory. The Windows factory is scoped to
Windows native builds, packaging and smoke checks; x64 is native-qualified and
ARM64 is a cross-build until tested on native ARM hardware. Run one heavy build
at a time, preserve 6 GiB RAM and 20 GiB free disk, and do not enable automatic
cleanup. The local checkout is `C:/src/aphrody`.

The SSH VPS remains the serialized Rust/Bun/Linux and multi-platform factory,
with its shared lock and pinned-source checks. Use native SSH execution through
Infra for that work and recheck the separate `/home/ubuntu/build` volume before
dispatch. Windows capacity does not replace VPS receipts or qualify Linux builds.

## Authority and execution

VPS (`ssh vps`) owns heavy Rust, Bun and Python builds, tests and releases under
the current declared factory policy.
WSL and Windows retain sources, editing, help, plans and scoped static checks.
Shenron runtime moves to DBFR; RG runtime is requested stopped completely.
These are desired placements, not a claim that migration is complete.

Owner directive 2026-10-09 (« exploite nos deux VPS pour build et prod ») restores DBFR as a bounded secondary
Cargo host beside its production (`hosts.dbfr` of `tools/config/host/vps-cargo.json`): rustup 1.98.1 and
sccache 0.18.0 under `~ubuntu/.cargo`, checkout and caches under `/home/ubuntu/aphrody-build`, 3 jobs at most, nice
10, sccache 8G, no desktop libraries. `bun scripts/build/rust/vps-cargo.ts run --host dbfr -- <cargo args>`, or
`--host auto` to fall back there when the vps heavy lock is busy. Shenron repositories and releases stay on the vps.

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
Caches live outside source snapshots under `/home/ubuntu/build/cache`; immutable
artifacts under `/home/ubuntu/build/artifacts`. Provision directory ownership and
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
`shenron:apps/site` and `shenron:apps/bot`; artifact schema remains
`shenron-site-artifact/v1`. Assembly renders unit paths before sealing hashes.
DBFR requires private 0600 environment files and loopback PostgreSQL on port
5432 before removing the VPS tunnel dependency. This validates configuration;
application readiness still establishes live database access.

## Existing owner commands on the qualified VPS checkout

Load `SITE_BUILD_DATABASE_URL` from the existing private host environment.
Prepare the pinned IECODE archives before the root frozen install. Run serially:

```sh
bun run --filter @shenron/bot compile
bun scripts/build/build-site-external.ts --release-dir artifacts/shenron-release
```

The first command compiles the bot; the second runs site owner prebuild and
Next, then invokes its packager once to seal the site and release payload.
The exact clean Git revision, compiled bot, owner-built dependencies and
verified pinned IECODE archives use the existing Infra payload shape. Transfer the payload to DBFR, then use the existing adapter
`assemble` mode and native Infra deployment plan/apply. Packaging fixture gates
do not establish a successful real site build or runtime deployment.

## Completed VPS-to-DBFR migration

The one-shot migration adapters (shared state, private environment transfer, old-IP Nginx forwarder and Redis
cutover) were removed after the 2026-10-09 cutover: Redis, Nginx and the PostgreSQL tunnel are retired from the VPS
([migration record](migration-vps-dbfr-2026-10-09.md)). Git history keeps their sources.

## Nginx qualification

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
bash scripts/tools/install-vps-adapter.sh --stack shenron --package ~/.cache/aphrody/shenron-adapter-FULL_SHA
```

Transfer that small sealed directory directly VPS-to-DBFR into
`/home/ubuntu/apps/infra/adapters/FULL_SHA`. It contains only the installer,
Shenron adapter, three catalogs and `SOURCE-MANIFEST.json`; no Git metadata,
private configuration, dependency trees or source workspace is required.
Install on DBFR as root:

```sh
bash /home/ubuntu/apps/infra/adapters/FULL_SHA/scripts/install-vps-adapter.sh --stack shenron --source-manifest /home/ubuntu/apps/infra/adapters/FULL_SHA/SOURCE-MANIFEST.json --revision FULL_SHA
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
APHRODY_ADAPTER_SOURCE_ROOT=/home/ubuntu/src/aphrody bash ~/.cache/aphrody/install-vps-adapter-current.sh --stack shenron --package ~/.cache/aphrody/shenron-adapter-FULL_SHA --revision FULL_SHA
```

This explicit revision mode reads the five regular files directly from Git
objects and seals their hashes. It verifies the requested commit is present
and leaves HEAD and working files untouched. Default HEAD export retains its
clean-source requirement. No fake Git metadata is installed on DBFR.

## Isolated Bun runtime dependencies

Monorepo assembly and activation require Next under the site owner:
`shenron:apps/site/node_modules/next/dist/bin/next`. Generated site units use
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
`/home/ubuntu/apps/shenron/shared/bot/data/bot.db`; keep its timer and existing destination
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

### Shared compute transport

Shenron's compute client requires a loopback HTTP endpoint. Keep the existing VPS compute service and protected model store in place; supervise the VPS→DBFR reverse tunnel with `tools/config/host/systemd/aphrody/aphrody-compute-dbfr-tunnel.service`. Install its helper at `/usr/local/libexec/aphrody-infra/shenron-compute-dbfr-tunnel.py` and the unit under `/etc/systemd/system`, then reload and enable it through Infra. Root reads only the port from the existing private compute environment before dropping to Ubuntu for SSH. No token is transferred or placed in process arguments. The SSH forward binds DBFR `127.0.0.1` to the same VPS loopback port, with forwarding failure and keepalive checks. Verify DBFR's listener is loopback-only and run the existing authenticated compute client probe before Shenron activation. This generic compute tunnel remains after the obsolete PostgreSQL tunnel is retired.

## Single transient resource and targeted cleanup (2026-10-07)

`tools/config/build-factory.json` declares one factory scratch root:
`/home/ubuntu/build/transient`, mode 0700 and owned by the build user. All
Workspace factory commands, including detached jobs, the exact-worktree VPS
Cargo route and direct VPS Cargo/Forge routes share the existing
`/home/ubuntu/build/locks/heavy.lock`. They set `TMPDIR` to that root and empty
its contents before and after qualified foreground execution. Forge uses its
`forge/` subtree instead of creating another loop device or tmpfs. Cargo target
directories, global sccache, Bun/uv caches, source snapshots, retained artifacts
and protected stores remain outside this transient resource.

Direct-route reentry verifies the kernel FLOCK's device, inode and owner against
the inherited process ancestry. Setting `APHRODY_FACTORY_RESOURCE` alone cannot
skip the heavy lock. The direct-route supervisor also retains the lease after
an abruptly terminated owner while a surviving build child uses the resource;
a fixture verified that the competing lock stays blocked until that child exits,
then the temporary contents are removed and the lease released. Foreground
EXIT/INT/TERM cleanup preserves the original command status.

Removal checks every visible process's cwd, executable, open descriptors,
arguments and environment, plus mount points and running Docker bind mounts.
A process proved by `/proc/locks` to be waiting on this exact heavy-lock inode
may mention the resource in queued arguments/environment; actual cwd, executable
and descriptor references still preserve it. This prevents a queued follower
from blocking the current lease's terminal cleanup. Other queued references remain
protected. Unreadable observations or live references preserve the resource; no live
process is terminated. The resource is not reused while those references remain.
These routes use the existing `/usr/bin/sudo-rs` on VPS and DBFR (observed
0.2.13-0ubuntu1.2); local tests use the host's existing sudo without replacing it.
An abrupt host failure retains contents for the next qualified cleanup.

Use the existing Workspace/Infra owner to plan before apply:

```sh
bin/yolo ops build-factory cleanup
bin/yolo ops build-factory cleanup --apply
```

Only declared retired immediate-child Cargo target directories are eligible.
Each requires a regular terminal receipt, canonical directory identity, absence
of nested mounts and fresh process/container isolation checks. Apply additionally
holds the heavy lock. Missing targets are reported as absent, not reconstructed.
Do not substitute the broad historical VPS reclaim target for this allowlist.

The retained native apply receipt records 8,509,566,976 allocated bytes removed
from `obscura-fork`, `vu-uv`, `vu-ruff` and `vu-wsl`; source and runtime receipts
were retained. A subsequent read-only native observation found those four paths
absent, transient allocation 4096 bytes and `/srv` availability 26,408,816,640
bytes (92% use). These observations include intervening concurrent builds and do
not establish an isolated before/after filesystem delta. The new transient
route's native probe acquired the existing lock, wrote a payload and confirmed
the root empty after terminal cleanup.

Qualification: 90 scoped tests / 424 assertions passed across factory planning,
cleanup, exact-worktree Cargo routing and Forge suites; Workspace and Yolo
TypeScript checks, strict scoped oxlint, oxfmt and Bash syntax passed. Fixtures
cover failure exit preservation, symlinks, live children, queued arguments,
environment references, Docker bind mounts, inherited lease proof and owner
termination. This receipt proves these declared host routes; it does not turn
persistent compiler caches into disposable scratch or migrate arbitrary
independently invoked container builds.

The follow-up fifth allowlisted retirement removed the terminal `cargo/aphrody`
target (30,700,023,808 allocated bytes). Its isolated native apply observed
`/srv` availability rise from 24,378,413,056 to 55,078,424,576 bytes and use fall
from 93% to 83%; concurrent `aphrody-wsl` builds, global caches and the existing
sccache server remained live. The total allocated output removed in the two
recorded batches is 39,209,590,784 bytes. See the
[2026-10-07 retirement receipt](srv-reclaim-20261007.md). Process path checks
match complete path tokens/descendants, so the active sibling `aphrody-wsl` is
preserved without creating an exception for compiler daemons.

# Deployment control

`infra/apps.json` is the single desired-state catalog. It owns app identities,
hosts, source ownership, native requirements, releases and shared R2 references.
`infra/control-plane.json` supplies pinned control components and their
qualification contracts. `infra/compose.yaml` is a bootstrap adapter for those
components. There is no second app catalog, source authority or deployment
orchestrator here.

Komodo Core/Periphery is the Rust deployment executor. Forgejo and its runner
own Git hosting and workflows. Existing native Bun owners build apps, export
pinned sources and upload content-addressed assets. Cloudflare MCP and the
existing edge adapter own routes. Existing GitHub forks keep their histories
and ownership; no automatic repository/provider-auth synchronization is added.

## Verified component pins

The component profile is authoritative for complete `image:tag@sha256` refs.
Its six OCI index digests were checked against registry response headers and
SHA-256 of the returned manifest bytes on 13 October 2026. Image layers were
not pulled, and no service was started.

| Component | Pinned release | Role |
| --- | --- | --- |
| Komodo Core/Periphery | 2.3.3 | Rust deployment control and agent |
| FerretDB | 2.7.0 | Mongo protocol for the Komodo database client |
| PostgreSQL DocumentDB | 17-0.107.0-ferretdb-2.7.0 | Matched PostgreSQL 17.6 backend |
| Forgejo rootless | 15.0.10 LTS | Git forge, SQLite, Actions UI |
| Forgejo Runner | 13.2.0 | Isolated workflow execution |

All selected images publish Linux amd64 and arm64 manifests. These published
platforms are not native execution qualifications. Forgejo's LTS is supported
through 15 July 2027. The short stable 16.0 branch ends support on 29 October
2026, so this proposal uses the current LTS. [Forgejo releases](https://forgejo.org/releases/)

Komodo's release resolves to source commit
`780ac68b992094a9fccd5fffb760e0c84fd3c3d1`.
[Komodo 2.3.3 release](https://github.com/moghtech/komodo/releases/tag/v2.3.3)
The selected database pair is explicitly matched by the upstream releases,
and Komodo provides this backend in its pinned compose.
[FerretDB 2.7.0](https://github.com/FerretDB/FerretDB/releases/tag/v2.7.0),
[DocumentDB pair](https://github.com/FerretDB/documentdb/releases/tag/v0.107.0-ferretdb-2.7.0),
[Komodo FerretDB compose](https://github.com/moghtech/komodo/blob/v2.3.3/compose/ferretdb.compose.yaml)

## Host and activation boundary

A read-only `bun ssh` probe at `2026-10-13T10:13:45.389Z` observed the VPS as
x64 with AVX, kernel `7.0.0-38-generic`, 127,031,021,568 available build-disk
bytes and 17,583,894 free build-disk inodes. This snapshot does not qualify
the future persistent deployment daemon or reserve capacity against other jobs.

That kernel is within MongoDB's unsupported 6.19 through 7.0.13 range.
MongoDB refuses startup there, including inside Docker. The selected FerretDB
backend avoids that MongoDB server binary; it still needs its own runtime
qualification. No kernel change, reboot or database migration is proposed.
[MongoDB kernel contract](https://www.mongodb.com/docs/manual/release-notes/8.0/)

Do not activate while the OS factory has active heavy jobs. Inspect their
terminal receipts and the shared heavy lock. Qualify a separate persistent
deployment Docker context/service with its data root on the configured
build-disk `~/apps` area. Its socket becomes `DEPLOYMENT_DOCKER_SOCKET`.
CI uses another persistent qualified socket, `CI_DOCKER_SOCKET`, and Docker
25.0 or later. The factory's isolated ephemeral engine and the global Docker
daemon retain their owners and workloads. Neither is an implicit fallback.
[Runner Docker requirement](https://forgejo.org/2026-08-runner-release-v13/)

Every app release and route remains in `apps.json`. Resolve `deploy`, `git` and
`ci` roles through that catalog's edge owner. Core HTTP, Forgejo HTTP and Git
SSH are published only on loopback. Cloudflare HTTPS requires a separately
qualified origin/tunnel route; DNS alone cannot reach a loopback listener.
The runner has no public HTTP service. A `ci` route must use Forgejo's Actions
UI through the edge owner. Git SSH needs its actual qualified SSH access host
and port; ordinary Cloudflare HTTP proxying does not provide SSH transport.

## Persistence and credentials

All bind roots are explicit and must exist before startup; Compose does not
create them. Resolve `DEPLOYMENT_STATE_ROOT` to a fresh, owned persistent
subdirectory of the qualified build-disk apps root. Keep managed app checkouts
in the separate `DEPLOYMENT_MANAGED_ROOT`. Periphery must see that managed root
at the same absolute path inside and outside its container.
[Periphery contract](https://github.com/moghtech/komodo/blob/v2.3.3/config/periphery.config.toml)

| State directory | Expected owner | Container path |
| --- | --- | --- |
| `postgres` | 999:999 | `/var/lib/postgresql/data` |
| `ferretdb` | 1000:1000 | `/state` |
| `keys` | Komodo root process | `/config/keys` |
| `forgejo` | 1000:1000 | `/var/lib/gitea` |
| `runner` | 1000:1000 | `/data` |

The profile records source/configuration evidence for numeric owners; verify
actual image users and mounted-file access when qualifying the layers.
[FerretDB user](https://github.com/FerretDB/FerretDB/blob/v2.7.0/build/ferretdb/passwd),
[PostgreSQL base source](https://github.com/docker-library/postgres/blob/87e6f65859a53d10c5170a587def1bfc882d3830/17/bookworm/Dockerfile),
[Forgejo rootless image](https://codeberg.org/forgejo/forgejo/src/tag/v15.0.10/Dockerfile.rootless)

The credential owner supplies the profile's `*_FILE` inputs and the isolated
`DEPLOYMENT_SECRETS_ROOT`. No credential values belong in the catalog, tracked
env files, command arguments or output. File-backed Compose secrets retain
their host access permissions; grant the intended container UID access to the
specific file. Database password files serve the initial database/Core login;
the FerretDB PostgreSQL URI is a separate private file with percent-encoded
credentials and address `database:5432/postgres`. FerretDB supports native
`FERRETDB_POSTGRESQL_URL_FILE` and SCRAM-SHA-256 authentication.
[FerretDB flags](https://github.com/FerretDB/FerretDB/blob/v2.7.0/website/versioned_docs/version-v2.7/configuration/flags.md),
[authentication](https://github.com/FerretDB/FerretDB/blob/v2.7.0/website/versioned_docs/version-v2.7/security/authentication.md)

Komodo uses native database, bootstrap-password, JWT and webhook secret-file
inputs. Its generated Core/Periphery communication keys share one persistent
keys directory. The outbound agent connects to `ws://core:9120`; no 8120 port
is published. Its Docker socket permits administration of the chosen deployment
daemon. Default global-update and dated-backup procedures are disabled through
`KOMODO_DISABLE_INIT_RESOURCES=true`.
[Komodo configuration](https://github.com/moghtech/komodo/blob/v2.3.3/config/core.config.toml),
[key/outbound settings](https://github.com/moghtech/komodo/blob/v2.3.3/compose/compose.env)

Forgejo rootless stores SQLite, repositories, configuration and generated keys
under `/var/lib/gitea`. Use a real bootstrap admin account before opening its
origin route. Installation is locked and public registration is disabled.
Changing initialization secret files does not rotate credentials in an existing
database. Existing Mongo/FerretDB v1 storage cannot be reused as this backend.
No protected database or latest off-host backup is moved or deleted here.
[Komodo migration contract](https://github.com/moghtech/komodo/blob/v2.3.3/bin/cli/docs/copy-database.md)

## Thin adapter contract

The existing Bun deployment owner reads the profile alongside `apps.json`:

1. Map each `images.*.environment` to that record's immutable `reference`.
   Map the profile's loopback ports and shared server name to their Compose
   bindings; these defaults have one owner in the component profile.
2. Resolve actual route URLs, deployment context, native platform, managed/data
   roots, bootstrap owner and isolated secret-file paths from qualified owner
   configuration. Never use the factory/global daemon as a missing-value default.
3. Apply the bootstrap Compose through the persistent deployment context once
   its activation gates pass. Periphery executes subsequent app deployments
   from the same catalog; do not introduce a second SSH/Docker app deploy loop.
4. Register a runner through the Forgejo UI/API. Keep its actual UUID and token
   with the registration owner. Resolve the profile's `runner.configuration`
   bindings and write the resulting YAML with native `Bun.YAML.stringify` to
   `FORGEJO_RUNNER_CONFIG_FILE`. The token remains a separate secret file.
5. Enable the `ci` profile only after validating its exact socket path/GID,
   token, UUID, public forge URL, configuration file and immutable Bun job image.

The base stack does not need a fictitious pre-registration runner credential.
The inactive runner's default file/socket locations are future paths in the
explicit owned state/secret roots. They are not readiness or registration
proof. The CI adapter must require the real values before activation.

The canonical runner configuration sets capacity 1, a 45-minute job bound,
no job privilege or Docker socket, no allowed host volumes, and disabled cache.
It uses `server.connections` and a file token, rather than deprecated GITEA
variables/registration. Its Docker endpoint is separate from the deployment
daemon. [Runner 13.2 configuration](https://code.forgejo.org/forgejo/runner/src/tag/v13.2.0/internal/pkg/config/config.example.yaml),
[Forgejo LTS registration](https://forgejo.org/docs/v15.0/admin/actions/registration/)

Jobs invoke the existing Bun app/native factory owners. An immutable job image
must carry the exact qualified Aphrody Bun runtime and required native tools;
no stock Bun downloader or Node dependency is introduced. JavaScript Actions
commonly require Node and are not automatically compatible with these Bun
shell workflows. Runner presence does not qualify each app's native backend,
standalone binary, ABI, release or shared R2 objects.

## Readiness and qualification

PostgreSQL's `pg_isready` gates FerretDB startup. The image's native
`/ferretdb ping` then checks Mongo-protocol connectivity, PostgreSQL access and
DocumentDB installation. Core's `/version` endpoint begins serving after its
startup/database initialization; it is not a continuous database probe.
Periphery is qualified through Core's authenticated connected-server health,
not an invented inbound endpoint.
[FerretDB readiness](https://github.com/FerretDB/FerretDB/blob/v2.7.0/website/versioned_docs/version-v2.7/configuration/observability.md),
[Core router](https://github.com/moghtech/komodo/blob/v2.3.3/bin/core/src/api/mod.rs)

Forgejo's `/api/healthz` checks its database/cache when installation is locked.
Before installation it can return success without those checks, so bootstrap,
authenticated Git/API use and one bounded Bun workflow are separate gates.
Workflow logs/artifacts are retained for seven days; Docker logs are bounded
to one 10 MB file per service. These generated outputs do not authorize deletion
of raw provider sessions, protected databases, weights or backups.
[Forgejo health](https://codeberg.org/forgejo/forgejo/src/tag/v15.0.10/routers/web/healthcheck/check.go)

Current evidence qualifies upstream metadata and the local manifest syntax.
It does not qualify image layers, service startup, secrets, runner registration,
app execution, HTTPS routes or production deployment. No layer pull, deployment,
test, database migration, WSL start, commit or push was performed by this batch.

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Self-hosted Supabase on WSL Docker

> **Development only. Private.** This stack runs on the owner's WSL2 Ubuntu
> workstation for local development and restore testing. Its ports are bound
> to loopback, Studio is behind HTTP basic auth, and it is not a production
> deployment. Do not expose it to a network.

Decision [D2 in SQL convergence](../../decisions/infra/sql-convergence.md)
limits Supabase to this self-hosted development stack. There is no Supabase
cloud project, and new RG code uses PostgreSQL directly.

The stack follows the official
[self-hosting with Docker guide](https://supabase.com/docs/guides/self-hosting/docker)
and the upstream `docker/` directory of `supabase/supabase`. It lives outside
this repository. No file in this repository holds its secrets.

## Location and upstream pin

| Item | Value |
| --- | --- |
| Stack directory | `~/.aphrody/services/supabase` |
| Upstream release | `self-hosted/v0.8.2` (latest `self-hosted/*` tag on 2026-10-01) |
| Upstream commit | `564eab8ad7840b13324f68b1bfac074ef8d51c21` (recorded in `.supabase-version`) |
| Sparse upstream checkout | `~/.aphrody/services/supabase/.upstream/supabase-git` (`docker/` only) |
| Secrets | `~/.aphrody/services/supabase/.env` (mode 600) |
| Aphrody override | `~/.aphrody/services/supabase/docker-compose.aphrody.yml` |
| Restore tooling | `~/.aphrody/services/supabase/restore/` (`filter_dump.py`, `restore.sh`) |
| Boot unit | `~/.config/systemd/user/aphrody-supabase.service` |

`.env` selects the compose files with
`COMPOSE_FILE=docker-compose.yml:docker-compose.kong.yml:docker-compose.logs.yml:docker-compose.aphrody.yml`.
Upstream now defaults to an Envoy gateway; the official Kong override is enabled
instead, and the official logs override adds Logflare and Vector.

Secrets were generated with the upstream `utils/generate-keys.sh --update-env`
and `utils/add-new-auth-keys.sh --update-env`: `POSTGRES_PASSWORD`,
`JWT_SECRET`, HS256 `ANON_KEY` and `SERVICE_ROLE_KEY` signed with that secret,
the ES256 key pair (`JWT_KEYS`, `JWT_JWKS`), opaque `SUPABASE_PUBLISHABLE_KEY`
and `SUPABASE_SECRET_KEY`, dashboard credentials, `SECRET_KEY_BASE`,
`VAULT_ENC_KEY`, `REALTIME_DB_ENC_KEY`, `PG_META_CRYPTO_KEY`, Logflare tokens
and S3 protocol keys. Read them with `sh run.sh secrets` in the stack directory.

## Host prerequisites

| Component | Version | Notes |
| --- | --- | --- |
| WSL kernel | 6.18.33.2-microsoft-standard-WSL2 | `/etc/wsl.conf` has `[boot] systemd=true` |
| Docker Engine | 29.8.2 | Docker apt repo (`/etc/apt/sources.list.d/docker.sources`), `docker.service` and `containerd.service` enabled |
| Docker Compose plugin | 5.5.1 | `docker compose` |
| Podman | 4.9.3 | Still installed, unused by this stack |

User `aphro` is in the `docker` group. Host PostgreSQL 18 keeps `127.0.0.1:5432`;
nothing in this stack binds 5432 or 5433 on the host.

## Ports

All published ports are bound to `127.0.0.1`.

| Host port | Service | Purpose |
| --- | --- | --- |
| 54321 | Kong `api-gw` (HTTP) | API gateway; Studio at `/`, REST, Auth, Storage, Realtime, Functions, GraphQL, pg-meta |
| 54443 | Kong `api-gw` (HTTPS) | Same routes over Kong's self-signed TLS |
| 54322 | `db` | Direct Postgres 17 (`postgres`, `supabase_admin`) |
| 54328 | `supavisor` session mode | User `postgres.aphrody` |
| 54329 | `supavisor` transaction mode | User `postgres.aphrody` |

Inside the compose network Postgres keeps port 5432 (`POSTGRES_PORT`). The host
mapping comes from `POSTGRES_HOST_PORT`, `POOLER_PROXY_PORT_SESSION`,
`POOLER_PROXY_PORT_TRANSACTION`, `API_GW_HTTP_PORT` and `KONG_HTTPS_PORT` in
`.env`. `SUPABASE_PUBLIC_URL` is `http://localhost:54321`.

## Services

State checked on 2026-10-01 after `docker compose up -d --wait`: all 13
containers healthy.

| Service | Container | Image | Health |
| --- | --- | --- | --- |
| Postgres | `supabase-db` | `supabase/postgres:17.6.1.136` | healthy |
| API gateway | `supabase-kong` | `kong/kong:3.9.3` | healthy |
| Auth | `supabase-auth` | `supabase/gotrue:v2.196.0` | healthy |
| REST | `supabase-rest` | `postgrest/postgrest:v14.17` | healthy |
| Realtime | `realtime-dev.supabase-realtime` | `supabase/realtime:v2.134.10` | healthy |
| Storage | `supabase-storage` | `supabase/storage-api:v1.74.0` | healthy |
| Image transforms | `supabase-imgproxy` | `darthsim/imgproxy:v3.31.4` | healthy |
| Postgres meta | `supabase-meta` | `supabase/postgres-meta:v0.99.0` | healthy |
| Studio | `supabase-studio` | `supabase/studio:2026.09.07-sha-7996410` | healthy |
| Edge Functions | `supabase-edge-functions` | `supabase/edge-runtime:v1.76.2` | healthy |
| Analytics | `supabase-analytics` | `supabase/logflare:1.50.10` | healthy |
| Log shipping | `supabase-vector` | `timberio/vector:0.53.0-alpine` | healthy |
| Pooler | `supabase-pooler` | `supabase/supavisor:2.9.12` | healthy |

### Verification (2026-10-01)

| Check | Result |
| --- | --- |
| Studio `GET /` through Kong without credentials | 401 (basic auth enforced) |
| Studio `GET /project/default` with dashboard credentials | 200 |
| `GET /rest/v1/` with secret or service-role key | 200 (upstream makes the OpenAPI root admin-only; anon gets 403) |
| `GET /auth/v1/health` | 200, GoTrue v2.196.0 |
| `GET /storage/v1/status` | 200 |
| `GET /realtime/v1/api/ping` | 200; WebSocket `phx_join` on `/realtime/v1/websocket` replied `ok` with both the publishable and anon keys |
| `GET /functions/v1/hello` with publishable key | 200 `{"message":"Hello from Edge Functions!"}` |
| `POST /graphql/v1` | 200; reports `pg_graphql extension is not enabled` (the source project did not enable it either) |
| Kong HTTPS `https://127.0.0.1:54443/auth/v1/health` | 200 |
| Logflare `GET /health` inside `supabase-analytics` | `{"status":"ok"}` |
| Supavisor `GET /api/health` inside `supabase-pooler` | ok |
| `psql` on 54322 (direct), 54328 (session), 54329 (transaction) | connected; PostgreSQL 17.6 |

## Restore

Restored on 2026-10-01 into database `postgres` of `supabase-db`.

| Item | Value |
| --- | --- |
| Backup set | `~/.aphrody/private/backups/aphrody-unique/2026-10-01/supabase/` (canonical copy `vps:/var/backups/aphrody-unique/2026-10-01/supabase/`); `sha256sum -c SHA256SUMS` passed for all five entries |
| Restored member | `legacy-supabase-2026-08-10/postgres-2026-08-10-0245.tar.gz`, sha256 `b47d459f22f02586c8c3d1d404487e9963e05a56409bfe51417c0dd2c42e045b`, byte-identical to `vps:/var/backups/postgres/legacy-supabase/` |
| Source | Hosted Supabase project `rg`, PostgreSQL 17.6, dumped 2026-08-10 02:45 UTC with pg_dump 18.4 |
| Inner files | `roles.sql` `3249c357…c789`, `schema.sql` `b85977c3…d936`, `data.sql` `c4eea971…3f1b` (match `manifest.json`) |
| Work directory | `~/.aphrody/private/backups/supabase-restore-work/2026-10-01/` (extracted copy, filtered SQL, `restore.log`, `verify.tsv`) |
| Not restored | `rg-before-achillea-2026-09-07/` (PG 18 custom-format dump of the later self-hosted `rg` database). It is a different database and was kept as a backup only |

### Method

The dump is a full `pg_dump` that also contains the Supabase-managed schemas.
`restore/restore.sh` follows Supabase's documented
[backup and restore order](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore):
roles, schema, `SET session_replication_role = replica`, data, in a single
`psql --single-transaction -v ON_ERROR_STOP=1` run as `supabase_admin`. It
first filters the files with `restore/filter_dump.py`:

- **Roles:** creates only the roles that are missing (here `cli_login_postgres`) as
  `NOLOGIN` without a password. The source password hashes and
  `ALTER ROLE` lines for the managed roles are not applied, because the
  services authenticate with this stack's `POSTGRES_PASSWORD`.
- **Schema:** keeps `public` and `supabase_migrations` objects,
  `CREATE EXTENSION IF NOT EXISTS` (`pg_stat_statements`, `pg_trgm`,
  `pgcrypto`, `supabase_vault`, `uuid-ossp`, `vector`), the `supabase_realtime`
  publication entry for `public.comments`, and the 18 user RLS policies on
  `storage.objects`. It skips the managed `auth`, `storage`, `realtime`,
  `vault`, `graphql`, `extensions` and `pgbouncer` objects and the event
  triggers, which the image and services already own (1137 entries kept,
  507 skipped).
- **Data:** keeps `public`, `supabase_migrations`, `auth` and `storage` rows.
  It skips `auth.schema_migrations` and `storage.migrations` (service
  ledgers), `realtime.*` (ephemeral messages and subscriptions) and
  `vault.secrets` (encrypted with the source project's root key, so
  unreadable here).

A dry run in a rolled-back transaction completed without errors before the
real run. After loading, `restore.sh` sets the eight GoTrue token text columns of
`auth.users` from `NULL` to `''`. The legacy users were inserted outside GoTrue, and
`/auth/v1/admin/users` failed with `converting NULL to string is unsupported`
until this change.

### Evidence

| Check | Result |
| --- | --- |
| `psql` restore exit status | 0, no `ERROR` in `restore.log` |
| Per-table row counts vs. dump `COPY` blocks | 144 tables, 0 mismatches, 187,930 rows restored of 187,930 in scope |
| Per-table row counts vs. `manifest.json` | 144/144 match; 12 tables skipped by design (219 rows: realtime, vault, two migration ledgers); manifest total 188,149 |
| Objects | 114 `public` tables, 170 `public` policies, 18 `storage.objects` policies, 6 buckets (`assets`, `menu`, `article`, `avatars`, `tweets` public; `patreon` private), 6,456 `storage.objects` rows, 70 `supabase_migrations` rows |
| REST | `GET /rest/v1/article_categories` with publishable key: 200, 5 rows (RLS allows anon); `inagle_characters` with secret key: 6,148 rows |
| Auth | `GET /auth/v1/admin/users`: 31 users (`X-Total-Count: 31`) |
| Persistence | `./start.sh restart`: all 13 services healthy again, counts unchanged |

### Known gaps

- **Storage file bytes are not in any backup.** The 6,456 `storage.objects`
  rows describe files that were stored in the hosted project's S3 backend. The
  local file backend (`volumes/storage`) is empty, so object downloads return
  500 (`ENOENT`). The bucket and object metadata is complete.
- **Vault secrets** were not restored; re-create any that are needed.
- **Users' sessions and refresh tokens** were empty in the source; users must
  sign in again. Password hashes in `auth.users` were restored as dumped.
- `pg_graphql` is not enabled (it was not enabled in the source dump either);
  enable with `create extension pg_graphql` if GraphQL is needed.

To repeat the restore on a fresh stack (`sh reset.sh`, then `./start.sh start`):

```sh
cd ~/.aphrody/private/backups/supabase-restore-work/2026-10-01
tar xzf ~/.aphrody/private/backups/aphrody-unique/2026-10-01/supabase/legacy-supabase-2026-08-10/postgres-2026-08-10-0245.tar.gz
~/.aphrody/services/supabase/restore/restore.sh postgres-2026-08-10-0245
```

The `psql` client must be version 17.6 or later because the dump uses `\restrict`. Host
`psql` 18.6 is used.

## Operations

Run these from `~/.aphrody/services/supabase`.

| Task | Command |
| --- | --- |
| Start and wait for health | `./start.sh start` (also `systemctl --user start aphrody-supabase`) |
| Stop | `./start.sh stop` |
| Status | `./start.sh status` or `docker compose ps` |
| Gateway probe | `./start.sh health` |
| Logs | `./start.sh logs [service]` |
| Show keys and passwords | `sh run.sh secrets` (prints secrets; do not paste them anywhere) |
| psql | `PGPASSWORD=… psql -h 127.0.0.1 -p 54322 -U postgres postgres` |

### Boot

`docker.service` is enabled and every container uses `restart: unless-stopped`,
so a WSL boot brings the stack back once Docker starts. The user unit
`aphrody-supabase.service` (enabled, lingering on for `aphro`) additionally runs
`start.sh start`, which waits for Docker and runs
`docker compose up -d --wait`. WSL itself only boots when the distribution is
started.

### Upgrade

Back up first (`pg_dumpall` or `supabase db dump` against 54322), then follow
the [updating guide](https://supabase.com/docs/guides/self-hosting/updating):

```sh
cd ~/.aphrody/services/supabase
sh update.sh --dry-run
sh update.sh
sh run.sh pull && sh run.sh recreate
```

`update.sh` reads the base ref from `.supabase-version`. Re-check that
`docker-compose.aphrody.yml` still overrides the port lists after an update,
and update this page with the new tags and commit.

### Reset

`sh reset.sh` destroys the database volume and all data. Use only to rebuild
from scratch, then restore again.

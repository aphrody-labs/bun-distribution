<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shenron Docker releases on DBFR

The owner-directed topology is WSL for source editing, VPS for builds, and DBFR
for Shenron production. Aphrody provides Shenron's backend capabilities. Infra
owns activation, public ingress, protected state and rollback.

`aphrody infra deploy --target dbfr --stack shenron --release RELEASE --apply`
uses the canonical adapter for both sealed container releases and historical
systemd releases. A directory containing `compose.yaml` dispatches to its
container verifier before the historical adapter can reconstruct source or run Bun.
Install both adapter files with `scripts/tools/install-vps-adapter.sh --stack shenron`
from a committed, sealed adapter package. The package's source manifest includes
the container helper, and `ADAPTER.json` records its installed hash.

The container release directory is `releases/<commit>` or
`releases/docker-<commit>`. Its `release.json` contains:

```json
{
  "schemaVersion": 1,
  "runtime": "docker",
  "repository": "shenron",
  "target": "dbfr",
  "commit": "FULL_40_CHARACTER_SHA",
  "imageId": "sha256:FULL_IMAGE_ID",
  "files": {"compose.yaml": "SHA256", "deploy.env": "SHA256"},
  "publicVfs": {"path": "/srv/shenron/shared/server/data/shenron-vfs.sqlite", "sha256": "SHA256"}
}
```

The adapter checks both file hashes, the loaded image's ID, platform and source
revision, both workloads' image identity and container policy, and the protected
environment files' containment and 0600 permissions. It checks the public VFS
checksum, SQLite integrity, public profile, absence of private rows and a nonempty
RAG corpus. Missing assets are a failed preflight, not an available capability.
Environment values and Compose diagnostics are never printed.
Keep each VFS at an immutable version-specific path under the server data store;
retain the previous version while its release is available for rollback. Replacing
a shared VFS in place invalidates the previous release's integrity check.

Activation is serialized. The old systemd Shenron writers must already be stopped.
One Compose project owns site, bot and the optional gateway; production performs no build or image pull.
The adapter switches `current`, waits for every container health check and verifies
their running state. A failure stops the candidate and restores the previous sealed
release. A rollback record is retained under `deploy-backups/docker-*` (0700).
Invoke the same adapter with `restore BACKUP` to repeat rollback; it refuses to
overwrite a newer activation. Docker's `unless-stopped` policy provides boot
activation through the Docker daemon.

Public nginx/TLS/DNS probes, an authenticated backend operation, Discord Gateway
readiness and data-transfer integrity remain separate required cutover evidence.
Neither a version command nor a container health check proves those requirements.
Remove the VPS runtime and temporary forwarding only after DBFR's public routes
and protected data are qualified. Never package environment files, conversations,
private databases or model weights inside the image or Git release.

## Gateway bundle and sealing

The gateway uses its own immutable Aphrody image while site and bot share the
Shenron image. Add `images.gateway` with `id` (Docker SHA-256 image ID) and
`commit` (40-character Aphrody revision). Every gateway image must be Linux amd64
and carry the matching OCI revision. Its runtime user is `0:0` for the TLS master;
its exact added capabilities are `NET_BIND_SERVICE`, `SETUID`, `SETGID`, with all
other capabilities dropped and `no-new-privileges` enabled. Workers remain
unprivileged. All workload root filesystems are read-only.

Copy canonical `tools/config/host/nginx/shenron/*.conf` into the release's `nginx/`
directory, and public static files into `public/`. Every file is sealed. Mount
`nginx/` read-only at `/etc/nginx/conf.d`. Mount only the public shared directories
`site/wiki`, `bot/assets` and `site/public-extra` at their corresponding
`/srv/shenron-cdn/{wiki,assets,site-extra}` paths. Other static mounts must be
sealed files or directories from the release. Private bot data, conversations,
agent homes and unrelated TLS identities cannot be mounted in the gateway.

Provision `/etc/aphrody/shenron-tls` through Infra as a protected, dedicated TLS
store containing only the required Shenron certificates and keys, preserving the
`live/` to `archive/` links. Mount it read-only at `/etc/letsencrypt`. Do not mount
the host's entire certificate store or copy keys into a release or image. Provide
writable nginx runtime/cache directories with tmpfs, including `/run`,
`/var/lib/nginx` and `/var/cache/nginx`.

Assemble on the build VPS, transfer only public release files to DBFR, load the
images, and seal on DBFR against the qualified public VFS:

```sh
python3 scripts/release/seal-shenron-docker-release.py RELEASE \
  --commit SHENRON_COMMIT --image-id SHENRON_IMAGE_ID \
  --public-vfs /srv/shenron/shared/server/data/VERSION/shenron-vfs.sqlite \
  --gateway-image-id GATEWAY_IMAGE_ID --gateway-commit APHRODY_COMMIT
sudo aphrody-infra-deploy-shenron verify RELEASE
```

The sealing command refuses an existing manifest, unexpected files and symlinks.
It hashes public release files and the external VFS; it does not verify runtime
availability itself. The canonical adapter supplies that preflight. PostgreSQL,
Redis and backend inference remain protected host capabilities until their own
checksum-verified migration and rollback qualify; application/gateway packaging
alone does not establish a full database/backend container migration.

## Complete bundle assembly and protected-state conversion

`assemble-shenron-docker-release.py` consumes the product owner's application
Compose with `--no-env-resolution`, removes build declarations, pins app image
IDs, selects the versioned VFS and adds the canonical gateway. Its nginx scratch
subdirectories use UID/GID 33 to avoid forbidden chown during startup; its open
file limit is 65535. Run on DBFR with the matching committed Infra source package:

```sh
python3 scripts/release/assemble-shenron-docker-release.py RELEASE \
  --app-compose PRODUCT_COMPOSE --image-id APP_IMAGE_ID \
  --gateway-image-id GATEWAY_IMAGE_ID --public-vfs PUBLIC_VFS
```

Images are built on VPS, exported with `docker image save IMAGE_ID`, checksum
verified after authenticated transfer, then loaded on DBFR with `docker image
load`. Compare `docker image inspect` IDs before sealing. No build or pull occurs
at activation. The initial apps/gateway bundle can consume existing protected
host PostgreSQL and Redis while their replacement is qualified.

Read-only DBFR inventory on 2026-10-07 found PostgreSQL 18.6 Ubuntu
`18.6-0ubuntu0.26.04.1` with plpgsql, pg_trgm and unaccent, 2.3 GiB data, no
external tablespaces; Redis 8.0.5 (`5:8.0.5-1`), 236 MiB, RDB persistence and AOF
disabled. The state Dockerfile pins those packages on Ubuntu 26.04 to preserve
platform/collation compatibility. Build and verify the actual image before use;
package availability and PostgreSQL collation versions remain runtime gates.

For coordinated conversion, stop all app writers and the host PostgreSQL/Redis
units through Infra, then run `sudo python3 scripts/migration/shenron-state-container.py
--apply`. The command requires a fresh `/srv/shenron/shared/state`, stopped units,
no Shenron containers and a clean PostgreSQL shutdown. It checksum-copies data,
configuration and Redis RDB, checks originals stayed unchanged, preserves PG TLS
credentials privately, normalizes Redis owned runtime paths and writes a private
`VERIFIED.json`. Original host stores stay intact. Failure never activates the
partial destination. Redis ACL/include paths must be reviewed privately before
cutover; referenced external ACL files require separate protected migration.

Then assemble with `--state-image-id STATE_IMAGE_ID`; seal with
`--service-image postgres STATE_IMAGE_ID APHRODY_COMMIT` and
`--service-image redis STATE_IMAGE_ID APHRODY_COMMIT`. These services retain their
observed numeric identities, host-loopback ports and auth configuration. The
adapter requires host writers inactive, both database services together, sealed
image identities, read-only roots and mounts contained in verified state.
Verify database/role counts, extensions, collation version, real authenticated
SQL, Redis key count and representative values privately before resuming apps.

Optional `--chat-image-id`, `--model-path` and `--adapter-path` add the qualified
Shenron chat v2 CPU service at loopback 8799. Build `llama.Dockerfile` from only the
qualified b11415 runtime. Keep weights and adapter under the protected
`shared/models` store, transferred with verified checksums; never put them in the
image. Seal using `--service-image chat IMAGE_ID APHRODY_COMMIT`. Verify a real
OpenAI-compatible authenticated chat operation and available memory on DBFR;
this definition does not qualify OCR, embeddings or additional backend models.

For rollback after protected-store conversion, stop container writers first and
preserve the latest container-owned state. Restoring the original host snapshot
after production writes would lose changes: reconcile/checksum-transfer the
latest store back under a clean shutdown before resuming host units. Ordinary
release rollback should reuse the same qualified container-owned state. The
adapter does not automatically reverse this protected-data conversion.

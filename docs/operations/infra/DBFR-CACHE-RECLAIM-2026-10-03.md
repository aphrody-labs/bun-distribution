<!-- SPDX-License-Identifier: Apache-2.0 -->
# DBFR cache reclamation — 2026-10-03

This records a bounded cleanup of re-downloadable user caches on DBFR. It does
not certify application readiness, database integrity or backup restorability.

## Reclaimed paths

`aphrody-infra reclaim --target dbfr` planned and
`aphrody-infra reclaim --target dbfr --apply` removed only these allowlisted
paths:

- `/home/ubuntu/.bun/install/cache`: 3.99 GiB by `du`; Bun package downloads.
- `/home/ubuntu/.cargo/registry`: 0.35 GiB by `du`; Cargo index, sources and archives.
- `/home/ubuntu/.local/share/Trash`: 60 KiB by `du`.

The reclaim command reported 4.34 GiB across those paths. Filesystem free space
changed from 12,275,924,992 bytes (89% used) to 12,807,692,288 bytes (88% used),
a net increase of 531,767,296 bytes. The difference shows that path size did
not equal newly freed filesystem blocks, likely because some package files
were linked elsewhere. The allowlist is in `config/disk-reclaim.json`.

## State after cleanup

- The three allowlisted paths are absent.
- `nginx.service`, `postgresql@18-main.service` and `redis-server.service`
  remain active. Nginx listens on port 80; PostgreSQL and Redis remain bound to
  loopback ports 5432 and 6379.
- `aphrody-infra ssh audit --host dbfr --json` reports no failed units or
  zombie processes, but still warns at 88% disk use and reports Docker
  inactive plus one unknown/dead monitored service.
- `/srv`, application data, database stores, backup files and `/tmp` were not
  reclaimed. `/tmp` contains database artifacts and was intentionally excluded.

This cleanup makes cache space available while preserving the DBFR data and
runtime state. It does not qualify DBFR as a build host or authorize moving the
VPS build factory.

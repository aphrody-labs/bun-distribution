<!-- SPDX-License-Identifier: Apache-2.0 -->

# Shenron offsite backup receipt (2026-10-15)

The offsite destination moved from the nearly full build volume to the VPS's
persistent `/mnt/aphrody-storage/disk500` filesystem:

```text
/mnt/aphrody-storage/disk500/archive/dbfr/backups/shenron
```

The mount is declared by the VPS fstab source (UUID
`2fc98d6e-d1e0-4683-8179-d5c75534963d`). The systemd service uses
`RequiresMountsFor=` so it cannot silently write these backups to `/` if that
disk is unavailable. Source commits are `53dd25d53` (destination and safe
retention) and `6061cb512` (history-seed mode), pushed to `main`.

## Verified copy

The latest published DBFR snapshot was `20261011T030730863287Z`. On 2026-10-15
the VPS copied 1,009,379,288 bytes, verified its SHA-256 manifest, and restored
the PostgreSQL archive into a disposable `pgvector/pgvector:0.8.1-pg18`
container. The restore contained 127 tables and 1,099,373 estimated rows; the
three SQLite snapshots (`memory.sqlite`, `conversations.sqlite`, `bot.db`)
passed `PRAGMA quick_check`. PostgreSQL restore took 326 seconds. The receipt is
on the VPS in the snapshot's `.offsite-verified` and `.restore-verified` files;
the pull log is `pull-status.log` in the destination above.

The service then returned failure because this source snapshot was 112.4 hours
old, beyond its 36-hour freshness limit. This is a successful copy and restore,
but not a fresh scheduled backup. The offsite timer remains disabled.

The VPS `aphrody-selfheal.timer` was also restarting this failed oneshot while
its freshness guard was correctly reporting the stale source. Commit
`4f3f1fbf0` excludes both Shenron backup oneshots from generic failed-service
restarts; the updated unit passed `systemd-analyze verify`, was installed from
the declared source, and systemd was reloaded. The general self-heal timer stays
active.

## Remaining producer blocker

DBFR has one published snapshot and 13 unpublished `.snapshot-*` staging
directories retained by `backup-shenron-container.py` after failed attempts.
Together the backup directory uses about 8.6 GiB, above its 8 GiB capacity
limit; DBFR `/` had about 5.1 GiB free against the producer's 4 GiB minimum.
The producer's 03:00 timer remains disabled. Its staging directories were
preserved for inspection and were not copied, renamed, or deleted by this
change. The one-shot `--all-snapshots` mode found no additional *published*
timestamped directories, so it transferred no extra history.

Do not enable the daily offsite timer until the DBFR producer creates a
timestamped snapshot within 36 hours. Resolve the incomplete staging directories
under an exact Infra retention or recovery plan, preserving their contents and
the published DBFR snapshot. No DBFR data was changed in this operation.

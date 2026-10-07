#!/usr/bin/env bash
# Daily logical backup of the Shenron PostgreSQL database (shenron_site:
# public + bot schemas). Hot pg_dump (MVCC-consistent snapshot), gzip -9,
# SHA-256 manifest, 14-day age retention gated on the off-host acknowledgement
# (`<dump>.offsite-verified`, written by scripts/tools/infra/pull-shenron-pg-backup.ps1).
#
# Owner: aphrody-infra (moved from shenron/scripts/backup-shenron-pg.sh; the
# Shenron copy is frozen until the DBFR units are reinstalled from this repo).
# Unit: tools/config/host/systemd/shenron/shenron-pg-backup.{service,timer} (03:00 UTC on DBFR).
#
# Environment:
#   SHENRON_ROOT            Shenron checkout/release root (default: $PWD, i.e.
#                           the unit WorkingDirectory).
#   SHENRON_PG_BACKUP_DIR   Destination (default: $SHENRON_ROOT/data/backups/shenron-pg).
#   SHENRON_PG_BACKUP_RETENTION_DAYS  Age retention in days (default: 14).
#   DATABASE_URL            Local PostgreSQL URL; otherwise read from the
#                           operator env file ~/.shenron-neon.env (never logged).
set -euo pipefail

SHENRON_ROOT="${SHENRON_ROOT:-$PWD}"
DEST_DIR="${SHENRON_PG_BACKUP_DIR:-$SHENRON_ROOT/data/backups/shenron-pg}"
RETENTION_DAYS="${SHENRON_PG_BACKUP_RETENTION_DAYS:-14}"

if ! [[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "✗ SHENRON_PG_BACKUP_RETENTION_DAYS must be a positive integer." >&2
  exit 1
fi

# DATABASE_URL: direct env, else the operator env file.
if [[ -z "${DATABASE_URL:-}" && -f "$HOME/.shenron-neon.env" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$HOME/.shenron-neon.env" | tail -1 | cut -d= -f2-)"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "✗ DATABASE_URL not found (neither env nor ~/.shenron-neon.env)" >&2
  exit 1
fi
if [[ "$DATABASE_URL" == *neon.tech* ]]; then
  echo "✗ DATABASE_URL points to Neon — this backup targets the local PostgreSQL. Aborting." >&2
  exit 1
fi

TS=$(date -u +%Y%m%d-%H%M%S)
DEST="$DEST_DIR/shenron_site-$TS.sql.gz"
mkdir -p "$DEST_DIR"

# Portable full logical dump (public + bot + drizzle). --no-owner so it can be
# restored under any role (psql -v ON_ERROR_STOP=1 -f).
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip -9 > "$DEST"

# Guard: a near-empty dump (< 10 KiB gz) means failure → keep it, skip purge.
SIZE=$(stat -c %s "$DEST")
if (( SIZE < 10240 )); then
  echo "✗ suspicious dump ($(numfmt --to=iec "$SIZE")) — kept, purge cancelled." >&2
  exit 1
fi
gzip -t "$DEST"

# Per-file manifest, used by the off-host transfer and its checks.
sha256sum "$DEST" > "$DEST.sha256"

# Age retention: a dump is purged only after the off-host copy acknowledged
# its SHA-256.
find "$DEST_DIR" -maxdepth 1 -type f -name 'shenron_site-*.sql.gz' -mtime "+$RETENTION_DAYS" -print0 |
  while IFS= read -r -d '' OLD_DUMP; do
    if [[ -f "$OLD_DUMP.offsite-verified" ]]; then
      rm -f -- "$OLD_DUMP" "$OLD_DUMP.sha256" "$OLD_DUMP.offsite-verified"
    fi
  done

# Daily ANALYZE, hooked here rather than on one more timer: seeds and
# re-seeds from SQLite repopulate wiki tables without triggering autoanalyze
# early enough (observed 2026-08-21: five wiki tables never analyzed, the
# planner chose sequential scans). Runs right after the dump, off-peak.
if ! psql "$DATABASE_URL" -X -q -c 'ANALYZE;' 2>/dev/null; then
  echo "! ANALYZE failed (non-blocking)" >&2
fi

echo "[$TS] shenron pg backup: $(numfmt --to=iec "$SIZE") → $DEST (retention ${RETENTION_DAYS} days)"

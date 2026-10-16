#!/usr/bin/env bash
# Hot VACUUM INTO backup of the Shenron SQLite cache/replica
# (apps/bot/data/bot.db, WAL-safe), gzip -9, SHA-256 manifest, age retention
# gated on the off-host acknowledgement (`<snapshot>.offsite-verified`).
#
# Owner: aphrody-infra (moved from shenron/scripts/backup-shenron-sqlite.sh; the
# Shenron copy is frozen until the DBFR units are reinstalled from this repo).
# Units: infra/config/host/systemd/shenron/shenron-backup.{service,timer} (main VPS, release pointer) and
# infra/config/host/systemd/shenron/shenron-sqlite-replica-backup.{service,timer} (DBFR replica).
#
# Environment:
#   SHENRON_ROOT                          Shenron checkout/release root
#                                         (default: $PWD, i.e. the unit WorkingDirectory).
#   SHENRON_SQLITE_SRC                    Database file (default: $SHENRON_ROOT/apps/bot/data/bot.db).
#   SHENRON_SQLITE_BACKUP_DIR             Destination (default: $SHENRON_ROOT/data/backups/shenron-sqlite).
#   SHENRON_SQLITE_BACKUP_RETENTION_DAYS  Age retention in days (default: 14).
set -euo pipefail
umask 077

SHENRON_ROOT="${SHENRON_ROOT:-$PWD}"
SRC="${SHENRON_SQLITE_SRC:-$SHENRON_ROOT/apps/bot/data/bot.db}"
DEST_DIR="${SHENRON_SQLITE_BACKUP_DIR:-$SHENRON_ROOT/data/backups/shenron-sqlite}"
RETENTION_DAYS="${SHENRON_SQLITE_BACKUP_RETENTION_DAYS:-14}"
MAX_BYTES="${SHENRON_SQLITE_BACKUP_MAX_BYTES:-2147483648}"
MIN_FREE_BYTES="${SHENRON_SQLITE_BACKUP_MIN_FREE_BYTES:-4294967296}"
TS=$(date -u +%Y%m%d-%H%M%S)
DEST="$DEST_DIR/bot-$TS.db"

if ! [[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "✗ SHENRON_SQLITE_BACKUP_RETENTION_DAYS must be a positive integer." >&2
  exit 1
fi
if [[ ! -f "$SRC" ]]; then
  echo "✗ SQLite source not found: $SRC (set SHENRON_ROOT or SHENRON_SQLITE_SRC)" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
# Back up only this SQLite file; never recursively archive shared media.
# Refuse growth before making a snapshot, preserving every existing archive
# until its established offsite acknowledgement permits age retention.
for limit in "$MAX_BYTES" "$MIN_FREE_BYTES"; do
  [[ "$limit" =~ ^[1-9][0-9]{0,14}$ ]] || { echo 'invalid SQLite backup capacity limit' >&2; exit 1; }
done
SOURCE_BYTES="$(stat -c %s -- "$SRC")"
WAL_BYTES=0
if [[ -f "$SRC-wal" && ! -L "$SRC-wal" ]]; then WAL_BYTES="$(stat -c %s -- "$SRC-wal")"; fi
USED_BYTES="$(du -sb -- "$DEST_DIR" | awk '{print $1}')"
FREE_BYTES="$(df -PB1 -- "$DEST_DIR" | awk 'NR == 2 {print $4}')"
SCRATCH_BYTES=$(( (SOURCE_BYTES + WAL_BYTES) * 2 + 1048576 ))
if (( USED_BYTES + SCRATCH_BYTES > MAX_BYTES || FREE_BYTES < MIN_FREE_BYTES + SCRATCH_BYTES )); then
  echo 'SQLite backup capacity gate failed; existing archives preserved; check offsite acknowledgements and host capacity' >&2
  exit 1
fi

# VACUUM INTO produces a consistent snapshot even with WAL active (bun:sqlite open).
sqlite3 -readonly "$SRC" "VACUUM INTO '$DEST';"
gzip -9 "$DEST"
DEST_GZ="$DEST.gz"
gzip -t "$DEST_GZ"
SIZE=$(stat -c %s "$DEST_GZ")
if (( SIZE < 10240 )); then
  echo "✗ suspicious snapshot ($(numfmt --to=iec "$SIZE")) — kept, purge cancelled." >&2
  exit 1
fi
sha256sum "$DEST_GZ" > "$DEST_GZ.sha256"

# Age purge only after a complete snapshot and an off-host acknowledgement.
find "$DEST_DIR" -maxdepth 1 -type f -name 'bot-*.db.gz' -mtime "+$RETENTION_DAYS" -print0 |
  while IFS= read -r -d '' OLD_DUMP; do
    if [[ -f "$OLD_DUMP.offsite-verified" ]]; then
      rm -f -- "$OLD_DUMP" "$OLD_DUMP.sha256" "$OLD_DUMP.offsite-verified"
    fi
  done

echo "[$TS] shenron sqlite backup: $(numfmt --to=iec "$SIZE") → $DEST_GZ (retention ${RETENTION_DAYS} days)"

#!/usr/bin/env bash
# SUPERSEDED — DO NOT EDIT. Canonical copy: scripts/ops/backup-shenron-sqlite.sh
# (owned by ops, run by its systemd units). This copy only stays
# because the live DBFR timers still execute it from this checkout; delete it
# once the host units are reinstalled from ops.
# Backup VACUUM INTO du SQLite Shenron (chaud, WAL-safe).
# Destination durable configurable. Conserve 14 jours par défaut.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$PROJECT_ROOT/apps/bot/data/bot.db"
DEST_DIR="${SHENRON_SQLITE_BACKUP_DIR:-$PROJECT_ROOT/data/backups/shenron-sqlite}"
RETENTION_DAYS="${SHENRON_SQLITE_BACKUP_RETENTION_DAYS:-14}"
TS=$(date -u +%Y%m%d-%H%M%S)
DEST="$DEST_DIR/bot-$TS.db"

if ! [[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "✗ SHENRON_SQLITE_BACKUP_RETENTION_DAYS doit être un entier positif." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

# VACUUM INTO crée un snapshot consistent même avec WAL actif (bun:sqlite ouvert)
sqlite3 "$SRC" "VACUUM INTO '$DEST';"
gzip -9 "$DEST"
DEST_GZ="$DEST.gz"
gzip -t "$DEST_GZ"
SIZE=$(stat -c %s "$DEST_GZ")
if (( SIZE < 10240 )); then
  echo "✗ snapshot suspect ($(numfmt --to=iec "$SIZE")) — conservé, purge annulée." >&2
  exit 1
fi
sha256sum "$DEST_GZ" > "$DEST_GZ.sha256"

# Purge par âge après création complète et accusé de réception hors hôte.
find "$DEST_DIR" -maxdepth 1 -type f -name 'bot-*.db.gz' -mtime "+$RETENTION_DAYS" -print0 |
  while IFS= read -r -d '' OLD_DUMP; do
    if [[ -f "$OLD_DUMP.offsite-verified" ]]; then
      rm -f -- "$OLD_DUMP" "$OLD_DUMP.sha256" "$OLD_DUMP.offsite-verified"
    fi
  done

# Log compact
echo "[$TS] shenron sqlite backup: $(numfmt --to=iec "$SIZE") → $DEST_GZ (rétention ${RETENTION_DAYS} jours)"

#!/usr/bin/env bash
# SUPERSEDED — DO NOT EDIT. Canonical copy: scripts/ops/backup-shenron-pg.sh
# (owned by ops, run by its systemd units). This copy only stays
# because the live DBFR timers still execute it from this checkout; delete it
# once the host units are reinstalled from ops.
# Backup quotidien du PostgreSQL local du site (base shenron_site : schémas
# public + bot). pg_dump à chaud (consistent via snapshot MVCC), gzip -9,
# rétention 14 jours. Timer quotidien 03:00 UTC (piloté par aphrody-infra sur dbfr).
#
# Mis en place lors de la migration Neon → PostgreSQL local (2026-06-23).
# DATABASE_URL est fourni par l'EnvironmentFile ~/.shenron-neon.env (= URL du
# PG local depuis la migration), ou par l'environnement si lancé à la main.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# DATABASE_URL : env direct, sinon lu depuis ~/.shenron-neon.env.
if [[ -z "${DATABASE_URL:-}" && -f "$HOME/.shenron-neon.env" ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$HOME/.shenron-neon.env" | tail -1 | cut -d= -f2-)"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "✗ DATABASE_URL introuvable (ni env ni ~/.shenron-neon.env)" >&2
  exit 1
fi
if [[ "$DATABASE_URL" == *neon.tech* ]]; then
  echo "✗ DATABASE_URL pointe sur Neon — ce backup vise le PG local. Abandon." >&2
  exit 1
fi

DEST_DIR="$PROJECT_ROOT/data/backups/shenron-pg"
TS=$(date -u +%Y%m%d-%H%M%S)
DEST="$DEST_DIR/shenron_site-$TS.sql.gz"
mkdir -p "$DEST_DIR"

# Dump logique complet (public + bot + drizzle), portable. --no-owner pour
# pouvoir restaurer sous n'importe quel rôle (psql -v ON_ERROR_STOP=1 -f).
pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip -9 > "$DEST"

# Garde-fou : un dump quasi vide (< 10 Ko gz) trahit un échec → ne pas purger.
SIZE=$(stat -c %s "$DEST")
if (( SIZE < 10240 )); then
  echo "✗ dump suspect ($(numfmt --to=iec "$SIZE")) — conservé, purge annulée." >&2
  exit 1
fi
gzip -t "$DEST"

# Manifeste par fichier, utilisé par le transfert hors hôte et les contrôles.
sha256sum "$DEST" > "$DEST.sha256"

# Rétention par âge : garde 14 jours au minimum. Un dump n'est purgé qu'après
# accusé de réception du SHA-256 par la copie hors hôte Windows.
find "$DEST_DIR" -maxdepth 1 -type f -name 'shenron_site-*.sql.gz' -mtime +14 -print0 |
  while IFS= read -r -d '' OLD_DUMP; do
    if [[ -f "$OLD_DUMP.offsite-verified" ]]; then
      rm -f -- "$OLD_DUMP" "$OLD_DUMP.sha256" "$OLD_DUMP.offsite-verified"
    fi
  done

# ANALYZE quotidien, accroché ici plutôt qu'à un timer de plus.
#
# Ce n'est pas de la cosmétique : constaté le 2026-08-21, cinq tables du wiki
# (db_characters, db_planets, db_races, db_techniques, db_manga_chapters)
# n'avaient JAMAIS été analysées — last_analyze ET last_autoanalyze à NULL. Le
# planificateur voyait 0 ligne là où il y en avait 1 323 et choisissait un
# balayage séquentiel même quand un index existait. Le seed initial et le
# re-seed depuis SQLite repeuplent les tables sans déclencher l'autoanalyse
# assez tôt : on la force, juste après le dump donc hors heure de pointe.
if ! psql "$DATABASE_URL" -X -q -c 'ANALYZE;' 2>/dev/null; then
  echo "! ANALYZE a échoué (non bloquant)" >&2
fi

echo "[$TS] shenron pg backup: $(numfmt --to=iec "$SIZE") → $DEST"

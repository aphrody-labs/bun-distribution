#!/usr/bin/env bash
set -euo pipefail

# Web database data, never dropping anything. Two modes, both run as the
# PostgreSQL superuser role `ubuntu` with
# PGOPTIONS=-cdefault_transaction_read_only=off:
#
#   copy-aphrody-web-tables.sh
#       Existing host: additive copy of the two Web tables from the `aphrody`
#       database into a new `aphrody_web` database during a Web write freeze
#       (aphrody-site stopped, APHRODY_WEB_WRITE_FREEZE=confirmed).
#
#   copy-aphrody-web-tables.sh --fresh-host AI_DUMP WEB_DUMP
#       Fresh host: restore `aphrody` (AI RAG corpus, incl. the Shenron vectors)
#       and `aphrody_web` from custom-format dumps, e.g. the 2026-09-25 03:15
#       dumps offloaded to %USERPROFILE%\vps-offload\aphrody-retired-20260925
#       (var/backups/postgres/). Each dump needs a `<dump>.sha256` beside it.
#       A database that already exists is kept and only checked. Run after
#       `provision-aphrody-stack-env.sh --fresh-host` (the roles must exist).
source_db="${APHRODY_WEB_SOURCE_DB:-aphrody}"
target_db="${APHRODY_WEB_TARGET_DB:-aphrody_web}"
target_role="${APHRODY_WEB_TARGET_ROLE:-aphrody_web}"
ai_role="${APHRODY_AI_HTTP_ROLE:-aphrody_ai_http}"
backup_root="${APHRODY_WEB_BACKUP_ROOT:-/srv/aphrody/shared/db-backups}"
web_tables=(aphrody_bxc_rankings aphrody_seo_entities)
ai_tables=(aphrody_rag_documents aphrody_rag_chunks)
[[ "$source_db" =~ ^[a-z_][a-z0-9_]*$ && "$target_db" =~ ^[a-z_][a-z0-9_]*$ && "$target_role" =~ ^[a-z_][a-z0-9_]*$ && "$ai_role" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo 'invalid PostgreSQL identifier' >&2; exit 2; }
[[ "$source_db" != "$target_db" ]] || { echo 'source and target DB must differ' >&2; exit 2; }
for cmd in psql pg_dump pg_restore createdb sha256sum systemctl; do command -v "$cmd" >/dev/null || { echo "missing $cmd" >&2; exit 2; }; done
sql() { local db="$1"; shift; psql -X -d "$db" -v ON_ERROR_STOP=1 -Atq "$@"; }
database_exists() { sql postgres -c "SELECT 1 FROM pg_database WHERE datname = '$1'" | grep -qx 1; }
role_can_login() { sql postgres -c "SELECT 1 FROM pg_roles WHERE rolname = '$1' AND rolcanlogin" | grep -qx 1; }
missing_tables() {
  local db="$1" table
  shift
  for table in "$@"; do
    sql "$db" -c "SELECT to_regclass('public.$table') IS NOT NULL" | grep -qx t || printf '%s ' "$table"
  done
}

if [[ "${1:-}" = --fresh-host ]]; then
  [[ $# -eq 3 ]] || { echo 'usage: copy-aphrody-web-tables.sh --fresh-host AI_DUMP WEB_DUMP' >&2; exit 2; }
  for role in "$target_role" "$ai_role"; do
    role_can_login "$role" || { echo "login role $role missing: run provision-aphrody-stack-env.sh --fresh-host first" >&2; exit 2; }
  done
  restore() {
    local db="$1" dump="$2" owner="$3" missing
    shift 3
    dump="$(realpath -e -- "$dump")"
    (cd "$(dirname -- "$dump")" && sha256sum --quiet --check "$(basename -- "$dump").sha256") || {
      echo "checksum mismatch or missing $dump.sha256" >&2; exit 2;
    }
    pg_restore --list "$dump" >/dev/null
    if pg_restore --list "$dump" | grep -q ' EXTENSION - vector'; then
      sql postgres -c "SELECT 1 FROM pg_available_extensions WHERE name = 'vector'" | grep -qx 1 ||
        { echo "$db needs the pgvector extension package (postgresql-18-pgvector)" >&2; exit 2; }
    fi
    if database_exists "$db"; then
      missing="$(missing_tables "$db" "$@")"
      [[ -z "$missing" ]] || { echo "existing database $db lacks: $missing; not overwriting it" >&2; exit 2; }
      printf 'kept existing database %s\n' "$db"
    else
      createdb --owner="$owner" "$db"
      pg_restore --exit-on-error --no-owner --no-acl --dbname="$db" "$dump"
      missing="$(missing_tables "$db" "$@")"
      [[ -z "$missing" ]] || { echo "restored $db lacks: $missing" >&2; exit 1; }
      printf 'restored %s from %s\n' "$db" "$(basename -- "$dump")"
    fi
    local table
    for table in "$@"; do printf '  %s.%s rows=%s\n' "$db" "$table" "$(sql "$db" -c "SELECT count(*) FROM public.$table")"; done
  }
  restore "$source_db" "$2" ubuntu "${ai_tables[@]}"
  restore "$target_db" "$3" "$target_role" "${web_tables[@]}"
  # The Web tables belong to the Web role; the AI HTTP role reads and writes the
  # RAG corpus (Shenron ingest, vectors, sync) without owning the database.
  sql "$target_db" <<SQL
ALTER DATABASE $target_db OWNER TO $target_role;
DO \$\$
DECLARE item record;
BEGIN
  FOR item IN SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %s OWNER TO $target_role', item.name);
  END LOOP;
  FOR item IN SELECT format('%I.%I', schemaname, sequencename) AS name FROM pg_sequences WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER SEQUENCE %s OWNER TO $target_role', item.name);
  END LOOP;
END \$\$;
SQL
  sql "$source_db" <<SQL
GRANT CONNECT ON DATABASE $source_db TO $ai_role;
GRANT USAGE ON SCHEMA public TO $ai_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.aphrody_rag_documents, public.aphrody_rag_chunks TO $ai_role;
DO \$\$
BEGIN
  -- Shenron E5 vectors (Xenova/multilingual-e5-small, 384D), present once that corpus was imported.
  IF to_regclass('public.aphrody_shenron_vectors') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.aphrody_shenron_vectors TO $ai_role';
  END IF;
END \$\$;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $ai_role;
SQL
  if [[ -z "$(missing_tables "$source_db" aphrody_shenron_vectors)" ]]; then
    printf '  %s.aphrody_shenron_vectors rows=%s\n' "$source_db" "$(sql "$source_db" -c 'SELECT count(*) FROM public.aphrody_shenron_vectors')"
  else
    printf '  %s.aphrody_shenron_vectors absent: re-import the Shenron corpus before relying on vector search\n' "$source_db"
  fi
  echo "fresh host databases ready: $source_db (AI, $ai_role DML) and $target_db (owned by $target_role)"
  exit 0
fi

[[ $# -eq 0 ]] || { echo 'usage: copy-aphrody-web-tables.sh [--fresh-host AI_DUMP WEB_DUMP]' >&2; exit 2; }
[[ "${APHRODY_WEB_WRITE_FREEZE:-}" = confirmed ]] || { echo 'set APHRODY_WEB_WRITE_FREEZE=confirmed after stopping web writes' >&2; exit 2; }
if systemctl is-active --quiet aphrody-site.service; then
  echo 'stop aphrody-site.service before copying Web tables to freeze writes' >&2; exit 2
fi

umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$backup_root/$stamp"
mkdir -p -- "$backup"
chmod 0700 "$backup"
role_can_login "$target_role" || {
  echo "target login role $target_role must be provisioned first" >&2; exit 2;
}
if database_exists "$target_db"; then
  echo "target database $target_db already exists; refusing overwrite" >&2; exit 2
fi

# pg_dump uses one consistent source snapshot; the archive is private and kept
# even after successful cutover. A checksum records the exact backup bytes.
pg_dump -Fc --no-owner --no-acl -d "$source_db" \
  -t public.aphrody_bxc_rankings -t public.aphrody_seo_entities \
  -f "$backup/web-tables.dump"
sha256sum "$backup/web-tables.dump" > "$backup/web-tables.dump.sha256"
chmod 0600 "$backup/web-tables.dump" "$backup/web-tables.dump.sha256"

table_hash() {
  local db="$1" table="$2"
  psql -X -d "$db" -v ON_ERROR_STOP=1 -Atqc \
    "COPY (SELECT * FROM public.$table ORDER BY id) TO STDOUT" | sha256sum | cut -d' ' -f1
}
for table in "${web_tables[@]}"; do
  table_hash "$source_db" "$table" > "$backup/$table.source.sha256"
done

createdb --owner="$target_role" "$target_db"
pg_restore --exit-on-error --no-owner --no-acl --role="$target_role" \
  --dbname="$target_db" "$backup/web-tables.dump"

for table in "${web_tables[@]}"; do
  source_hash="$(cat "$backup/$table.source.sha256")"
  [[ "$(table_hash "$source_db" "$table")" = "$source_hash" ]] || {
    echo "source $table changed during copy; keep source authoritative" >&2; exit 1;
  }
  [[ "$(table_hash "$target_db" "$table")" = "$source_hash" ]] || {
    echo "target $table checksum mismatch; keep source authoritative" >&2; exit 1;
  }
done
sha256sum --check "$backup/web-tables.dump.sha256"
printf 'web tables copied and verified; backup=%s; source retained=%s\n' "$backup" "$source_db"

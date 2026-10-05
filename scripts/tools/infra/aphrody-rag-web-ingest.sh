#!/usr/bin/env bash
set -euo pipefail
set +x

# Operator entry point for AI Web ingestion. Run as root so the two service
# credentials can remain in separate 0600 files; the CLI itself runs as aphrody.
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }
[[ $# -ge 1 ]] || { echo 'usage: aphrody-rag-web-ingest.sh URL [--force]' >&2; exit 2; }
for file in /etc/aphrody/aphrody-ai-http.env /etc/aphrody/aphrody-web-api.env; do
  [[ -f "$file" && "$(stat -c %a "$file")" = 600 ]] || {
    echo "missing 0600 service env: $file" >&2; exit 2;
  }
done
[[ -x /srv/aphrody/current/bin/aphrody ]] || { echo 'Aphrody release CLI missing' >&2; exit 2; }
[[ -d /srv/aphrody/shared/ai && "$(stat -c %U /srv/aphrody/shared/ai)" = aphrody ]] || {
  echo 'AI state directory must belong to aphrody' >&2; exit 2;
}
[[ "$(grep -Ec '^APHRODY_MCP_DATABASE_URL=' /etc/aphrody/aphrody-ai-http.env || true)" = 1 ]] || {
  echo 'AI database URL missing or duplicated' >&2; exit 2;
}
[[ "$(grep -Ec '^BXC_API_TOKEN=' /etc/aphrody/aphrody-web-api.env || true)" = 1 ]] || {
  echo 'Web backend token missing or duplicated' >&2; exit 2;
}
APHRODY_MCP_DATABASE_URL="$(sed -n 's/^APHRODY_MCP_DATABASE_URL=//p' /etc/aphrody/aphrody-ai-http.env)"
APHRODY_WEB_API_TOKEN="$(sed -n 's/^BXC_API_TOKEN=//p' /etc/aphrody/aphrody-web-api.env)"
export APHRODY_MCP_DATABASE_URL APHRODY_WEB_API_TOKEN
[[ -n "$APHRODY_MCP_DATABASE_URL" && -n "$APHRODY_WEB_API_TOKEN" ]] || {
  echo 'AI database or Web backend credential is empty' >&2; exit 2;
}
export APHRODY_WEB_API_URL=http://127.0.0.1:3007
export APHRODY_HOME=/srv/aphrody/shared/ai
export HOME=/srv/aphrody/shared/ai
cd /srv/aphrody/shared/ai
exec runuser --preserve-environment -u aphrody -- /srv/aphrody/current/bin/aphrody rag web-ingest "$@"

#!/usr/bin/env bash
set -Eeuo pipefail

usage='usage: atomic-deploy-aphrody-discord.sh RELEASE_DIR'
[[ $# == 1 ]] || { echo "$usage" >&2; exit 2; }
[[ "$(id -u)" == 0 ]] || { echo 'run as root' >&2; exit 2; }
root=/home/ubuntu/apps/discord
release="$(realpath -e -- "$1")"
current="$root/current"
[[ -f "$release/server.js" && -f "$release/release.json" && -f "$release/SHA256SUMS" ]] || { echo 'incomplete Discord release artifact' >&2; exit 2; }
(cd "$release" && sha256sum --quiet --check SHA256SUMS)
python3 - "$release/release.json" <<'PY'
import json, re, sys
data = json.load(open(sys.argv[1]))
if data.get('schemaVersion') != 1 or data.get('repository') != 'aphrody-discord' or data.get('entry') != 'server.js' or not re.fullmatch(r'[0-9a-f]{40}', data.get('commit', '')):
    raise SystemExit('invalid Aphrody Discord release manifest')
PY
[[ -r /etc/aphrody-discord.env ]] || { echo 'missing /etc/aphrody-discord.env' >&2; exit 2; }
# Runs as the compose service `discord` of the host project (tools/config/container/compose.yaml).
compose=(docker compose --project-directory /home/ubuntu/apps)
"${compose[@]}" config --services | grep -qx discord || { echo 'compose service discord is not declared' >&2; exit 2; }
install -d -o ubuntu -g ubuntu -m 0750 "$root/releases" "$root/shared"
commit="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["commit"])' "$release/release.json")"
dest="$root/releases/$commit"
if [[ "$release" != "$dest" ]]; then
  if [[ -e "$dest" ]]; then
    cmp -s "$release/release.json" "$dest/release.json" && (cd "$dest" && sha256sum --quiet --check SHA256SUMS) || { echo "release collision at $dest" >&2; exit 2; }
  else
    install -d -o ubuntu -g ubuntu -m 0750 "$dest"
    install -o ubuntu -g ubuntu -m 0640 "$release/server.js" "$release/release.json" "$release/SHA256SUMS" "$dest/"
  fi
fi
# Relative link: the container binds $root at the same path and resolves it the same way.
old="$(readlink "$current" 2>/dev/null || true)"
next="$root/.current.$commit.$"
ln -s "releases/$commit" "$next"
mv -Tf "$next" "$current"
rollback() {
  if [[ -n "$old" ]]; then ln -s "$old" "$root/.rollback.$"; mv -Tf "$root/.rollback.$" "$current"; else rm -f "$current"; fi
  "${compose[@]}" up -d --no-deps --force-recreate discord || true
  echo 'activation failed; previous release restored' >&2
}
# Only the active release is kept once verified (rollback = rebuild from git).
prune() {
  find "$root/releases" -mindepth 1 -maxdepth 1 -type d ! -name "$commit" -exec rm -rf -- {} +
}
if ! "${compose[@]}" up -d --no-deps --force-recreate discord; then
  rollback
  exit 1
fi
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:4010/healthz | python3 -c 'import json,sys; h=json.load(sys.stdin); raise SystemExit(0 if h.get("status")=="ok" and h.get("gatewayConnected") is True else 1)' 2>/dev/null; then
    if curl --fail --silent --show-error --resolve bot.aphrody.com:443:127.0.0.1 https://bot.aphrody.com/healthz >/dev/null; then
      prune
      echo "activated Aphrody Discord release $commit"
      exit 0
    fi
    rollback
    exit 1
  fi
  sleep 1
done
rollback
exit 1

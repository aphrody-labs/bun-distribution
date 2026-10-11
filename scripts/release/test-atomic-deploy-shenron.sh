#!/usr/bin/env bash
set -euo pipefail

# Stub test of atomic-deploy-shenron.sh (assemble, activate, rollback, restore).
# Run as root on Linux or WSL; systemd, nginx, curl and bun are replaced.
script="$(cd "$(dirname "$0")" && pwd)/atomic-deploy-shenron.sh"
fixture="$(mktemp -d)"
on_exit() {
  local status=$?
  if [[ "$status" -ne 0 && -f "$fixture/out" ]]; then cat "$fixture/out" >&2; fi
  rm -rf -- "$fixture"
}
trap on_exit EXIT
mkdir -p "$fixture"/{bin,state,etc,units,share,shenron/shared,bundles}
export MOCK_STATE="$fixture/state"
export SHENRON_RELEASE_ROOT="$fixture/shenron" SHENRON_INFRA_SHARE="$fixture/share"
export SHENRON_SYSTEMD_DIR="$fixture/units" SHENRON_ENV_ROOT="$fixture/etc" SHENRON_PROBE_ATTEMPTS=2
export SHENRON_NGINX_CONF="$fixture/shenron.conf" SHENRON_RUN_AS=root SHENRON_BUN="$fixture/bin/bun"
export PATH="$fixture/bin:$PATH"

cat > "$fixture/bin/systemctl" <<'SH'
#!/usr/bin/env bash
unit="${@: -1}"
case "$1" in
  daemon-reload|reload) exit 0 ;;
  is-active) test -e "$MOCK_STATE/$unit.active" ;;
  is-enabled) test -e "$MOCK_STATE/$unit.enabled" ;;
  restart) touch "$MOCK_STATE/$unit.active" ;;
  stop) rm -f "$MOCK_STATE/$unit.active" ;;
  enable) touch "$MOCK_STATE/$unit.enabled" ;;
  disable) rm -f "$MOCK_STATE/$unit.enabled" ;;
  *) exit 2 ;;
esac
SH
cat > "$fixture/bin/curl" <<'SH'
#!/usr/bin/env bash
for arg in "$@"; do
  if [[ "$arg" = --resolve && "${FAIL_PUBLIC:-0}" = 1 ]]; then exit 1; fi
done
[[ "${FAIL_PROBE:-0}" = 0 ]]
SH
cat > "$fixture/bin/nginx" <<'SH'
#!/usr/bin/env bash
[[ "${FAIL_NGINX:-0}" = 0 ]]
SH
cat > "$fixture/bin/bun" <<'SH'
#!/usr/bin/env bash
[[ "$1" = install && "$2" = --frozen-lockfile && ( $# = 2 || ( $# = 3 && "$3" = --ignore-scripts ) ) ]] || exit 2
printf '%s\n' "$*" > .fixture-install-args
mkdir -p node_modules/next/dist/bin
printf 'next\n' > node_modules/next/dist/bin/next
SH
chmod +x "$fixture/bin/"*

cat > "$fixture/share/service-catalog.json" <<'JSON'
{"services":[
 {"id":"shenron-site","application":"shenron","unit":"shenron-site.service","health":"http://127.0.0.1:5011/api/health","workingDirectory":"/home/ubuntu/apps/shenron/current/apps/site"},
 {"id":"shenron-mcp","application":"aphrody","unit":"shenron-mcp.service","health":"http://127.0.0.1:5010/health","status":"retired","retiredAt":"2026-09-25"},
 {"id":"shenron-bot","application":"shenron","unit":"shenron-bot.service","health":"http://127.0.0.1:5006/health","workingDirectory":"/home/ubuntu/apps/shenron/current/apps/bot"},
 {"id":"shenron-pg-tunnel","application":"shenron","unit":"shenron-pg-tunnel.service","health":"tcp://127.0.0.1:15433"},
 {"id":"shenron-old","application":"shenron","unit":"shenron-old.service","workingDirectory":"/home/ubuntu/apps/shenron/current/apps/old","status":"retired","retiredAt":"2026-09-26"}
]}
JSON
cat > "$fixture/share/nginx-routes.json" <<'JSON'
{"routes":[
 {"host":"dragonballfr.com","service":"shenron-site","upstream":"127.0.0.1:5011"},
 {"host":"bot.dragonballfr.com","service":"shenron-bot","upstream":"127.0.0.1:5006"},
 {"host":"mcp.dragonballfr.com","service":"shenron-mcp","upstream":"127.0.0.1:5010","status":"retired","retiredAt":"2026-09-25"}
]}
JSON
cat > "$fixture/share/secrets-contract.json" <<'JSON'
{"services":{"shenron-site":{"secrets":[{"name":"DATABASE_URL","required":true,"description":"db"}]},
 "shenron-bot":{"secrets":[{"name":"GUILD_ID","required":true,"description":"guild"},{"name":"API_ADMIN_TOKEN","required":false,"description":"admin"}]}}}
JSON
printf 'DATABASE_URL=postgresql://fixture\n' > "$fixture/etc/shenron-site.env"
printf 'GUILD_ID=123456789012345678\n' > "$fixture/etc/shenron-bot.env"
chmod 600 "$fixture/etc/"*.env

make_bundle() {
  local commit="$1" marker="$2" dir="$fixture/bundles/$2" src="$fixture/src-$2" art="$fixture/art-$2"
  mkdir -p "$dir"/{systemd,nginx} "$src"/apps/site/public "$src"/apps/bot/{data,assets} "$art/build"
  printf '{"name":"shenron-fixture"}\n' > "$src/package.json"
  printf '{"seed":"%s"}\n' "$marker" > "$src/apps/bot/data/seed.json"
  printf 'asset\n' > "$src/apps/bot/assets/cover.txt"
  tar -czf "$dir/source.tar.gz" -C "$src" .
  printf '{"schema":"shenron-site-artifact/v1","commit":"%s","buildId":"build-%s"}\n' "${commit:0:8}" "$marker" > "$art/artifact-manifest.json"
  printf 'build-%s\n' "$marker" > "$art/build/BUILD_ID"
  tar -czf "$dir/site-build.tar.gz" -C "$art" artifact-manifest.json build
  printf '{"schemaVersion":1,"repository":"shenron","commit":"%s","builtAt":"2026-09-26T00:00:00Z","services":["shenron-site","shenron-bot"],"siteArtifact":{"buildId":"build-%s"}}\n' "$commit" "$marker" > "$dir/release.json"
  for service in site bot; do
    cat > "$dir/systemd/shenron-$service.service" <<UNIT
[Service]
WorkingDirectory=/home/ubuntu/apps/shenron/current/apps/$service
EnvironmentFile=-$fixture/etc/shenron-$service.env
EnvironmentFile=-$fixture/etc/shenron-compute-client.env
ExecStart=/usr/bin/true
# $marker
UNIT
  done
  printf 'server { server_name dragonballfr.com www.dragonballfr.com; }\nserver { server_name bot.dragonballfr.com; } # %s\n' "$marker" > "$dir/nginx/shenron.conf"
  (cd "$dir" && find . -type f ! -name SHA256SUMS -printf '%P\0' | sort -z | xargs -0 sha256sum > SHA256SUMS)
}
first_sha=1111111111111111111111111111111111111111
second_sha=2222222222222222222222222222222222222222
make_bundle "$first_sha" first
make_bundle "$second_sha" second
first="$fixture/shenron/releases/$first_sha"
second="$fixture/shenron/releases/$second_sha"
seed="$fixture/shenron/shared/bot/data/seed.json"

bash "$script" assemble "$fixture/bundles/first" >"$fixture/out" 2>&1
[[ -L "$first/apps/bot/data" && "$(readlink "$first/apps/bot/data")" = "$fixture/shenron/shared/bot/data" ]]
[[ -f "$first/.shared-seed/apps/bot/data/seed.json" && -f "$first/node_modules/next/dist/bin/next" ]]
[[ "$(cat "$first/apps/site/.next-build/BUILD_ID")" = build-first && ! -e "$fixture/shenron/current" ]]
bash "$script" assemble "$fixture/bundles/first" >"$fixture/out" 2>&1
grep -q 'already assembled' "$fixture/out"

# A required contract key missing from the unit's env files blocks activation.
printf 'OTHER=1\n' > "$fixture/etc/shenron-bot.env"
if bash "$script" "$first" >"$fixture/out" 2>&1; then echo 'accepted missing GUILD_ID' >&2; exit 1; fi
grep -q 'GUILD_ID' "$fixture/out"
[[ ! -e "$fixture/shenron/current" && ! -e "$fixture/units/shenron-site.service" ]]
printf 'GUILD_ID=123456789012345678\n' > "$fixture/etc/shenron-bot.env"

if FAIL_PROBE=1 bash "$script" "$first" >"$fixture/out" 2>&1; then echo 'accepted failed readiness' >&2; exit 1; fi
[[ ! -e "$fixture/shenron/current" && ! -e "$fixture/units/shenron-site.service" && ! -e "$seed" ]]
[[ ! -e "$fixture/state/shenron-site.service.active" ]]

bash "$script" "$first" >"$fixture/out" 2>&1
[[ "$(readlink -f "$fixture/shenron/current")" = "$first" ]]
grep -q '# first' "$fixture/units/shenron-bot.service"
grep -q '# first' "$fixture/shenron.conf"
grep -q '"first"' "$seed"
[[ ! -e "$fixture/units/shenron-old.service" && ! -e "$fixture/units/shenron-pg-tunnel.service" ]]

bash "$script" assemble "$fixture/bundles/second" >"$fixture/out" 2>&1
if FAIL_NGINX=1 bash "$script" activate "$second" >"$fixture/out" 2>&1; then echo 'accepted failed nginx config' >&2; exit 1; fi
[[ "$(readlink -f "$fixture/shenron/current")" = "$first" ]]
grep -q '# first' "$fixture/units/shenron-site.service"
grep -q '# first' "$fixture/shenron.conf"
grep -q '"first"' "$seed"
[[ -e "$fixture/state/shenron-site.service.active" ]]
if FAIL_PUBLIC=1 bash "$script" activate "$second" >"$fixture/out" 2>&1; then echo 'accepted failed public route' >&2; exit 1; fi
[[ "$(readlink -f "$fixture/shenron/current")" = "$first" ]]
grep -q '"first"' "$seed"

SHENRON_BACKUP_DIR="$fixture/backup-second" bash "$script" activate "$second" >"$fixture/out" 2>&1
[[ "$(readlink -f "$fixture/shenron/current")" = "$second" ]]
grep -q '"second"' "$seed"
grep -q '# second' "$fixture/units/shenron-site.service"
# One release on disk: the healthy activation pruned `first`, so restore refuses until it is reassembled.
[[ ! -e "$first" ]]
if bash "$script" restore "$fixture/backup-second" >"$fixture/out" 2>&1; then echo 'restored a pruned release' >&2; exit 1; fi
grep -q 'was pruned' "$fixture/out"
[[ "$(readlink -f "$fixture/shenron/current")" = "$second" ]]
bash "$script" assemble "$fixture/bundles/first" >"$fixture/out" 2>&1
bash "$script" restore "$fixture/backup-second" >"$fixture/out" 2>&1
[[ "$(readlink -f "$fixture/shenron/current")" = "$first" ]]
grep -q '"first"' "$seed"
grep -q '# first' "$fixture/units/shenron-site.service"
grep -q '# first' "$fixture/shenron.conf"
[[ -e "$fixture/state/shenron-bot.service.active" ]]
# Current monorepo layout, DBFR local PostgreSQL and unit dependency mapping.
third_sha=3333333333333333333333333333333333333333
make_bundle "$third_sha" third
mkdir -p "$fixture/src-third/apps/shenron"
mv "$fixture/src-third/apps/site" "$fixture/src-third/apps/shenron/site"
mv "$fixture/src-third/apps/bot" "$fixture/src-third/apps/shenron/bot"
mkdir -p "$fixture/src-third/packages/infra/workspace/node_modules"
ln -s '../../../../node_modules/.bun/typescript@5.9.3/node_modules/typescript' "$fixture/src-third/packages/infra/workspace/node_modules/typescript-compiler-api"
# Monorepo source contains unrelated Infra units; rendering must leave them
# untouched and never validate their env files as Shenron deployment input.
mkdir -p "$fixture/src-third/systemd"
printf '[Service]\nEnvironmentFile=-/home/other/private.env\n' > "$fixture/src-third/systemd/unrelated-owner.service"
tar -czf "$fixture/bundles/third/source.tar.gz" -C "$fixture/src-third" .
python3 - "$fixture/bundles/third/release.json" <<'PYMANIFEST'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1]); m = json.loads(p.read_text())
m.update(repository='aphrody-labs/aphrody', sourceLayout='monorepo', target='dbfr')
p.write_text(json.dumps(m) + '\n')
PYMANIFEST
sed -i '/^\[Service\]/i [Unit]\nAfter=network-online.target shenron-pg-tunnel.service\nWants=network-online.target shenron-pg-tunnel.service' "$fixture/bundles/third/systemd/"*.service
sed -i 's|ExecStart=/usr/bin/true|ExecStart=/home/ubuntu/.bun/bin/bun --bun /home/ubuntu/apps/shenron/current/node_modules/next/dist/bin/next start|' "$fixture/bundles/third/systemd/shenron-site.service"
(cd "$fixture/bundles/third" && find . -type f ! -name SHA256SUMS -printf '%P\0' | sort -z | xargs -0 sha256sum > SHA256SUMS)
# The isolated monorepo install puts Next under the site owner, not root.
python3 - "$fixture/bin/bun" <<'PYISOLATED'
import pathlib,sys
p=pathlib.Path(sys.argv[1]);s=p.read_text().replace('node_modules/next/dist/bin', 'apps/shenron/site/node_modules/next/dist/bin');p.write_text(s)
PYISOLATED
if SHENRON_KEEP_FAILED_STAGE=1 bash "$script" assemble "$fixture/bundles/third" >"$fixture/out" 2>&1; then echo 'accepted DBFR nonlocal PostgreSQL' >&2; exit 1; fi
grep -q 'host-local PostgreSQL' "$fixture/out"
retained="$(find "$fixture/shenron/releases" -maxdepth 1 -type d -name ".assembling-$third_sha.*" -print -quit)"
[[ -n "$retained" && "$(stat -c %a "$retained")" = 700 ]]

printf 'DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:5432/shenron_site\n' > "$fixture/etc/shenron-site.env"

bash "$script" assemble "$fixture/bundles/third" >"$fixture/out" 2>&1
third="$fixture/shenron/releases/$third_sha"
[[ -L "$third/apps/shenron/bot/data" && -f "$third/apps/shenron/site/.next-build/BUILD_ID" ]]
[[ ! -e "$third/packages/infra/workspace/node_modules/typescript-compiler-api" && ! -L "$third/packages/infra/workspace/node_modules/typescript-compiler-api" ]]
grep -q '^EnvironmentFile=-/home/other/private.env$' "$third/systemd/unrelated-owner.service"
grep -q 'ExecStart=.*current/apps/shenron/site/node_modules/next/dist/bin/next' "$third/systemd/shenron-site.service"
grep -q 'WorkingDirectory=/home/ubuntu/apps/shenron/current/apps/shenron/site' "$third/systemd/shenron-site.service"
if grep -q 'shenron-pg-tunnel.service' "$third/systemd/"*.service; then echo 'DBFR retains tunnel dependency' >&2; exit 1; fi
mkdir -p "$fixture/shenron/releases/.superseded-1111111-20261005T000000Z"
bash "$script" activate "$third" >"$fixture/out" 2>&1
[[ "$(readlink -f "$fixture/shenron/current")" = "$third" ]]
[[ ! -e "$first" && ! -e "$second" && ! -e "$fixture/shenron/releases/.superseded-1111111-20261005T000000Z" ]]
[[ -d "$retained" ]] && grep -q 'pruned with 3 other releases' "$fixture/out"
grep -q '^install --frozen-lockfile --ignore-scripts$' "$third/.fixture-install-args"
[[ -f "$third/apps/shenron/site/node_modules/next/dist/bin/next" && ! -e "$third/node_modules/next/dist/bin/next" ]]
echo 'Shenron monorepo DBFR mapping and local PostgreSQL preflight: ok'
echo 'Shenron adapter assemble, preflight, activation, rollback and restore: ok'

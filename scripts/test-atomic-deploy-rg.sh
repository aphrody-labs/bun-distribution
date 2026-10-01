#!/usr/bin/env bash
set -euo pipefail

script="$(cd "$(dirname "$0")" && pwd)/atomic-deploy-rg.sh"
fixture="$(mktemp -d)"
on_exit() {
  local status=$?
  if [[ "$status" -ne 0 && -f "$fixture/out" ]]; then cat "$fixture/out" >&2; fi
  rm -rf -- "$fixture"
}
trap on_exit EXIT
mkdir -p "$fixture"/{bin,state,etc,units,rg/releases}
export MOCK_STATE="$fixture/state"
export RG_RELEASE_ROOT="$fixture/rg" RG_SERVICE_CATALOG="$fixture/catalog.json"
export RG_NGINX_ROUTES="$fixture/routes.json"
export RG_SYSTEMD_DIR="$fixture/units" RG_ENV_ROOT="$fixture/etc" RG_PROBE_ATTEMPTS=2
export RG_NGINX_CONF="$fixture/rg.conf"
export PATH="$fixture/bin:$PATH"

cat > "$fixture/bin/systemctl" <<'SH'
#!/usr/bin/env bash
unit="${@: -1}"
case "$1" in
  daemon-reload) exit 0 ;;
  is-active) test -e "$MOCK_STATE/$unit.active" ;;
  is-enabled) test -e "$MOCK_STATE/$unit.enabled" ;;
  restart) touch "$MOCK_STATE/$unit.active" ;;
  reload) exit 0 ;;
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
chmod +x "$fixture/bin/systemctl" "$fixture/bin/curl" "$fixture/bin/nginx"
cat > "$fixture/catalog.json" <<'JSON'
{"services":[{"id":"rg-api","unit":"rg-api.service","health":"http://127.0.0.1:8800/health"},{"id":"rg-cdn","unit":"rg-cdn.service","health":"http://127.0.0.1:8801/health","status":"retired","retiredAt":"2026-09-26"},{"id":"rg-cron","unit":"rg-cron.service"}]}
JSON
cat > "$fixture/routes.json" <<'JSON'
{"routes":[{"host":"api.rosegriffon.fr","service":"rg-api","upstream":"127.0.0.1:8800"}]}
JSON
for service in api cron; do
  printf 'CHECK=1\n' > "$fixture/etc/rg-$service.env"
  chmod 600 "$fixture/etc/rg-$service.env"
done

build_release() {
  local directory="$1" marker="$2" repository="$3"
  mkdir -p "$directory"/{apps,packages,systemd,nginx}
  cat > "$directory/release.json" <<JSON
{"schemaVersion":1,"repository":"$repository","commit":"1111111111111111111111111111111111111111","builtAt":"2026-09-23T00:00:00Z","services":["rg-api","rg-cron"]}
JSON
  printf '1111111111111111111111111111111111111111\n' > "$directory/RELEASE_SHA"
  for service in api cron; do
    cat > "$directory/systemd/rg-$service.service" <<UNIT
[Service]
WorkingDirectory=/srv/rg/current/apps/$service
EnvironmentFile=$fixture/etc/rg-$service.env
ExecStart=/usr/bin/true
# $marker
UNIT
  done
  printf 'server { server_name api.rosegriffon.fr; } # %s\n' "$marker" > "$directory/nginx/rg.conf"
  (cd "$directory" && sha256sum release.json RELEASE_SHA systemd/*.service nginx/rg.conf > SHA256SUMS)
}

first="$fixture/rg/releases/first"
second="$fixture/rg/releases/second"
build_release "$first" first rg
build_release "$second" second aphrody-labs/aphrody
unknown="$fixture/rg/releases/unknown"
build_release "$unknown" unknown unrelated/repository
if bash "$script" "$unknown" >"$fixture/out" 2>&1; then echo 'accepted unknown repository' >&2; exit 1; fi
[[ ! -e "$fixture/rg/current" && ! -e "$fixture/units/rg-api.service" ]]
[[ ! -e "$fixture/rg.conf" ]]

chmod 644 "$fixture/etc/rg-api.env"
if bash "$script" "$first" >"$fixture/out" 2>&1; then echo 'accepted insecure env file' >&2; exit 1; fi
[[ ! -e "$fixture/rg/current" && ! -e "$fixture/units/rg-api.service" ]]
[[ ! -e "$fixture/rg.conf" ]]
chmod 600 "$fixture/etc/rg-api.env"

if FAIL_PROBE=1 bash "$script" "$first" >"$fixture/out" 2>&1; then echo 'accepted failed readiness' >&2; exit 1; fi
[[ ! -e "$fixture/rg/current" && ! -e "$fixture/units/rg-api.service" ]]
[[ ! -e "$fixture/state/rg-api.service.active" ]]

bash "$script" "$first" >"$fixture/out" 2>&1
[[ "$(readlink -f "$fixture/rg/current")" = "$first" ]]
grep -q '# first' "$fixture/units/rg-api.service"
grep -q '# first' "$fixture/rg.conf"

if FAIL_NGINX=1 bash "$script" "$second" >"$fixture/out" 2>&1; then echo 'accepted failed nginx config' >&2; exit 1; fi
[[ "$(readlink -f "$fixture/rg/current")" = "$first" ]]
grep -q '# first' "$fixture/units/rg-api.service"
grep -q '# first' "$fixture/rg.conf"
[[ -e "$fixture/state/rg-api.service.active" ]]
if FAIL_PUBLIC=1 bash "$script" "$second" >"$fixture/out" 2>&1; then echo 'accepted failed public route' >&2; exit 1; fi
[[ "$(readlink -f "$fixture/rg/current")" = "$first" ]]
grep -q '# first' "$fixture/rg.conf"
# Exercise successful monorepo activation and an explicit legacy rollback.
bash "$script" "$second" >"$fixture/out" 2>&1
[[ "$(readlink -f "$fixture/rg/current")" = "$second" ]]
grep -q '# second' "$fixture/units/rg-api.service"
grep -q '# second' "$fixture/rg.conf"
bash "$script" "$first" >"$fixture/out" 2>&1
[[ "$(readlink -f "$fixture/rg/current")" = "$first" ]]
grep -q '# first' "$fixture/units/rg-api.service"
grep -q '# first' "$fixture/rg.conf"
[[ ! -e "$fixture/units/rg-cdn.service" ]] # retired services are never installed
echo 'RG adapter preflight, activation and rollback: ok'

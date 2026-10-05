#!/usr/bin/env bash
set -euo pipefail
binary="$(realpath -e -- "${1:?usage: smoke-bxc-systemd.sh BINARY LIBRARY}")"
library="$(realpath -e -- "${2:?usage: smoke-bxc-systemd.sh BINARY LIBRARY}")"
tmp="$(mktemp -d /dev/shm/aphrody-bxc.XXXXXXXX)"
unit="aphrody-bxc-smoke-$$"
port=33906
cleanup() {
  systemctl --user stop "$unit.service" >/dev/null 2>&1 || true
  rm -rf -- "$tmp"
}
trap cleanup EXIT
mkdir -p "$tmp/data"
chmod 0700 "$tmp" "$tmp/data"
install -m 0755 "$binary" "$tmp/aphrody-web-api"
install -m 0755 "$library" "$tmp/libaphrody_web_ffi.so"
token="$(openssl rand -hex 32)"
printf 'BXC_API_TOKEN=%s\nPORT=%s\nBXC_DIR=%s\nBXC_COOKIES_DIR=%s\nBXC_DB_PATH=%s\nBXC_RUST_BRIDGE_LIB=%s\n' \
  "$token" "$port" "$tmp/data" "$tmp/data/cookies" "$tmp/data/bxc.sqlite" "$tmp/libaphrody_web_ffi.so" > "$tmp/service.env"
chmod 0600 "$tmp/service.env"
systemd-run --user --quiet --unit="$unit" --property=EnvironmentFile="$tmp/service.env" \
  --property=WorkingDirectory="$tmp" --property=ProtectSystem=strict \
  --property=ProtectHome=true --property=ReadWritePaths="$tmp/data" \
  --property=NoNewPrivileges=true --property=PrivateTmp=true "$tmp/aphrody-web-api"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then break; fi
  systemctl --user is-active --quiet "$unit.service" || {
    echo 'sandboxed BXC unit exited' >&2
    journalctl --user -u "$unit.service" -n 15 --no-pager 2>/dev/null | sed "s/$token/[REDACTED_SECRET]/g" >&2
    exit 1
  }
  sleep 1
done
[[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/health")" = 200 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/")" = 401 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "http://127.0.0.1:$port/")" = 200 ]]
echo 'BXC standalone under systemd sandbox: ok'

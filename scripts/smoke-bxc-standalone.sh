#!/usr/bin/env bash
set -euo pipefail
binary="$(realpath -e -- "${1:?usage: smoke-bxc-standalone.sh BINARY}")"
port="${BXC_SMOKE_PORT:-33905}"
tmp="$(mktemp -d)"
token="$(openssl rand -hex 32)"
pid=''
fixture_pid=''
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  if [[ -n "$fixture_pid" ]]; then kill "$fixture_pid" 2>/dev/null || true; wait "$fixture_pid" 2>/dev/null || true; fi
  rm -rf -- "$tmp"
}
trap cleanup EXIT
export BXC_API_TOKEN="$token" PORT="$port" BXC_DIR="$tmp/bxc" BXC_COOKIES_DIR="$tmp/bxc/cookies" BXC_DB_PATH="$tmp/bxc.sqlite"
"$binary" >"$tmp/server.log" 2>&1 &
pid=$!
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then break; fi
  kill -0 "$pid" 2>/dev/null || {
    echo 'BXC exited before health probe' >&2
    sed "s/$token/[REDACTED_SECRET]/g" "$tmp/server.log" | head -n 16 >&2
    exit 1
  }
  sleep 1
done
[[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/health")" = 200 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/")" = 401 ]]
[[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $token" "http://127.0.0.1:$port/")" = 200 ]]
fixture_port="${BXC_SMOKE_FIXTURE_PORT:-33907}"
printf '<!doctype html><html><head><title>Aphrody BXC fixture</title></head><body><h1>Fixture local web</h1></body></html>' > "$tmp/index.html"
printf '<!doctype html><html><head><title>Unrendered</title></head><body><script>document.title="Aphrody BXC JS fixture"; document.body.innerHTML="<h1>Rendered locally</h1>";</script></body></html>' > "$tmp/render.html"
python3 -m http.server "$fixture_port" --bind 127.0.0.1 --directory "$tmp" > "$tmp/fixture.log" 2>&1 &
fixture_pid=$!
for _ in $(seq 1 10); do
  if curl -fsS "http://127.0.0.1:$fixture_port/index.html" >/dev/null 2>&1; then break; fi
  sleep 1
done
[[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$fixture_port/index.html")" = 200 ]]
for profile in static render; do
  fixture=index.html
  expected='Aphrody BXC fixture'
  if [[ "$profile" = render ]]; then fixture=render.html; expected='Aphrody BXC JS fixture'; fi
  status="$(curl --silent --show-error --max-time 45 -o "$tmp/$profile.json" -w '%{http_code}' \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    -d "{\"url\":\"http://127.0.0.1:$fixture_port/$fixture\",\"profile\":\"$profile\"}" \
    "http://127.0.0.1:$port/api/v1/scrape")"
  if [[ "$status" != 200 ]] || ! grep -Fq "$expected" "$tmp/$profile.json"; then
    printf 'BXC %s fixture failed: HTTP %s\n' "$profile" "$status" >&2
    head -c 400 "$tmp/$profile.json" | sed "s/$token/[REDACTED_SECRET]/g" >&2
    exit 1
  fi
done
echo 'BXC standalone health, auth, static scrape and JS render: ok'

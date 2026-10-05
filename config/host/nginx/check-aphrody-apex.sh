#!/usr/bin/env bash
set -euo pipefail
here="$(realpath -e -- "$(dirname -- "${BASH_SOURCE[0]}")")"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$tmp/live/aphrody.com"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=aphrody.com \
  -keyout "$tmp/live/aphrody.com/privkey.pem" \
  -out "$tmp/live/aphrody.com/fullchain.pem" >/dev/null 2>&1
openssl dhparam -dsaparam -out "$tmp/ssl-dhparams.pem" 2048 >/dev/null 2>&1
printf '# syntax check only\n' > "$tmp/options-ssl-nginx.conf"
docker run --rm \
  --mount "type=bind,source=$here/aphrody/aphrody-apex.conf,target=/etc/nginx/conf.d/aphrody-apex.conf,readonly" \
  --mount "type=bind,source=$tmp,target=/etc/letsencrypt,readonly" \
  nginx:alpine nginx -t

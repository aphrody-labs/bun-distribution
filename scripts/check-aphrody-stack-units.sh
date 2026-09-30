#!/usr/bin/env bash
set -euo pipefail
repo="$(realpath -e -- "$(dirname -- "${BASH_SOURCE[0]}")/..")"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
mkdir -p "$tmp/etc/systemd/system" "$tmp/srv/aphrody/current/bin"
for name in aphrody-web-api aphrody-a2a aphrody-shenron-embed aphrody-ai-http aphrody-site-immutable; do
  install -m 0644 "$repo/systemd/$name.service.example" "$tmp/etc/systemd/system/$name.service"
done
for name in aphrody-web-api aphrody aphrody-mcp aphrody-site aphrody-embed; do
  install -m 0755 /bin/true "$tmp/srv/aphrody/current/bin/$name"
done
for target in sysinit basic network-online multi-user; do
  printf '[Unit]\nDescription=Verification target\n' > "$tmp/etc/systemd/system/$target.target"
done
systemd-analyze verify --root="$tmp" /etc/systemd/system/aphrody-web-api.service \
  /etc/systemd/system/aphrody-a2a.service /etc/systemd/system/aphrody-shenron-embed.service \
  /etc/systemd/system/aphrody-ai-http.service \
  /etc/systemd/system/aphrody-site-immutable.service
echo 'Aphrody stack unit syntax: ok'

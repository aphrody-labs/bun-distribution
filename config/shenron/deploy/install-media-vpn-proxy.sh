#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The privoxy.service drop-in is owned by aphrody-infra (systemd/privoxy.service.d/).
# Default: sibling checkout ../aphrody-infra; override with APHRODY_INFRA_ROOT.
INFRA_ROOT="${APHRODY_INFRA_ROOT:-$REPO/../aphrody-infra}"
DROPIN="$INFRA_ROOT/systemd/privoxy.service.d/shenron-media.conf"
if [[ ! -f "$DROPIN" ]]; then
  echo "privoxy drop-in not found: $DROPIN (set APHRODY_INFRA_ROOT)" >&2
  exit 1
fi

if ! systemctl is-active --quiet wg-quick@wg0.service; then
  echo "wg0 is not active" >&2
  exit 1
fi

if ! timeout 3 bash -c '</dev/tcp/10.8.0.1/1080'; then
  echo "Mullvad SOCKS5 endpoint 10.8.0.1:1080 is unavailable" >&2
  exit 1
fi

if ! command -v privoxy >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends privoxy
fi

sudo install -m 0644 "$REPO/deploy/privoxy/shenron-media.conf" /etc/privoxy/config
sudo install -d -m 0755 /etc/systemd/system/privoxy.service.d
sudo install -m 0644 "$DROPIN" \
  /etc/systemd/system/privoxy.service.d/shenron-media.conf

sudo install -m 0600 "$REPO/deploy/privoxy/shenron-media-proxy.env" \
  /home/ubuntu/.shenron-media-proxy.env
sudo chown ubuntu:ubuntu /home/ubuntu/.shenron-media-proxy.env
sudo chmod 0600 /home/ubuntu/.shenron-media-proxy.env

sudo systemctl daemon-reload
sudo systemctl enable --now wg-quick@wg0.service privoxy.service
sudo systemctl restart privoxy.service

curl --fail --silent --show-error --max-time 15 \
  --proxy http://127.0.0.1:8119 https://am.i.mullvad.net/json >/dev/null
echo "Mullvad HTTP bridge ready on 127.0.0.1:8119"

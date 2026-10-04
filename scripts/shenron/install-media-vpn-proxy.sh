#!/usr/bin/env bash
# scripts/shenron/install-media-vpn-proxy.sh
# Centralized installer for the Privoxy -> Mullvad WireGuard HTTP bridge (127.0.0.1:8119).
# Owned and orchestrated by aphrody-infra.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

YOLO_ROOT="${YOLO_ROOT:-$HOME/yolo}"
DROPIN="$YOLO_ROOT/config/host/systemd/shenron/privoxy.service.d/shenron-media.conf"
CONFIG="${YOLO_ROOT:-$HOME/yolo}/config/host/privoxy/shenron-media.conf"
ENV_EXAMPLE="${YOLO_ROOT:-$HOME/yolo}/config/host/privoxy/shenron-media-proxy.env.example"

if [[ ! -f "$DROPIN" ]]; then
  echo "✗ Systemd drop-in not found: $DROPIN" >&2
  exit 1
fi

if [[ ! -f "$CONFIG" ]]; then
  echo "✗ Privoxy config not found: $CONFIG" >&2
  exit 1
fi

echo "=== Shenron Privoxy / Mullvad Bridge Provisioning ==="

if ! systemctl is-active --quiet wg-quick@wg0.service; then
  echo "✗ WireGuard interface wg0 is not active (systemctl is-active wg-quick@wg0.service)" >&2
  exit 1
fi

if ! timeout 3 bash -c '</dev/tcp/10.8.0.1/1080' 2>/dev/null; then
  echo "✗ Mullvad SOCKS5 endpoint 10.8.0.1:1080 is unreachable on wg0" >&2
  exit 1
fi

if ! command -v privoxy >/dev/null 2>&1; then
  echo "→ Installing privoxy package..."
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends privoxy
fi

echo "→ Installing Privoxy configuration..."
sudo install -m 0644 "$CONFIG" /etc/privoxy/config
sudo install -d -m 0755 /etc/systemd/system/privoxy.service.d
sudo install -m 0644 "$DROPIN" /etc/systemd/system/privoxy.service.d/shenron-media.conf

if [[ -f "$ENV_EXAMPLE" ]]; then
  target_user="${SHENRON_RUN_AS:-$(id -un)}"
  target_home="$(getent passwd "$target_user" | cut -d: -f6)"
  echo "→ Installing $target_home/.shenron-media-proxy.env..."
  sudo install -m 0600 -o "$target_user" -g "$target_user" "$ENV_EXAMPLE" "$target_home/.shenron-media-proxy.env"
fi

echo "→ Reloading systemd and restarting privoxy.service..."
sudo systemctl daemon-reload
sudo systemctl enable --now wg-quick@wg0.service privoxy.service
sudo systemctl restart privoxy.service

echo "→ Validating HTTP bridge connectivity..."
if curl --fail --silent --show-error --max-time 15 \
  --proxy http://127.0.0.1:8119 https://am.i.mullvad.net/json >/dev/null; then
  echo "✓ Mullvad HTTP bridge operational on 127.0.0.1:8119"
else
  echo "✗ Bridge verification failed" >&2
  exit 1
fi

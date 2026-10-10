#!/usr/bin/env bash
set -euo pipefail

NS="mullvad"
DEV="wg-mullvad"
PRIVKEY="/etc/wireguard/mullvad.key"
ADDRESS="10.72.22.214/32"
ENV_FILE="/etc/wireguard/mullvad-relay.env"

# Default to US relay (Atlanta)
ENDPOINT="45.134.140.130:51820"
PEER_PUBKEY="nvyBkaEXHwyPBAm8spGB0TFzf2W5wPAl8EEuJ0t+bzs="

if [ -f "$ENV_FILE" ]; then
    # shellcheck source=/dev/null
    source "$ENV_FILE"
fi

# Clean existing
ip netns del "$NS" 2>/dev/null || true
ip link del dev "$DEV" 2>/dev/null || true

# 1. Create WireGuard device in host
ip link add dev "$DEV" type wireguard

# 2. Configure keys & peer BEFORE moving into netns
wg set "$DEV" \
    private-key "$PRIVKEY" \
    peer "$PEER_PUBKEY" \
    endpoint "$ENDPOINT" \
    allowed-ips 0.0.0.0/0 \
    persistent-keepalive 25

# 3. Create namespace and move wireguard interface inside
ip netns add "$NS"
ip link set dev "$DEV" netns "$NS"

# 4. Bring up loopback & wg-mullvad inside namespace
ip netns exec "$NS" ip link set lo up
ip netns exec "$NS" ip addr add "$ADDRESS" dev "$DEV"
ip netns exec "$NS" ip link set "$DEV" up
ip netns exec "$NS" ip route add default dev "$DEV"

# 5. Add DNS inside netns
mkdir -p /etc/netns/"$NS"
echo "nameserver 10.64.0.1" > /etc/netns/"$NS"/resolv.conf

echo "Mullvad netns configured successfully targeting $ENDPOINT."

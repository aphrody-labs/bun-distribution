#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Aphrody-scoped egress namespace. The host's default route and wg1 mesh stay untouched.
set -euo pipefail

NS=mullvad
DEV=wg-mullvad
PRIVKEY=/etc/wireguard/mullvad.key
ENV_FILE=/etc/wireguard/mullvad-relay.env
WG_ADDRESS=10.72.22.214/32
HOST_VETH=mullvad0
NS_VETH=mullvad1
HOST_ADDRESS=10.200.1.1/30
NS_ADDRESS=10.200.1.2/30

[[ $EUID -eq 0 ]] || { echo 'must run as root' >&2; exit 1; }
[[ -r $PRIVKEY ]] || { echo "missing root-readable WireGuard key file: $PRIVKEY" >&2; exit 1; }
[[ -r $ENV_FILE ]] || { echo "missing Japan relay cache: $ENV_FILE" >&2; exit 1; }
# This file is root-owned, mode 0644, and contains public peer metadata only.
# shellcheck disable=SC1090
source "$ENV_FILE"
[[ ${COUNTRY_CODE:-} == jp && ${HOSTNAME:-} == jp-* ]] || { echo 'refusing non-Japan Mullvad relay' >&2; exit 1; }
[[ ${ENDPOINT:-} =~ ^[0-9.]+:51820$ && ${PEER_PUBKEY:-} =~ ^[A-Za-z0-9+/]{43}=$ ]] || { echo 'invalid Mullvad relay cache' >&2; exit 1; }

mkdir -p /etc/netns/"$NS"
printf 'nameserver 10.64.0.1\n' > /etc/netns/"$NS"/resolv.conf

if ! ip netns list | awk '{print $1}' | grep -qx "$NS"; then
  if ip link show dev "$DEV" >/dev/null 2>&1; then
    echo "refusing to move pre-existing host interface $DEV" >&2; exit 1
  fi
  ip link add dev "$DEV" type wireguard
  wg set "$DEV" private-key "$PRIVKEY" peer "$PEER_PUBKEY" endpoint "$ENDPOINT" allowed-ips 0.0.0.0/0 persistent-keepalive 25
  ip netns add "$NS"
  ip link set dev "$DEV" netns "$NS"
fi

ip netns exec "$NS" ip link show dev "$DEV" >/dev/null
ip netns exec "$NS" wg set "$DEV" private-key "$PRIVKEY" peer "$PEER_PUBKEY" endpoint "$ENDPOINT" allowed-ips 0.0.0.0/0 persistent-keepalive 25
ip netns exec "$NS" ip link set lo up
ip netns exec "$NS" ip addr replace "$WG_ADDRESS" dev "$DEV"
ip netns exec "$NS" ip link set "$DEV" up
ip netns exec "$NS" ip route replace default dev "$DEV"

# A point-to-point private link carries only the SOCKS listener between the VPS host
# and this namespace. The host route/default gateway is never modified.
if ! ip netns exec "$NS" ip link show dev "$NS_VETH" >/dev/null 2>&1; then
  if ip link show dev "$HOST_VETH" >/dev/null 2>&1; then
    echo "refusing to reuse unrelated host interface $HOST_VETH" >&2; exit 1
  fi
  ip link add "$HOST_VETH" type veth peer name "$NS_VETH"
  ip link set "$NS_VETH" netns "$NS"
fi
ip addr replace "$HOST_ADDRESS" dev "$HOST_VETH"
ip link set "$HOST_VETH" up
ip netns exec "$NS" ip addr replace "$NS_ADDRESS" dev "$NS_VETH"
ip netns exec "$NS" ip link set "$NS_VETH" up
ip netns exec "$NS" ip route replace 10.200.1.1/32 dev "$NS_VETH"

# The proxy has no credentials: constrain its SOCKS port to the private veth peer.
if ! ip netns exec "$NS" nft list table inet aphrody_mullvad >/dev/null 2>&1; then
  ip netns exec "$NS" nft add table inet aphrody_mullvad
fi
ip netns exec "$NS" nft flush table inet aphrody_mullvad
ip netns exec "$NS" nft add chain inet aphrody_mullvad input '{ type filter hook input priority -5; policy accept; }'
ip netns exec "$NS" nft add rule inet aphrody_mullvad input iifname "$NS_VETH" tcp dport 1080 ip saddr != 10.200.1.1 counter drop

echo "Mullvad namespace ready: $HOSTNAME ($LOCATION); host default route unchanged."

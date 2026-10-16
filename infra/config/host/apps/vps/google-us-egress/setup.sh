#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
NS=aphrody-google-us
DEV=wg-google-us
HOST_VETH=google-us0
NS_VETH=google-us1
KEY=/etc/wireguard/mullvad.key
[[ $EUID == 0 && -f $KEY && ! -L $KEY && -s $KEY ]] || { echo 'Existing protected VPN credential unavailable' >&2; exit 1; }
[[ $(stat -c %u "$KEY") == 0 && $(stat -c %a "$KEY") == 600 ]] || { echo 'VPN credential ownership or permissions mismatch' >&2; exit 1; }
WG_ADDRESS=${APHRODY_MULLVAD_ADDRESS:?Existing Mullvad device address metadata required}
[[ $WG_ADDRESS =~ ^10\.[0-9]+\.[0-9]+\.[0-9]+/32$ ]] || { echo 'Invalid VPN device address metadata' >&2; exit 1; }
relay_json=$(curl --fail --silent --show-error --max-time 15 https://api.mullvad.net/www/relays/all/)
relay=$(jq -er '[.[] | select(.active == true and .type == "wireguard" and .country_code == "us")] | sort_by(.hostname) | first | [.hostname,.ipv4_addr_in,.pubkey] | @tsv' <<< "$relay_json")
IFS=$'\t' read -r hostname endpoint pubkey <<< "$relay"
[[ $hostname == us-* && $endpoint =~ ^[0-9.]+$ && $pubkey =~ ^[A-Za-z0-9+/]{43}=$ ]] || { echo 'Invalid active US relay metadata' >&2; exit 1; }
mkdir -p /etc/netns/"$NS"
printf 'nameserver 10.64.0.1\n' > /etc/netns/"$NS"/resolv.conf
if ! ip netns list | awk '{print $1}' | grep -qx "$NS"; then
  ! ip link show dev "$DEV" >/dev/null 2>&1 || { echo 'Refusing pre-existing host VPN interface' >&2; exit 1; }
  ip link add dev "$DEV" type wireguard
  wg set "$DEV" private-key "$KEY" peer "$pubkey" endpoint "$endpoint:51820" allowed-ips 0.0.0.0/0 persistent-keepalive 25
  ip netns add "$NS"
  ip link set dev "$DEV" netns "$NS"
fi
old_peer=$(ip netns exec "$NS" wg show "$DEV" peers)
if [[ -n $old_peer && $old_peer != "$pubkey" ]]; then
  ip netns exec "$NS" wg set "$DEV" peer "$old_peer" remove
fi
ip netns exec "$NS" wg set "$DEV" private-key "$KEY" peer "$pubkey" endpoint "$endpoint:51820" allowed-ips 0.0.0.0/0 persistent-keepalive 25
ip netns exec "$NS" ip link set lo up
ip netns exec "$NS" ip addr replace "$WG_ADDRESS" dev "$DEV"
ip netns exec "$NS" ip link set "$DEV" up
ip netns exec "$NS" ip route replace default dev "$DEV"
if ! ip netns exec "$NS" ip link show dev "$NS_VETH" >/dev/null 2>&1; then
  ! ip link show dev "$HOST_VETH" >/dev/null 2>&1 || { echo 'Refusing pre-existing host proxy interface' >&2; exit 1; }
  ip link add "$HOST_VETH" type veth peer name "$NS_VETH"
  ip link set "$NS_VETH" netns "$NS"
fi
ip addr replace 10.200.2.1/30 dev "$HOST_VETH"
ip link set "$HOST_VETH" up
ip netns exec "$NS" ip addr replace 10.200.2.2/30 dev "$NS_VETH"
ip netns exec "$NS" ip link set "$NS_VETH" up
ip netns exec "$NS" ip route replace 10.200.2.1/32 dev "$NS_VETH"
ip netns exec "$NS" nft list table inet aphrody_google_us >/dev/null 2>&1 || ip netns exec "$NS" nft add table inet aphrody_google_us
ip netns exec "$NS" nft flush table inet aphrody_google_us
ip netns exec "$NS" nft add chain inet aphrody_google_us input '{ type filter hook input priority -5; policy accept; }'
ip netns exec "$NS" nft add rule inet aphrody_google_us input tcp dport 1081 iifname != "$NS_VETH" counter drop
ip netns exec "$NS" nft add rule inet aphrody_google_us input iifname "$NS_VETH" tcp dport 1081 ip saddr != 10.200.2.1 counter drop
printf 'Google US namespace prepared with active relay %s; host default route unchanged\n' "$hostname"

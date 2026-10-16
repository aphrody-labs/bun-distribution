#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Select an active Japan relay. API failure may use only a validated Japan cache; never US.
set -euo pipefail
target="${1:-jp}"
[[ "$target" == jp ]] || { echo 'only Japan relays are permitted by this scoped proxy' >&2; exit 2; }
env_file=/etc/wireguard/mullvad-relay.env
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

relay_json=$(curl --fail --silent --show-error --max-time 12 https://api.mullvad.net/www/relays/all/ 2>/dev/null || true)
if [[ -n "$relay_json" ]]; then
  relay=$(jq -er '[.[] | select(.active == true and .type == "wireguard" and .country_code == "jp" and (.hostname | startswith("jp-tyo-")))] | sort_by(.hostname) | first | [.hostname,.ipv4_addr_in,.pubkey,.city_name] | @tsv' <<<"$relay_json" 2>/dev/null || true)
  IFS=$'\t' read -r hostname ip pubkey city <<<"$relay"
  if [[ -z ${hostname:-} || $hostname != jp-tyo-* || ! ${ip:-} =~ ^[0-9.]+$ || ! ${pubkey:-} =~ ^[A-Za-z0-9+/]{43}=$ || -z ${city:-} ]]; then
    echo 'Mullvad API did not provide valid active Tokyo relay metadata.' >&2
    exit 1
  fi
  printf 'COUNTRY_CODE="jp"\nHOSTNAME="%s"\nENDPOINT="%s:51820"\nPEER_PUBKEY="%s"\nLOCATION="Japan, %s"\n' "$hostname" "$ip" "$pubkey" "$city" > "$tmp"
  echo "Selected active Tokyo relay: $hostname."
else
  [[ -r "$env_file" ]] || { echo 'Mullvad API unavailable and no Japan relay cache exists; refusing fallback.' >&2; exit 1; }
  grep -qx 'COUNTRY_CODE="jp"' "$env_file" || { echo 'cached relay is not marked Japan; refusing fallback.' >&2; exit 1; }
  grep -Eq '^HOSTNAME="jp-tyo-[^"]+"$' "$env_file" || { echo 'invalid cached Tokyo hostname.' >&2; exit 1; }
  grep -Eq '^ENDPOINT="[0-9.]+:51820"$' "$env_file" || { echo 'invalid cached Tokyo endpoint.' >&2; exit 1; }
  grep -Eq '^PEER_PUBKEY="[A-Za-z0-9+/]{43}="$' "$env_file" || { echo 'invalid cached Tokyo public key.' >&2; exit 1; }
  cp "$env_file" "$tmp"
  echo 'Mullvad API unavailable; using validated cached Japan relay.' >&2
fi

install -o root -g root -m 0644 "$tmp" "$env_file.new"
mv -f "$env_file.new" "$env_file"
if ip netns list | awk '{print $1}' | grep -qx mullvad; then
  # Keep the current private key and namespace; replace only public peer metadata.
  # shellcheck disable=SC1090
  source "$env_file"
  ip netns exec mullvad wg set wg-mullvad peer "$PEER_PUBKEY" endpoint "$ENDPOINT" allowed-ips 0.0.0.0/0 persistent-keepalive 25
fi

#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
stage=${1:?Source stage required}
[[ $EUID == 0 && $stage == /var/tmp/aphrody-google-us-* && -d $stage && ! -L $stage ]] || exit 2
units=(aphrody-google-us-netns.service aphrody-google-us-socks.service aphrody-google-us-loopback.socket aphrody-google-us-loopback.service)
helper=/usr/local/libexec/aphrody-google-us-netns-setup
[[ ! -e $helper && ! -L $helper ]] || { echo 'Existing US helper preserved' >&2; exit 1; }
for unit in "${units[@]}"; do
  [[ ! -e /etc/systemd/system/$unit && ! -L /etc/systemd/system/$unit ]] || { echo 'Existing US unit preserved' >&2; exit 1; }
done
! ip netns list | awk '{print $1}' | grep -qx aphrody-google-us || exit 1
for interface in wg-google-us google-us0; do
  ! ip link show dev "$interface" >/dev/null 2>&1 || exit 1
done
! ss -lnt | grep -q ':1081 ' || exit 1
[[ -z $(ip -4 route show 10.200.2.0/30) ]] || exit 1
[[ $(ip -n mullvad -4 -o addr show dev wg-mullvad | awk '{print $4}') == 10.72.22.214/32 ]] || exit 1
bash -n "$stage/setup.sh"
before_route=$(ip -4 route show default)
before_japan=$(sha256sum /etc/wireguard/mullvad-relay.env | cut -d' ' -f1)
created=()
complete=false
rollback() {
  [[ $complete == true ]] && return
  systemctl stop aphrody-google-us-loopback.socket aphrody-google-us-loopback.service aphrody-google-us-socks.service aphrody-google-us-netns.service 2>/dev/null || true
  ip netns delete aphrody-google-us 2>/dev/null || true
  ip link delete google-us0 2>/dev/null || true
  ip link delete wg-google-us 2>/dev/null || true
  for path in "${created[@]}"; do rm -- "$path"; done
  systemctl daemon-reload
}
trap rollback EXIT
umask 022
set -o noclobber
cat "$stage/setup.sh" > "$helper"
created+=("$helper")
chmod 0755 "$helper"
for unit in "${units[@]}"; do
  path=/etc/systemd/system/$unit
  cat "$stage/$unit" > "$path"
  created+=("$path")
done
systemd-analyze verify "${units[@]/#//etc/systemd/system/}"
systemctl daemon-reload
systemctl start aphrody-google-us-netns.service aphrody-google-us-socks.service aphrody-google-us-loopback.socket
[[ $(ip -4 route show default) == "$before_route" ]] || { echo 'Host route mismatch' >&2; exit 1; }
[[ $(sha256sum /etc/wireguard/mullvad-relay.env | cut -d' ' -f1) == "$before_japan" ]] || { echo 'Japan relay metadata mismatch' >&2; exit 1; }
us=$(curl --fail --silent --show-error --max-time 25 --proxy socks5h://127.0.0.1:1081 https://am.i.mullvad.net/json)
jq -e '.country == "USA" and .mullvad_exit_ip == true' <<< "$us" >/dev/null
printf 'US egress: '
jq -c '{country,mullvad_exit_ip,mullvad_exit_ip_hostname}' <<< "$us"
curl --fail --silent --show-error --max-time 25 --proxy socks5h://127.0.0.1:1081 -o /dev/null -w 'Google HTTPS status=%{http_code} TLSverify=%{ssl_verify_result}\n' https://www.google.com/generate_204
japan=$(curl --fail --silent --show-error --max-time 25 --proxy socks5h://127.0.0.1:1080 https://am.i.mullvad.net/json)
jq -e '.country == "Japan" and .mullvad_exit_ip == true' <<< "$japan" >/dev/null
printf 'Japan preserved: '
jq -c '{country,mullvad_exit_ip,mullvad_exit_ip_hostname}' <<< "$japan"
systemctl enable aphrody-google-us-netns.service aphrody-google-us-socks.service aphrody-google-us-loopback.socket
complete=true
printf 'Independent US egress qualified; host route/Japan metadata unchanged\n'

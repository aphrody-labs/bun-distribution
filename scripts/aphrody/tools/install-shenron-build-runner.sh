#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
# Infra installer. Registration is separate from service activation.
if [[ ${EUID} != 0 || $# != 2 ]]; then
  echo 'Usage: sudo install-shenron-build-runner.sh <registration-token-file> <unit-source>' >&2
  exit 2
fi
token_file=$1
unit_source=$2
runner_home=/home/ubuntu
runner_user=ubuntu
runner_group=aphrody
runner_dir=$runner_home/build/runners/shenron
version=2.338.0
sha256=af4b794c1bc41d73d40535e3fe092a39f9679cd8d965954c2aca25a05ca41d32
[[ -f $token_file && ! -L $token_file && $(stat -c %a "$token_file") == 600 ]] || {
  echo 'Registration token requires a regular private 0600 file' >&2; exit 2;
}
[[ -f $unit_source && ! -L $unit_source ]] || exit 2
trap 'rm -f -- "$token_file"' EXIT
id "$runner_user" >/dev/null
getent group "$runner_group" >/dev/null
# Group membership belongs to the canonical Infra layout; refuse an unqualified host.
id -nG "$runner_user" | tr " " "\n" | grep -qx docker
install -d -o "$runner_user" -g "$runner_group" -m 700 "$runner_home/build/runners" "$runner_dir"
if [[ -f $runner_dir/.runner ]]; then
  echo 'Runner already registered; refusing replacement' >&2; exit 2
fi
archive=$(mktemp /var/tmp/shenron-runner.XXXXXX.tar.gz)
trap 'rm -f -- "$token_file" "$archive"' EXIT
curl --fail --silent --show-error --location \
  "https://github.com/actions/runner/releases/download/v${version}/actions-runner-linux-x64-${version}.tar.gz" \
  --output "$archive"
printf '%s  %s\n' "$sha256" "$archive" | sha256sum --check --status
tar -xzf "$archive" -C "$runner_dir"
chown -R "$runner_user:$runner_group" "$runner_dir"
chmod 700 "$runner_dir"
# Never enable shell tracing: GitHub registration token is a short-lived secret.
registration_token=$(<"$token_file")
[[ $registration_token =~ ^[A-Za-z0-9_]+$ ]] || exit 2
cd "$runner_dir"
sudo -u "$runner_user" env HOME="$runner_home" "$runner_dir/config.sh" \
  --unattended --url https://github.com/aphrody-labs/shenron \
  --token "$registration_token" --name aphrody-vps-shenron \
  --labels shenron-factory,vps --work _work --disableupdate
unset registration_token
install -o root -g root -m 644 "$unit_source" \
  /etc/systemd/system/aphrody-shenron-build-runner.service
systemctl daemon-reload
echo 'Runner registered; unit installed but not started or enabled'

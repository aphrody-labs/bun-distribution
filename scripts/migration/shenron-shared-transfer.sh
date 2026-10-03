#!/usr/bin/env bash
# Infra-owned server-to-server migration; run via native Infra SSH on VPS.
set -Eeuo pipefail
usage='usage: shenron-shared-transfer.sh prepass|final [--apply]'
[[ $# -ge 1 && $# -le 2 ]] || { echo "$usage" >&2; exit 2; }
phase="$1"
[[ "$phase" = prepass || "$phase" = final ]] || { echo "$usage" >&2; exit 2; }
apply=false
if [[ $# = 2 ]]; then [[ "$2" = --apply ]] || { echo "$usage" >&2; exit 2; }; apply=true; fi
source_root=/srv/shenron/shared
destination=/srv/shenron/shared
peer=dbfr
[[ -d "$source_root/site" && -d "$source_root/bot" && -d "$source_root/coord" ]] || {
  echo 'source Shenron shared layout missing' >&2; exit 2;
}
ssh_options=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes)
ssh "${ssh_options[@]}" "$peer" "test -d '$destination' && test -w '$destination'" || {
  echo 'DBFR destination must be provisioned by Infra before transfer' >&2; exit 2;
}
if [[ "$phase" = final ]]; then
  for unit in shenron-site.service shenron-bot.service shenron-backup.service; do
    if systemctl is-active --quiet "$unit"; then
      echo "final transfer requires quiesced source: $unit" >&2; exit 2;
    fi
  done
  if systemctl is-active --quiet shenron-backup.timer; then
    echo 'final transfer requires paused source backup timer' >&2; exit 2;
  fi
fi
bandwidth="${SHENRON_TRANSFER_KIB_PER_SEC:-51200}"
[[ "$bandwidth" =~ ^[1-9][0-9]{0,6}$ ]] || { echo 'invalid transfer bandwidth in KiB/s' >&2; exit 2; }
partial_root=/srv/aphrody-infra/migrations/shenron-transfer-partial
if $apply; then
  ssh "${ssh_options[@]}" "$peer" "test -d '$partial_root' && test -w '$partial_root'" || {
    echo 'Infra must provision the DBFR migration partial directory outside shared stores' >&2; exit 2;
  }
fi
args=(-a --relative --partial --partial-dir="$partial_root" --bwlimit="$bandwidth" --info=stats2 --human-readable
  --rsh='ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes')
[[ "$phase" != final ]] || args+=(--checksum)
$apply || args+=(--dry-run)
# No --delete: preserve data and existing stores on both hosts.
# Transfer ONLY measured runtime stores, never historical backups/deploy backups.
rsync "${args[@]}" "$source_root/./site" "$source_root/./bot" "$source_root/./coord" "$peer:$destination/"
if [[ "$phase" = final ]] && $apply; then
  evidence="$HOME/.local/share/aphrody/infra/migrations/shenron-$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -m 0700 "$evidence"
  manifest="$evidence/SHARED-SHA256SUMS"
  (cd "$source_root" && find site bot coord -type f ! -path '*/.rsync-partial/*' -print0 |
    LC_ALL=C sort -z | xargs -0 -r sha256sum) > "$manifest"
  chmod 0600 "$manifest"
  remote_manifest="/home/ubuntu/.local/share/aphrody/infra/migrations/$(basename "$evidence")"
  ssh "${ssh_options[@]}" "$peer" "install -d -m 0700 '$remote_manifest'"
  ssh "${ssh_options[@]}" "$peer" "umask 077; cat > '$remote_manifest/SHARED-SHA256SUMS'" < "$manifest"
  ssh "${ssh_options[@]}" "$peer" "cd '$destination' && sha256sum --quiet --check '$remote_manifest/SHARED-SHA256SUMS'"
  printf 'verified source file checksums on DBFR; evidence=%s\n' "$evidence"
fi

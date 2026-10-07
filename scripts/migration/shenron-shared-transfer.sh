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
  for unit in shenron-site.service shenron-bot.service shenron-site-docker.service shenron-bot-docker.service shenron-backup.service; do
    if systemctl is-active --quiet "$unit"; then
      echo "final transfer requires quiesced source: $unit" >&2; exit 2;
    fi
  done
  if systemctl is-active --quiet shenron-backup.timer; then
    echo 'final transfer requires paused source backup timer' >&2; exit 2;
  fi
  ssh "${ssh_options[@]}" "$peer" 'for unit in shenron-site.service shenron-bot.service shenron-site-docker.service shenron-bot-docker.service; do if systemctl is-active --quiet "$unit"; then printf "DBFR writer must be inactive: %s\n" "$unit" >&2; exit 2; fi; done'
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
# Keep only runtime state. These paths are regenerated or retained on the source
# as rollback/history; never copy them into the production target.
excluded_dirs=(.cache bun-cache runtime-cache image-cache next-cache backups .rsync-partial)
for name in "${excluded_dirs[@]}"; do args+=("--exclude=**/$name/***"); done
[[ "$phase" != final ]] || args+=(--checksum)
$apply || args+=(--dry-run)
# No --delete: preserve data and existing stores on both hosts.
# Transfer ONLY measured runtime stores, never historical backups/deploy backups.
rsync "${args[@]}" "$source_root/./site" "$source_root/./bot" "$source_root/./coord" "$peer:$destination/"
if [[ "$phase" = final ]] && $apply; then
  # A checkpoint can remove source WAL/SHM after prepass. Preserve stale
  # destination sidecars in quarantine instead of replaying them against the
  # new main DB; neither host may have a runtime writer during this step.
  quarantine_code="$(cat <<'PYQUARANTINE'
import datetime,hashlib,json,pathlib,shutil,stat,sys
root=pathlib.Path('/srv/shenron/shared')
payload=json.load(sys.stdin)
base=pathlib.Path('/srv/aphrody-infra/migrations/shenron-transfer-partial')
quarantine=base/('sqlite-sidecars-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
records=[]
for relative in payload['main']:
 p=pathlib.PurePosixPath(relative)
 if p.is_absolute() or '..' in p.parts or p.parts[0] not in ('site','bot','coord') or not relative.endswith('.db'):
  raise SystemExit('invalid SQLite inventory path')
 main=root/p
 if main.is_symlink() or not main.is_file() or not main.resolve().is_relative_to(root.resolve()):
  raise SystemExit('SQLite main target must be a contained regular file')
 for suffix in ('-wal','-shm'):
  rel=relative+suffix; target=root/rel
  if target.is_symlink(): raise SystemExit('SQLite sidecar symlink refused')
  if rel in payload['sidecars'] or not target.exists(): continue
  if target.is_symlink() or not stat.S_ISREG(target.lstat().st_mode) or not target.resolve().is_relative_to(root.resolve()):
   raise SystemExit('SQLite sidecar must be a contained regular file')
  quarantine.mkdir(mode=0o700,parents=True,exist_ok=True)
  dest=quarantine/rel;dest.parent.mkdir(parents=True,exist_ok=True)
  metadata=target.stat()
  with target.open('rb') as stream: digest=hashlib.file_digest(stream,'sha256').hexdigest()
  shutil.move(str(target),str(dest))
  records.append({'path':rel,'sha256':digest,'size':metadata.st_size,'mode':stat.S_IMODE(metadata.st_mode),'uid':metadata.st_uid,'gid':metadata.st_gid,'mtimeNs':metadata.st_mtime_ns})
if records:
 manifest=quarantine/'QUARANTINE.json';manifest.write_text(json.dumps({'schemaVersion':1,'files':records},indent=2)+'\n');manifest.chmod(0o600)
print('SQLite stale sidecar quarantine completed; protected files retained')
PYQUARANTINE
)"
  encoded_quarantine="$(printf '%s' "$quarantine_code" | base64 -w0)"
  python3 - "$source_root" <<'PYINVENTORY' | ssh "${ssh_options[@]}" "$peer" "python3 -c \"import base64;exec(base64.b64decode('$encoded_quarantine'))\""
import json,pathlib,sys
root=pathlib.Path(sys.argv[1]);mains=[];sidecars=[]
excluded={'.cache','bun-cache','runtime-cache','image-cache','next-cache','backups','.rsync-partial'}
for store in ('site','bot','coord'):
 for path in (root/store).rglob('*.db'):
  if excluded.intersection(path.relative_to(root).parts[:-1]): continue
  if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
   raise SystemExit('source SQLite main must be a contained regular file')
  relative=path.relative_to(root).as_posix();mains.append(relative)
  for suffix in ('-wal','-shm'):
   sidecar=root/(relative+suffix)
   if sidecar.is_symlink(): raise SystemExit('source SQLite sidecar symlink refused')
   if sidecar.exists():
    if not sidecar.is_file() or not sidecar.resolve().is_relative_to(root.resolve()): raise SystemExit('source SQLite sidecar must be regular/contained')
    sidecars.append(relative+suffix)
json.dump({'main':mains,'sidecars':sidecars},sys.stdout)
PYINVENTORY
  evidence="$HOME/.local/share/aphrody/infra/migrations/shenron-$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -m 0700 "$evidence"
  manifest="$evidence/SHARED-SHA256SUMS"
  (cd "$source_root" && find site bot coord -type d \( -name .cache -o -name bun-cache -o -name runtime-cache -o -name image-cache -o -name next-cache -o -name backups -o -name .rsync-partial \) -prune -o -type f -print0 |
    LC_ALL=C sort -z | xargs -0 -r sha256sum) > "$manifest"
  chmod 0600 "$manifest"
  remote_manifest="/home/ubuntu/.local/share/aphrody/infra/migrations/$(basename "$evidence")"
  ssh "${ssh_options[@]}" "$peer" "install -d -m 0700 '$remote_manifest'"
  ssh "${ssh_options[@]}" "$peer" "umask 077; cat > '$remote_manifest/SHARED-SHA256SUMS'" < "$manifest"
  ssh "${ssh_options[@]}" "$peer" "cd '$destination' && sha256sum --quiet --check '$remote_manifest/SHARED-SHA256SUMS'"
  printf 'verified source file checksums on DBFR; evidence=%s\n' "$evidence"
fi

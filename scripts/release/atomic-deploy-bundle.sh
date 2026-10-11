#!/usr/bin/env bash
set -Eeuo pipefail

# Activate one all-in-one bundle (build-aphrody-stack-release.sh) on the VPS:
# Aphrody stack, then Shenron, then RG, each through its own atomic adapter.
#
#   atomic-deploy-bundle.sh /home/ubuntu/apps/infra/bundles/ID
#   atomic-deploy-bundle.sh --rollback
#
# Every component is verified before the first mutation: bundle checksums, the
# installed adapters' infra commit (ADAPTER.json) against the bundle pin, the
# Aphrody release copied below /home/ubuntu/apps/aphrody/releases, the Shenron release
# assembled below /home/ubuntu/apps/shenron/releases and the RG release already assembled
# on the host (scripts/rg/assemble-vps-release.sh RG_SHA). The `current` targets
# before the run are recorded in BUNDLE.previous.json. When a step fails its
# adapter restores that stack; this script then restores the steps that had
# already succeeded, newest first, from their activation backups. A stack whose
# `current` already is the pinned release is left untouched.
# `--rollback` undoes the last successful bundle the same way.
usage='usage: atomic-deploy-bundle.sh /home/ubuntu/apps/infra/bundles/ID | --rollback'
[[ $# -eq 1 ]] || { echo "$usage" >&2; exit 2; }
state_root="${BUNDLE_STATE_ROOT:-/home/ubuntu/apps/infra}"
aphrody_root="${APHRODY_RELEASE_ROOT:-/home/ubuntu/apps/aphrody}"
shenron_root="${SHENRON_RELEASE_ROOT:-/home/ubuntu/apps/shenron}"
rg_root="${RG_RELEASE_ROOT:-/home/ubuntu/apps/rg}"
adapter_manifest="${BUNDLE_ADAPTER_MANIFEST:-/usr/local/share/aphrody-infra/ADAPTER.json}"
aphrody_adapter="${BUNDLE_APHRODY_ADAPTER:-/usr/local/sbin/aphrody-infra-deploy-aphrody}"
shenron_adapter="${BUNDLE_SHENRON_ADAPTER:-/usr/local/sbin/aphrody-infra-deploy-shenron}"
rg_adapter="${BUNDLE_RG_ADAPTER:-/usr/local/sbin/aphrody-infra-deploy-rg}"
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }
for command in python3 sha256sum cp; do command -v "$command" >/dev/null || { echo "missing $command" >&2; exit 2; }; done
active="$state_root/BUNDLE.json"
previous_file="$state_root/BUNDLE.previous.json"
pointer() { if [[ -L "$1/current" ]]; then readlink -f -- "$1/current"; fi; }
field() {
  python3 -c 'import json, sys
value = json.load(open(sys.argv[1]))
for key in sys.argv[2:]:
    value = value.get(key) if isinstance(value, dict) else None
print("" if value is None else value)' "$@"
}

# Undo completed steps, newest first. Arguments: state directory, then steps.
restore_steps() {
  local state="$1" step status=0
  shift
  for step in "$@"; do
    case "$step" in
      rg)
        local rg_previous
        rg_previous="$(field "$state/BUNDLE.previous.json" current rg)"
        if [[ -n "$rg_previous" ]]; then "$rg_adapter" "$rg_previous" || status=1
        else echo 'RG had no previous release; left on the bundle release' >&2; fi ;;
      shenron) "$shenron_adapter" restore "$state/backups/shenron" || status=1 ;;
      aphrody) "$aphrody_adapter" --restore "$state/backups/aphrody" || status=1 ;;
    esac
  done
  return "$status"
}

if [[ "$1" = --rollback ]]; then
  [[ -f "$active" && -f "$previous_file" ]] || { echo 'no activated bundle to roll back' >&2; exit 2; }
  id="$(field "$active" id)"
  [[ "$(field "$previous_file" bundle)" = "$id" ]] || { echo "BUNDLE.previous.json does not belong to bundle $id" >&2; exit 2; }
  state="$state_root/state/$id"
  mapfile -t done_steps < <(python3 -c 'import json,sys; print("\n".join(reversed(json.load(open(sys.argv[1]))["changed"])))' "$state/steps.json")
  restore_steps "$state" "${done_steps[@]}" || { echo "rollback of bundle $id incomplete; state=$state" >&2; exit 1; }
  mv -f -- "$active" "$state/BUNDLE.rolled-back.json"
  python3 - "$previous_file" "$active" <<'PY'
import json
import pathlib
import sys
previous = json.loads(pathlib.Path(sys.argv[1]).read_text()).get('previousBundle')
if previous:
    pathlib.Path(sys.argv[2]).write_text(json.dumps(previous, indent=2) + '\n')
PY
  rm -f -- "$previous_file"
  mv -T -- "$state" "$state.rolled-back-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  printf 'rolled back bundle %s\n' "$id"
  exit 0
fi

bundle="$(realpath -e -- "$1")"
[[ "$bundle" = "$(realpath -m -- "$state_root/bundles")/"* ]] || { echo "bundle must be under $state_root/bundles" >&2; exit 2; }
for file in BUNDLE.json RELEASE_SHA SHA256SUMS aphrody/SHA256SUMS aphrody/SMOKE.json shenron/release.json rg/release.json; do
  [[ -f "$bundle/$file" ]] || { echo "bundle lacks $file" >&2; exit 2; }
done
(cd "$bundle" && sha256sum --quiet --check SHA256SUMS) || { echo 'bundle checksum mismatch' >&2; exit 2; }
read -r id shenron_sha rg_sha < <(python3 - "$bundle" "$adapter_manifest" <<'PY'
import json
import pathlib
import re
import sys
bundle = pathlib.Path(sys.argv[1])
manifest = json.loads((bundle / 'BUNDLE.json').read_text())
if manifest.get('schemaVersion') != 1 or manifest.get('kind') != 'aphrody-vps-bundle' or manifest.get('id') != bundle.name:
    raise SystemExit('BUNDLE.json does not describe this bundle directory')
if manifest.get('order') != ['aphrody', 'shenron', 'rg']:
    raise SystemExit('unsupported bundle order')
repos = manifest['repositories']
for name, sha in repos.items():
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise SystemExit(f'invalid SHA for {name}')
components = manifest['components']
if components['shenron']['commit'] != repos['shenron'] or components['rg']['commit'] != repos['rg']:
    raise SystemExit('component pins differ from the repository SHAs')
if json.loads((bundle / 'rg' / 'release.json').read_text()).get('commit') != repos['rg']:
    raise SystemExit('rg/release.json differs from the RG pin')
installed = json.loads(pathlib.Path(sys.argv[2]).read_text())
if installed.get('infraCommit') != repos['aphrody-infra']:
    raise SystemExit(f"installed adapters come from aphrody-infra {installed.get('infraCommit')}, "
                     f"bundle pins {repos['aphrody-infra']}: run scripts/tools/install-vps-adapter.sh at the pinned commit")
print(manifest['id'], repos['shenron'], repos['rg'])
PY
) || exit 2
[[ -n "${rg_sha:-}" ]] || exit 2

# Preflight without touching `current`: stage the Aphrody release, assemble
# Shenron, require the RG release assembled on this host.
aphrody_release="$aphrody_root/releases/$id"
if [[ -e "$aphrody_release" ]]; then
  cmp -s -- "$bundle/aphrody/SHA256SUMS" "$aphrody_release/SHA256SUMS" &&
    (cd "$aphrody_release" && sha256sum --quiet --check SHA256SUMS) &&
    cmp -s -- "$bundle/aphrody/SMOKE.json" "$aphrody_release/SMOKE.json" || {
      echo "$aphrody_release exists with different content" >&2; exit 2;
    }
else
  install -d -m 0755 "$aphrody_root/releases"
  incoming="$aphrody_root/releases/.incoming-$id.$$"
  cp -a -- "$bundle/aphrody" "$incoming"
  (cd "$incoming" && sha256sum --quiet --check SHA256SUMS) || { rm -rf -- "$incoming"; echo 'Aphrody release copy is corrupt' >&2; exit 2; }
  mv -T -- "$incoming" "$aphrody_release"
fi
"$shenron_adapter" assemble "$bundle/shenron"
shenron_release="$shenron_root/releases/$shenron_sha"
rg_release="$rg_root/releases/$rg_sha"
[[ -f "$rg_release/release.json" && "$(field "$rg_release/release.json" commit)" = "$rg_sha" ]] || {
  echo "RG release $rg_release is not assembled; on this host run: scripts/rg/assemble-vps-release.sh $rg_sha" >&2; exit 2;
}

state="$state_root/state/$id"
[[ ! -e "$state" ]] || { echo "bundle $id was already run (state $state); use --rollback or a new bundle" >&2; exit 2; }
install -d -m 0700 "$state" "$state/backups"
python3 - "$state/BUNDLE.previous.json" "$id" "$active" "$(pointer "$aphrody_root")" "$(pointer "$shenron_root")" "$(pointer "$rg_root")" <<'PY'
import datetime
import json
import pathlib
import sys
target, bundle_id, active, aphrody, shenron, rg = sys.argv[1:7]
active_path = pathlib.Path(active)
record = {
    'schemaVersion': 1,
    'bundle': bundle_id,
    'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
    'previousBundle': json.loads(active_path.read_text()) if active_path.is_file() else None,
    'current': {'aphrody': aphrody or None, 'shenron': shenron or None, 'rg': rg or None},
}
pathlib.Path(target).write_text(json.dumps(record, indent=2) + '\n')
PY

changed=()
record_steps() {
  python3 - "$state/steps.json" "$@" <<'PY'
import json
import pathlib
import sys
pathlib.Path(sys.argv[1]).write_text(json.dumps({'changed': sys.argv[2:]}, indent=2) + '\n')
PY
}
record_steps
run_step() {
  local name="$1" release="$2" root="$3"
  shift 3
  if [[ "$(pointer "$root")" = "$(realpath -e -- "$release")" ]]; then
    printf '%s: %s already active, unchanged\n' "$name" "$release"
    return 0
  fi
  printf '%s: activating %s\n' "$name" "$release"
  if "$@"; then
    changed+=("$name")
    record_steps "${changed[@]}"
    return 0
  fi
  echo "$name activation failed (its adapter restored $name)" >&2
  local undo=() index
  for ((index = ${#changed[@]} - 1; index >= 0; index--)); do undo+=("${changed[$index]}"); done
  if ((${#undo[@]})) && ! restore_steps "$state" "${undo[@]}"; then
    echo "bundle $id rollback incomplete (${undo[*]}); inspect state=$state" >&2
    exit 1
  fi
  record_steps
  mv -T -- "$state" "$state.failed-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  echo "bundle $id not activated; restored: ${undo[*]:-nothing else changed}" >&2
  exit 1
}
run_step aphrody "$aphrody_release" "$aphrody_root" \
  env APHRODY_STACK_BACKUP_DIR="$state/backups/aphrody" "$aphrody_adapter" "$aphrody_release"
run_step shenron "$shenron_release" "$shenron_root" \
  env SHENRON_BACKUP_DIR="$state/backups/shenron" "$shenron_adapter" activate "$shenron_release"
run_step rg "$rg_release" "$rg_root" "$rg_adapter" "$rg_release"

python3 - "$bundle/BUNDLE.json" "$active" <<'PY'
import datetime
import json
import pathlib
import sys
manifest = json.loads(pathlib.Path(sys.argv[1]).read_text())
manifest['activatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
staged = pathlib.Path(sys.argv[2] + '.tmp')
staged.write_text(json.dumps(manifest, indent=2) + '\n')
staged.replace(sys.argv[2])
PY
cp -f -- "$state/BUNDLE.previous.json" "$previous_file"
printf 'activated bundle %s (changed: %s); previous state %s\n' "$id" "${changed[*]:-none}" "$previous_file"

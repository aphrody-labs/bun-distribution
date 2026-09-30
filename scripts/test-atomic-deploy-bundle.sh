#!/usr/bin/env bash
set -euo pipefail

# Stub test of atomic-deploy-bundle.sh: preflight, ordering, BUNDLE.previous.json,
# automatic rollback of completed steps and --rollback. The three stack
# adapters are replaced by recorders. Run as root on Linux or WSL.
script="$(cd "$(dirname "$0")" && pwd)/atomic-deploy-bundle.sh"
fixture="$(mktemp -d)"
on_exit() {
  local status=$?
  if [[ "$status" -ne 0 && -f "$fixture/out" ]]; then cat "$fixture/out" >&2; fi
  rm -rf -- "$fixture"
}
trap on_exit EXIT
mkdir -p "$fixture"/{bin,infra/bundles,aphrody,shenron/releases/old,rg/releases/oldrg}
export BUNDLE_STATE_ROOT="$fixture/infra" APHRODY_RELEASE_ROOT="$fixture/aphrody"
export SHENRON_RELEASE_ROOT="$fixture/shenron" RG_RELEASE_ROOT="$fixture/rg"
export BUNDLE_ADAPTER_MANIFEST="$fixture/ADAPTER.json" CALLS="$fixture/calls"
export BUNDLE_APHRODY_ADAPTER="$fixture/bin/aphrody" BUNDLE_SHENRON_ADAPTER="$fixture/bin/shenron"
export BUNDLE_RG_ADAPTER="$fixture/bin/rg"
ln -s "$fixture/shenron/releases/old" "$fixture/shenron/current"
ln -s "$fixture/rg/releases/oldrg" "$fixture/rg/current"

cat > "$fixture/bin/aphrody" <<'SH'
#!/usr/bin/env bash
echo "aphrody $*" >> "$CALLS"
if [[ "$1" = --restore ]]; then rm -f "$APHRODY_RELEASE_ROOT/current"; exit 0; fi
[[ "${FAIL_APHRODY:-0}" = 0 ]] || exit 1
mkdir -p "$APHRODY_STACK_BACKUP_DIR"
ln -sfn "$1" "$APHRODY_RELEASE_ROOT/current"
SH
cat > "$fixture/bin/shenron" <<'SH'
#!/usr/bin/env bash
echo "shenron $*" >> "$CALLS"
case "$1" in
  assemble) commit="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["commit"])' "$2/release.json")"
            mkdir -p "$SHENRON_RELEASE_ROOT/releases/$commit" ;;
  restore) ln -sfn "$SHENRON_RELEASE_ROOT/releases/old" "$SHENRON_RELEASE_ROOT/current" ;;
  activate) [[ "${FAIL_SHENRON:-0}" = 0 ]] || exit 1
            mkdir -p "$SHENRON_BACKUP_DIR"; ln -sfn "$2" "$SHENRON_RELEASE_ROOT/current" ;;
esac
SH
cat > "$fixture/bin/rg" <<'SH'
#!/usr/bin/env bash
echo "rg $*" >> "$CALLS"
[[ "${FAIL_RG:-0}" = 0 || "$1" = */oldrg ]] || exit 1
ln -sfn "$1" "$RG_RELEASE_ROOT/current"
SH
chmod +x "$fixture/bin/"*

infra=3333333333333333333333333333333333333333
shenron=1111111111111111111111111111111111111111
rg=2222222222222222222222222222222222222222
id=20260926T000000Z-44444444
bundle="$fixture/infra/bundles/$id"
mkdir -p "$bundle"/{aphrody/bin,shenron,rg} "$fixture/rg/releases/$rg"
printf 'binary\n' > "$bundle/aphrody/bin/aphrody"
(cd "$bundle/aphrody" && sha256sum bin/aphrody > SHA256SUMS)
printf '{"schema":"aphrody-stack-smoke/v1","status":"ok"}\n' > "$bundle/aphrody/SMOKE.json"
printf '{"schemaVersion":1,"repository":"shenron","commit":"%s"}\n' "$shenron" > "$bundle/shenron/release.json"
printf '{"schemaVersion":1,"repository":"rg","commit":"%s"}\n' "$rg" > "$bundle/rg/release.json"
cat > "$bundle/BUNDLE.json" <<JSON
{"schemaVersion":1,"kind":"aphrody-vps-bundle","id":"$id","order":["aphrody","shenron","rg"],
 "repositories":{"aphrody-src":"$infra","aphrody-infra":"$infra","shenron":"$shenron","rg":"$rg"},
 "components":{"aphrody":{"path":"aphrody"},"shenron":{"commit":"$shenron"},"rg":{"commit":"$rg"}}}
JSON
printf 'aphrody-infra=%s\n' "$infra" > "$bundle/RELEASE_SHA"
(cd "$bundle" && find . -type f ! -path ./SHA256SUMS -printf '%P\0' | sort -z | xargs -0 sha256sum > SHA256SUMS)
current() { if [[ -L "$fixture/$1/current" ]]; then readlink -f "$fixture/$1/current"; else echo none; fi; }

printf '{"infraCommit":"%s"}\n' 5555555555555555555555555555555555555555 > "$fixture/ADAPTER.json"
if bash "$script" "$bundle" >"$fixture/out" 2>&1; then echo 'accepted adapters from another infra commit' >&2; exit 1; fi
grep -q 'install-vps-adapter.sh' "$fixture/out"
[[ ! -e "$CALLS" ]]
printf '{"infraCommit":"%s"}\n' "$infra" > "$fixture/ADAPTER.json"

printf '{"commit":"%s"}\n' 0000000000000000000000000000000000000000 > "$fixture/rg/releases/$rg/release.json"
if bash "$script" "$bundle" >"$fixture/out" 2>&1; then echo 'accepted an unassembled RG release' >&2; exit 1; fi
grep -q "assemble-vps-release.sh $rg" "$fixture/out"
if grep -Eq 'activate|^rg |^aphrody ' "$CALLS"; then echo 'activated before preflight passed' >&2; exit 1; fi
printf '{"commit":"%s"}\n' "$rg" > "$fixture/rg/releases/$rg/release.json"

: > "$CALLS"
if FAIL_SHENRON=1 bash "$script" "$bundle" >"$fixture/out" 2>&1; then echo 'accepted failed Shenron step' >&2; exit 1; fi
grep -q "^aphrody --restore $fixture/infra/state/$id/backups/aphrody" "$CALLS"
if grep -q '^rg ' "$CALLS"; then echo 'RG ran after a failed Shenron step' >&2; exit 1; fi
[[ "$(current aphrody)" = none && "$(current shenron)" = "$fixture/shenron/releases/old" ]]
[[ ! -e "$fixture/infra/BUNDLE.json" && ! -e "$fixture/infra/state/$id" ]]

: > "$CALLS"
if FAIL_RG=1 bash "$script" "$bundle" >"$fixture/out" 2>&1; then echo 'accepted failed RG step' >&2; exit 1; fi
[[ "$(grep -v assemble "$CALLS" | cut -d' ' -f1,2 | tr '\n' '|')" = "aphrody $fixture/aphrody/releases/$id|shenron activate|rg $fixture/rg/releases/$rg|shenron restore|aphrody --restore|" ]]
[[ "$(current shenron)" = "$fixture/shenron/releases/old" && "$(current rg)" = "$fixture/rg/releases/oldrg" ]]

: > "$CALLS"
bash "$script" "$bundle" >"$fixture/out" 2>&1
[[ "$(current aphrody)" = "$fixture/aphrody/releases/$id" && "$(current shenron)" = "$fixture/shenron/releases/$shenron" ]]
[[ "$(current rg)" = "$fixture/rg/releases/$rg" ]]
python3 - "$fixture/infra" "$id" "$fixture" <<'PY'
import json
import pathlib
import sys
root, bundle_id, fixture = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
active = json.loads((root / 'BUNDLE.json').read_text())
previous = json.loads((root / 'BUNDLE.previous.json').read_text())
assert active['id'] == bundle_id and 'activatedAt' in active
assert previous['bundle'] == bundle_id and previous['previousBundle'] is None
assert previous['current'] == {'aphrody': None, 'shenron': f'{fixture}/shenron/releases/old', 'rg': f'{fixture}/rg/releases/oldrg'}
PY
if bash "$script" "$bundle" >"$fixture/out" 2>&1; then echo 'accepted a second run of the same bundle' >&2; exit 1; fi

: > "$CALLS"
bash "$script" --rollback >"$fixture/out" 2>&1
[[ "$(cut -d' ' -f1,2 "$CALLS" | tr '\n' '|')" = "rg $fixture/rg/releases/oldrg|shenron restore|aphrody --restore|" ]]
[[ "$(current rg)" = "$fixture/rg/releases/oldrg" && "$(current shenron)" = "$fixture/shenron/releases/old" && "$(current aphrody)" = none ]]
[[ ! -e "$fixture/infra/BUNDLE.json" && ! -e "$fixture/infra/BUNDLE.previous.json" ]]
echo 'Bundle adapter preflight, ordering, automatic rollback and --rollback: ok'

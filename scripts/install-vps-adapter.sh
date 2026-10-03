#!/usr/bin/env bash
set -euo pipefail

# Install the VPS deploy adapters and the catalog snapshots they read, from a
# clean aphrody-infra checkout on the host, as root:
#   aphrody-infra-deploy-aphrody  atomic-deploy-aphrody-stack.sh (five services)
#   aphrody-infra-deploy-shenron  atomic-deploy-shenron.sh
#   aphrody-infra-deploy-rg       atomic-deploy-rg.sh
#   aphrody-infra-deploy-bundle   atomic-deploy-bundle.sh (aphrody -> shenron -> rg)
# ADAPTER.json records the infra commit and every installed hash; the bundle
# adapter refuses a bundle pinned to another aphrody-infra commit. Reinstall
# after changing any adapter or config/{service-catalog,nginx-routes,secrets-contract}.json.
infra="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sbin="${APHRODY_ADAPTER_SBIN:-/usr/local/sbin}"
share="${APHRODY_ADAPTER_SHARE:-/usr/local/share/aphrody-infra}"
stack=all
package_out=''
source_manifest=''
expected_revision=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack) stack="${2:?missing stack}"; shift 2 ;;
    --package) package_out="${2:?missing package output}"; shift 2 ;;
    --source-manifest) source_manifest="${2:?missing source manifest}"; shift 2 ;;
    --revision) expected_revision="${2:?missing revision}"; shift 2 ;;
    *) echo 'usage: install-vps-adapter.sh [--stack all|shenron] [--package DIR | --source-manifest FILE --revision FULL_SHA]' >&2; exit 2 ;;
  esac
done
[[ "$stack" = all || "$stack" = shenron ]] || { echo 'invalid adapter stack' >&2; exit 2; }
if [[ -n "$source_manifest" ]]; then
  [[ -z "$package_out" && "$stack" = shenron && "$expected_revision" =~ ^[a-f0-9]{40}$ ]] || {
    echo 'sealed source installation requires --stack shenron --revision FULL_SHA' >&2; exit 2;
  }
  commit="$(python3 - "$source_manifest" "$infra" "$expected_revision" <<'PYVERIFY'
import hashlib, json, pathlib, sys
manifest_path, root, revision = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
m = json.loads(manifest_path.read_text())
expected = {'scripts/install-vps-adapter.sh', 'scripts/atomic-deploy-shenron.sh', 'config/service-catalog.json', 'config/nginx-routes.json', 'config/secrets-contract.json'}
if m.get('schemaVersion') != 1 or m.get('repository') != 'aphrody-labs/aphrody' or m.get('stack') != 'shenron' or m.get('sourceCommit') != revision or set(m.get('files', {})) != expected:
    raise SystemExit('sealed adapter source manifest differs from requested revision/files')
for relative, digest in m['files'].items():
    p = root / relative
    if p.is_symlink() or not p.is_file() or not p.resolve().is_relative_to(root.resolve()) or hashlib.sha256(p.read_bytes()).hexdigest() != digest:
        raise SystemExit('sealed adapter source checksum/path validation failed')
print(revision)
PYVERIFY
)" || exit 2
else
  git_infra() { git -c safe.directory="$infra" -C "$infra" "$@"; }
  commit="$(git_infra rev-parse --verify 'HEAD^{commit}')"
  git_infra diff --quiet HEAD -- scripts config &&
    [[ -z "$(git_infra ls-files --others --exclude-standard -- scripts config)" ]] || {
    echo 'aphrody-infra scripts/ or config/ has uncommitted changes' >&2; exit 2;
  }
fi
if [[ -n "$package_out" ]]; then
  [[ "$stack" = shenron ]] || { echo 'sealed source export currently supports --stack shenron' >&2; exit 2; }
  python3 - "$infra" "$package_out" "$commit" <<'PYPACKAGE'
import hashlib, json, pathlib, shutil, sys, tempfile
root, destination, revision = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]).absolute(), sys.argv[3]
if destination.exists(): raise SystemExit('adapter package destination already exists')
destination.parent.mkdir(parents=True, exist_ok=True)
stage = pathlib.Path(tempfile.mkdtemp(prefix='.adapter-package-', dir=destination.parent))
try:
    files = {}
    for relative in ['scripts/install-vps-adapter.sh', 'scripts/atomic-deploy-shenron.sh', 'config/service-catalog.json', 'config/nginx-routes.json', 'config/secrets-contract.json']:
        source = root / relative
        if source.is_symlink() or not source.is_file(): raise ValueError('adapter source must be regular files')
        target = stage / relative; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target); files[relative] = hashlib.sha256(target.read_bytes()).hexdigest()
    (stage / 'SOURCE-MANIFEST.json').write_text(json.dumps({'schemaVersion': 1, 'repository': 'aphrody-labs/aphrody', 'stack': 'shenron', 'sourceCommit': revision, 'files': files}, indent=2) + '\n')
    stage.rename(destination)
except BaseException:
    shutil.rmtree(stage); raise
print(f'sealed Shenron adapter source: {destination}; revision={revision}')
PYPACKAGE
  exit 0
fi
[[ "$(id -u)" = 0 ]] || { echo 'run installation as root' >&2; exit 2; }
install -d -m 0755 "$sbin" "$share"
declare -A adapters=(
  [aphrody-infra-deploy-aphrody]=atomic-deploy-aphrody-stack.sh
  [aphrody-infra-deploy-shenron]=atomic-deploy-shenron.sh
  [aphrody-infra-deploy-rg]=atomic-deploy-rg.sh
  [aphrody-infra-deploy-bundle]=atomic-deploy-bundle.sh
)
if [[ "$stack" = shenron ]]; then
  adapters=([aphrody-infra-deploy-shenron]=atomic-deploy-shenron.sh)
fi
for name in "${!adapters[@]}"; do install -m 0755 "$infra/scripts/${adapters[$name]}" "$sbin/$name"; done
for catalog in service-catalog nginx-routes secrets-contract; do
  install -m 0644 "$infra/config/$catalog.json" "$share/$catalog.json"
done
# The site-only adapter was replaced by the five-service one.
if [[ "$stack" = all ]]; then rm -f -- "$sbin/aphrody-infra-deploy"; fi
python3 - "$share/ADAPTER.json" "$commit" "$sbin" "$share" "${!adapters[@]}" <<'PY'
import datetime
import hashlib
import json
import pathlib
import sys
target, commit, sbin, share = sys.argv[1:5]
digest = lambda path: hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
manifest = {
    'schemaVersion': 1,
    'infraCommit': commit,
    'installedAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
    'adapters': {name: digest(f'{sbin}/{name}') for name in sorted(sys.argv[5:])},
    'catalogs': {name: digest(f'{share}/{name}.json') for name in ('service-catalog', 'nginx-routes', 'secrets-contract')},
}
pathlib.Path(target).write_text(json.dumps(manifest, indent=2) + '\n')
PY
printf 'installed %s deploy adapters from aphrody-infra %s\n' "$stack" "$commit"

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
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }
git_infra() { git -c safe.directory="$infra" -C "$infra" "$@"; }
commit="$(git_infra rev-parse --verify 'HEAD^{commit}')"
git_infra diff --quiet HEAD -- scripts config &&
  [[ -z "$(git_infra ls-files --others --exclude-standard -- scripts config)" ]] || {
  echo 'aphrody-infra scripts/ or config/ has uncommitted changes' >&2; exit 2;
}
install -d -m 0755 "$sbin" "$share"
declare -A adapters=(
  [aphrody-infra-deploy-aphrody]=atomic-deploy-aphrody-stack.sh
  [aphrody-infra-deploy-shenron]=atomic-deploy-shenron.sh
  [aphrody-infra-deploy-rg]=atomic-deploy-rg.sh
  [aphrody-infra-deploy-bundle]=atomic-deploy-bundle.sh
)
for name in "${!adapters[@]}"; do install -m 0755 "$infra/scripts/${adapters[$name]}" "$sbin/$name"; done
for catalog in service-catalog nginx-routes secrets-contract; do
  install -m 0644 "$infra/config/$catalog.json" "$share/$catalog.json"
done
# The site-only adapter was replaced by the five-service one.
rm -f -- "$sbin/aphrody-infra-deploy"
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
printf 'installed Aphrody, Shenron, RG and bundle deploy adapters from aphrody-infra %s\n' "$commit"

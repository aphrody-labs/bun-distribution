#!/usr/bin/env bash
set -Eeuo pipefail

# Build the all-in-one VPS bundle from one clean superproject checkout
# (aphrody-src, every submodule initialized at its gitlink; see
# prepare-release-workspace.sh). The bundle carries:
#   aphrody/  the five-service Aphrody stack release (aphrody-web + aphrody-ai
#             binaries, the aphrody-ui console embedded in `aphrody`, units,
#             apex vhost, ops scripts) and its local smoke attestation SMOKE.json;
#   shenron/  the Shenron source archive and sealed site artifact, assembled on
#             the VPS by atomic-deploy-shenron.sh;
#   rg/       the RG commit pin; RG stays assembled on the VPS by
#             scripts/rg/assemble-vps-release.sh.
# BUNDLE.json and RELEASE_SHA record the superproject and all submodule SHAs.
# Linux x86_64 on a native filesystem only (WSL Ubuntu-24.04 ext4); never
# contacts the VPS and never contains a secret.
#
# Environment: APHRODY_BUNDLE_OUT (default ~/aphrody-release/bundles),
# APHRODY_RELEASE_TARGET_DIR (Cargo target, default ~/aphrody-release/target),
# APHRODY_EMBED_MODEL_DIR (E5 files for the smoke, default
# ~/aphrody-release/e5-native, installed by the packaged aphrody-embed when
# missing), SITE_BUILD_DATABASE_URL (Shenron build-time database, read by
# `bun run site:artifact`), APHRODY_BUNDLE_SKIP_SMOKE=1 (produces a bundle the
# Aphrody adapter refuses: no SMOKE.json).
usage='usage: build-aphrody-stack-release.sh [SUPERPROJECT [SUPERPROJECT_SHA]]'
[[ $# -le 2 ]] || { echo "$usage" >&2; exit 2; }
infra_repo="$(realpath -e -- "$(dirname -- "${BASH_SOURCE[0]}")/..")"
super="$(realpath -e -- "${1:-$infra_repo/..}")"
super_sha="${2:-$(git -C "$super" rev-parse HEAD)}"
out_root="$(realpath -m -- "${APHRODY_BUNDLE_OUT:-$HOME/aphrody-release/bundles}")"
target_dir="$(realpath -m -- "${APHRODY_RELEASE_TARGET_DIR:-$HOME/aphrody-release/target}")"
e5_dir="$(realpath -m -- "${APHRODY_EMBED_MODEL_DIR:-$HOME/aphrody-release/e5-native}")"
triple=x86_64-unknown-linux-gnu
fail() { echo "$*" >&2; exit 2; }

[[ "$(uname -s)" = Linux && "$(uname -m)" = x86_64 ]] || fail 'Linux x86_64 build host required'
for command in git cargo bun python3 sha256sum tar rsync ldd; do
  command -v "$command" >/dev/null || fail "missing $command"
done
native_fs() {
  local path="$1"
  case "$path" in /mnt/*|"$HOME/src"|"$HOME/src/"*) return 1 ;; esac
  case "$(stat -f -c %T -- "$path")" in ext2/ext3|xfs|btrfs) return 0 ;; *) return 1 ;; esac
}
native_fs "$super" || fail "refusing $super: build from a superproject clone on the Linux filesystem, not /mnt/* or ~/src"
[[ "$infra_repo" = "$super/aphrody-infra" ]] || fail "run the aphrody-infra submodule of $super, not $infra_repo"
[[ -f "$super/.gitmodules" ]] || fail "$super is not the superproject (no .gitmodules)"
[[ "$super_sha" =~ ^[0-9a-f]{40}$ ]] || fail 'superproject SHA must be 40 hex digits'
[[ "$(git -C "$super" rev-parse HEAD)" = "$super_sha" ]] || fail 'superproject checkout does not match the pin'

# Every submodule must be initialized exactly at its gitlink and clean.
declare -A repo_sha=()
repos=()
while read -r _key path; do
  repos+=("$path")
done < <(git -C "$super" config -f .gitmodules --get-regexp '^submodule\..*\.path$')
require_clean() {
  [[ -z "$(git -C "$super" status --porcelain=v1 --untracked-files=all --ignore-submodules=none)" ]] ||
    fail 'superproject is dirty (uncommitted files or submodule pointers)'
  ! git -C "$super" submodule status | grep -q '^[-+U]' || fail 'a submodule is missing or differs from its gitlink'
  local path gitlink head
  for path in "${repos[@]}"; do
    [[ -e "$super/$path/.git" ]] || fail "submodule $path is not initialized"
    gitlink="$(git -C "$super" ls-tree HEAD -- "$path" | awk '{print $3}')"
    head="$(git -C "$super/$path" rev-parse HEAD)"
    [[ "$gitlink" = "$head" ]] || fail "submodule $path is at $head, gitlink $gitlink"
    [[ -z "$(git -C "$super/$path" status --porcelain --untracked-files=all)" ]] || fail "submodule $path is dirty"
    repo_sha[$path]="$head"
  done
}
require_clean
for path in aphrody-ai aphrody-web aphrody-ui aphrody-os aphrody-compat aphrody-contracts aphrody-shell aphrody-native aphrody-infra shenron rg; do
  [[ -n "${repo_sha[$path]:-}" ]] || fail "superproject lacks required submodule $path"
done

id="$(date -u +%Y%m%dT%H%M%SZ)-${super_sha:0:8}"
install -d -m 0755 "$out_root"
[[ ! -e "$out_root/$id" ]] || fail "bundle already exists: $out_root/$id"
stage=''
cleanup() { [[ -z "$stage" ]] || rm -rf -- "$stage"; }
trap cleanup EXIT
stage="$(mktemp -d "$out_root/.build.XXXXXXXX")"
chmod 0755 "$stage"
logs="$stage/.logs"
mkdir -p "$logs" "$stage/aphrody/"{bin,lib,systemd,nginx,ops} "$stage/shenron/"{systemd,nginx} "$stage/rg"
release_sha() {
  printf 'aphrody-src=%s\n' "$super_sha"
  local path
  for path in "${repos[@]}"; do printf '%s=%s\n' "$path" "${repo_sha[$path]}"; done
}

# Respect the operator's shared Cargo configuration (sccache and job limit).
export CARGO_TARGET_DIR="$target_dir"
out="$target_dir/$triple/release"
app="$stage/aphrody"

# aphrody-web: public origin, Web FFI and V8 renderer, integrated Web API.
(cd "$super/aphrody-web" && bun install --frozen-lockfile)
(cd "$super/aphrody-web" && cargo build --locked --release --target "$triple" \
  -p aphrody-site -p aphrody-web-ffi -p aphrody-web-render) 2>&1 | tee "$logs/aphrody-web.log"
install -m 0755 "$out/aphrody-site" "$app/bin/aphrody-site"
install -m 0755 "$out/libaphrody_web_ffi.so" "$app/lib/libaphrody_web_ffi.so"
install -m 0755 "$out/libaphrody_web_render.so" "$app/lib/libbxc_render.so"
(cd "$super/aphrody-web" && bun build --compile --target=bun-linux-x64-baseline \
  apps/bxc/src/server/index.ts --outfile "$app/bin/aphrody-web-api")
chmod 0755 "$app/bin/aphrody-web-api"

# The agent console is aphrody-ui's tracked ui-dist, embedded into `aphrody`
# by aphrody-app-server's build script; a placeholder page is a build failure.
for asset in index.html app.js app.css; do
  git -C "$super/aphrody-ui" ls-files --error-unmatch "crates/aphrody-app/ui-dist/$asset" >/dev/null ||
    fail "aphrody-ui ui-dist/$asset is not tracked"
done
(cd "$super/aphrody-ai" && cargo build --locked --release --target "$triple" \
  -p aphrody -p aphrody-mcp --features aphrody/rag,aphrody-mcp/ocr) 2>&1 | tee "$logs/aphrody-ai.log"
(cd "$super/aphrody-ai" && cargo build --locked --release --target "$triple" \
  -p aphrody-embed --features server) 2>&1 | tee -a "$logs/aphrody-ai.log"
! grep -Fq 'embedding a placeholder page' "$logs/aphrody-ai.log" || fail 'aphrody-app-server embedded the placeholder console'
install -m 0755 "$out/aphrody" "$app/bin/aphrody"
install -m 0755 "$out/aphrody-mcp" "$app/bin/aphrody-mcp"
install -m 0755 "$out/aphrody-embed" "$app/bin/aphrody-embed"
for binary in aphrody aphrody-mcp; do
  ! grep -aFq 'this binary was built without the web console' "$app/bin/$binary" ||
    fail "bin/$binary carries the placeholder console"
done
install -m 0644 "$super/aphrody-ai/ai.json" "$app/ai.json"
ln -s /srv/aphrody/shared/coord "$app/.coord"
for file in "$app"/bin/* "$app"/lib/*; do
  if ldd "$file" 2>&1 | grep -q 'not found'; then fail "unresolved shared library in $file"; fi
done

for unit in aphrody-site-immutable aphrody-web-api aphrody-a2a aphrody-ai-http aphrody-shenron-embed; do
  install -m 0644 "$infra_repo/systemd/$unit.service.example" "$app/systemd/${unit/-immutable/}.service"
done
install -m 0644 "$infra_repo/nginx/aphrody/aphrody-apex.conf" "$app/nginx/aphrody-apex.conf"
for script in atomic-deploy-aphrody-stack.sh ops/provision-aphrody-stack-env.sh ops/prepare-aphrody-data-contract.sh \
  ops/copy-aphrody-web-tables.sh ops/aphrody-rag-web-ingest.sh ops/provision-shenron-ai-access.sh; do
  install -m 0755 "$infra_repo/scripts/$script" "$app/ops/$(basename "$script")"
done
release_sha > "$app/RELEASE_SHA"
printf '%s\n' "$id" > "$app/RELEASE_ID"
(cd "$app" && { find bin lib systemd nginx ops -type f -print0 | sort -z | xargs -0 sha256sum; sha256sum ai.json RELEASE_SHA RELEASE_ID; } > SHA256SUMS)
(cd "$app" && sha256sum --quiet --check SHA256SUMS)

# Packaged five-service smoke; SMOKE.json binds its result to aphrody/SHA256SUMS.
if [[ "${APHRODY_BUNDLE_SKIP_SMOKE:-}" = 1 ]]; then
  echo 'WARNING: smoke skipped; the Aphrody adapter will refuse this bundle (no SMOKE.json)' >&2
else
  "$app/bin/aphrody-embed" install --model-dir "$e5_dir"
  APHRODY_EMBED_MODEL_DIR="$e5_dir" python3 "$infra_repo/scripts/smoke-aphrody-stack-local.py" \
    "$app" --attest "$app/SMOKE.json"
fi

# Shenron: sealed site artifact (Next `.next-build`) plus the exact source tree.
shenron="$super/shenron"
shenron_sha="${repo_sha[shenron]}"
(cd "$shenron" && bun install --frozen-lockfile)
(cd "$shenron" && bun run site:artifact)
(cd "$shenron" && sha256sum --quiet --check artifacts/site-build.tar.gz.sha256)
install -m 0644 "$shenron/artifacts/site-build.tar.gz" "$stage/shenron/site-build.tar.gz"
git -C "$shenron" archive --format=tar.gz -o "$stage/shenron/source.tar.gz" "$shenron_sha"
for unit in shenron-site shenron-bot; do
  install -m 0644 "$infra_repo/systemd/$unit.service" "$stage/shenron/systemd/$unit.service"
done
{
  printf '# /etc/nginx/conf.d/shenron.conf, generated from aphrody-infra/nginx/{00-shenron-cache,dragonballfr.com,bot.dragonballfr.com,cdn.dragonballfr.com}.conf.example\n'
  printf '# Owner: Shenron (aphrody-infra); installed by atomic-deploy-shenron.sh. Do not edit on the host.\n'
  for part in 00-shenron-cache dragonballfr.com bot.dragonballfr.com cdn.dragonballfr.com; do
    printf '\n# ===== nginx/%s.conf.example\n' "$part"
    cat "$infra_repo/nginx/$part.conf.example"
  done
} > "$stage/shenron/nginx/shenron.conf"

python3 - "$stage" "$infra_repo/config/service-catalog.json" "$id" "$super_sha" "$shenron_sha" \
  "${repo_sha[rg]}" "${repo_sha[aphrody-infra]}" "$([[ -f "$app/SMOKE.json" ]] && echo yes || echo no)" \
  "$(release_sha)" "$(cd "$super/aphrody-ai" && rustc --version)" "$(bun --version)" <<'PY'
import datetime
import io
import json
import pathlib
import sys
import tarfile

stage = pathlib.Path(sys.argv[1])
catalog = json.loads(pathlib.Path(sys.argv[2]).read_text())
bundle_id, super_sha, shenron_sha, rg_sha, infra_sha, smoked, release_sha, rustc, bun = sys.argv[3:12]
built_at = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')

def roster(predicate):
    return [item['id'] for item in catalog['services']
            if item.get('status') != 'retired' and item['unit'].endswith('.service') and predicate(item)]

shenron_services = roster(lambda s: s.get('application') == 'shenron'
                          and s.get('workingDirectory', '').startswith('/srv/shenron/current'))
rg_services = roster(lambda s: s['id'].startswith('rg-'))
with tarfile.open(stage / 'shenron' / 'site-build.tar.gz') as archive:
    manifest = json.load(io.TextIOWrapper(archive.extractfile('artifact-manifest.json'), 'utf-8'))
if manifest.get('schema') != 'shenron-site-artifact/v1' or not shenron_sha.startswith(manifest.get('commit') or '-'):
    raise SystemExit('Shenron site artifact was not built from the pinned Shenron commit')

def write(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')

write(stage / 'shenron' / 'release.json', {
    'schemaVersion': 1, 'repository': 'shenron', 'commit': shenron_sha, 'builtAt': built_at,
    'services': shenron_services, 'infraCommit': infra_sha,
    'siteArtifact': {'schema': manifest['schema'], 'buildId': manifest['buildId'], 'commit': manifest['commit']},
})
write(stage / 'rg' / 'release.json', {
    'schemaVersion': 1, 'repository': 'rg', 'commit': rg_sha, 'services': rg_services,
    'assembly': 'vps', 'assemble': f'scripts/rg/assemble-vps-release.sh {rg_sha}', 'infraCommit': infra_sha,
})
repositories = dict(line.split('=', 1) for line in release_sha.splitlines())
write(stage / 'BUNDLE.json', {
    'schemaVersion': 1, 'kind': 'aphrody-vps-bundle', 'id': bundle_id, 'builtAt': built_at,
    'superproject': super_sha, 'repositories': repositories,
    'builder': {'target': 'x86_64-unknown-linux-gnu', 'rustc': rustc, 'bun': bun},
    'order': ['aphrody', 'shenron', 'rg'],
    'components': {
        'aphrody': {'path': 'aphrody', 'releaseId': bundle_id, 'smokeAttested': smoked == 'yes',
                    'services': ['aphrody-web-api', 'aphrody-a2a', 'aphrody-shenron-embed', 'aphrody-ai-http', 'aphrody-site']},
        'shenron': {'path': 'shenron', 'commit': shenron_sha, 'services': shenron_services},
        'rg': {'path': 'rg', 'commit': rg_sha, 'services': rg_services, 'assembly': 'vps'},
    },
})
PY
(cd "$stage/shenron" && find . -type f ! -name SHA256SUMS -printf '%P\0' | sort -z | xargs -0 sha256sum > SHA256SUMS)
release_sha > "$stage/RELEASE_SHA"
rm -rf -- "$logs"

# A build must not rewrite any tracked file (lockfiles, generated sources).
require_clean
(cd "$stage" && find . -type f ! -path ./SHA256SUMS -printf '%P\0' | sort -z | xargs -0 sha256sum > SHA256SUMS)
(cd "$stage" && sha256sum --quiet --check SHA256SUMS)
mv -T -- "$stage" "$out_root/$id"
stage=''
tar -C "$out_root" -czf "$out_root/$id.tar.gz" "$id"
(cd "$out_root" && sha256sum "$id.tar.gz" > "$id.tar.gz.sha256")
printf 'bundle=%s\narchive=%s\nsmoke=%s\n' "$out_root/$id" "$out_root/$id.tar.gz" \
  "$([[ -f "$out_root/$id/aphrody/SMOKE.json" ]] && echo attested || echo missing)"

#!/usr/bin/env bash
set -Eeuo pipefail

# Build exactly one immutable RG artifact. Activation is owned by aphrody-infra
# (scripts/atomic-deploy-rg.sh). The systemd units and nginx route table packaged
# here live in yolo (`$YOLO_ROOT/config/host`, default `$HOME/yolo`): rg only
# contributes application code.
commit_arg="${1:?usage: assemble-vps-release.sh FULL_GIT_SHA}"
source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
infra_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
yolo_root="${YOLO_ROOT:-$HOME/yolo}"
host_root="$yolo_root/config/host"
releases_root="${RG_RELEASES_ROOT:-/srv/rg/releases}"
catalog="${RG_CATALOG_PATH:-$host_root/rg/service-catalog.json}"
website_env="${RG_WEBSITE_ENV_PATH:-/etc/rose-griffon/website.env}"
node_image="node:22-bookworm-slim"
umask 027

[[ "$commit_arg" =~ ^[0-9a-f]{40}$ ]] || { echo 'full Git SHA required' >&2; exit 2; }
[[ -r "$catalog" ]] || { echo 'installed infra service catalog missing' >&2; exit 2; }
catalog_source="$catalog"
catalog_snapshot="$(mktemp "${TMPDIR:-/tmp}/rg-catalog.XXXXXX")"
trap 'rm -f -- "$catalog_snapshot"' EXIT
cp -- "$catalog" "$catalog_snapshot"
catalog="$catalog_snapshot"
[[ -d "$host_root/systemd/rg" && -f "$host_root/rg/nginx-routes.json" && -f "$infra_root/scripts/iecode/rg/nginx-gen.ts" ]] || {
  echo "$host_root/{systemd/rg,rg/nginx-routes.json} (set YOLO_ROOT) and scripts/iecode/rg/nginx-gen.ts required" >&2; exit 2;
}
# Units and routes are release content: they must be committed in aphrody-infra
# so the artifact records exactly which yolo revision it carries.
infra_commit="$(git -C "$yolo_root" rev-parse --verify 'HEAD^{commit}')"
git -C "$yolo_root" diff --quiet HEAD -- config/host packages/core/src/host &&
  [[ -z "$(git -C "$yolo_root" ls-files --others --exclude-standard -- config/host packages/core/src/host)" ]] || {
  echo 'yolo config/host has uncommitted changes' >&2; exit 2;
}
git -C "$infra_root" diff --quiet HEAD -- scripts/iecode/rg/nginx-gen.ts || {
  echo 'scripts/iecode/rg/nginx-gen.ts has uncommitted changes' >&2; exit 2;
}
[[ -f "$website_env" && "$(stat -c %a "$website_env")" = 600 ]] || {
  echo 'website build environment must exist with mode 0600' >&2; exit 2;
}
# Every EnvironmentFile= declared by a cataloged RG unit must already exist, 0600.
env_list="$(python3 - "$catalog" "$host_root/systemd/rg" <<'PY'
import json
import pathlib
import sys

catalog = json.loads(pathlib.Path(sys.argv[1]).read_text())
units = pathlib.Path(sys.argv[2])
seen = set()
for service in catalog['services']:
    if (not service['id'].startswith('rg-') or not service['unit'].endswith('.service')
            or service.get('status') == 'retired'):
        continue
    path = units / service['unit']
    if not path.is_file():
        raise SystemExit(f"yolo host unit missing: {service['unit']}")
    for line in path.read_text().splitlines():
        if line.startswith('EnvironmentFile='):
            for env in line.split('=', 1)[1].split():
                env = env.removeprefix('-')
                if env not in seen:
                    seen.add(env)
                    print(env)
PY
)" || exit 2
mapfile -t env_files <<< "$env_list"
for env_file in "${env_files[@]}"; do
  [[ -f "$env_file" && "$(stat -c %a "$env_file")" = 600 ]] || {
    echo "required 0600 runtime environment missing: $env_file" >&2; exit 2;
  }
done
for runtime_dir in /var/www/cdn/static/rg/public /var/lib/rg; do
  [[ -d "$runtime_dir" ]] || { echo "required RG runtime directory missing: $runtime_dir" >&2; exit 2; }
done
cd "$source_root"
commit="$(git rev-parse --verify 'HEAD^{commit}')"
[[ "$commit" = "$commit_arg" ]] || { echo 'checkout HEAD differs from requested commit' >&2; exit 2; }
git diff --quiet && git diff --cached --quiet || { echo 'tracked checkout changes must be committed first' >&2; exit 2; }
git cat-file -e "$commit:bun.lock" || { echo 'bun.lock absent from requested commit' >&2; exit 2; }
[[ "$(realpath -m -- "$releases_root")" = /srv/rg/releases ]] || {
  echo 'release root must be /srv/rg/releases' >&2; exit 2;
}
install -d -m 0755 "$releases_root"
install -d -m 0750 /srv/rg/shared/{website/cache,bot,cron,discord-sync,achillea/logs,achillea/storage}
destination="$releases_root/$commit"
[[ ! -e "$destination" ]] || { echo 'release already exists; refusing to overwrite' >&2; exit 2; }
stage="$(mktemp -d "$releases_root/.assembling-$commit.XXXXXX")"
cleanup() {
  rm -f -- "$catalog_snapshot"
  if [[ -n "${stage:-}" && -d "$stage" && "$stage" = "$releases_root/.assembling-$commit."* ]]; then
    rm -rf -- "$stage"
  fi
}
trap cleanup EXIT

git archive --format=tar "$commit" | tar -xf - -C "$stage"
# Python host tooling belongs to the sibling workspace, not this Bun runtime artifact.
# Exclude only its thin dispatch symlinks; every other escaping link remains an error.
python3 - "$stage" <<'PYTHON'
import pathlib
import sys
root = pathlib.Path(sys.argv[1]).resolve()
for path in (root / 'scripts').rglob('*.py'):
    if path.is_symlink() and str(path.readlink()).endswith(
        '/aphrody-py/tools/infra/scripts/python-workspace-dispatch.py'
    ):
        path.unlink()
PYTHON
python3 - "$stage" <<'PY'
import pathlib
import sys
for path in pathlib.Path(sys.argv[1]).rglob('*'):
    if not path.is_file():
        continue
    name = path.name
    if name.endswith(('.pem', '.p12', '.pfx')) or (
        name.startswith('.env') and not name.endswith(('.example', '.sample', '.template'))
    ):
        raise SystemExit('release source contains a secret-like file')
PY
cd "$stage"
# @aphrody/* dependencies are pinned content-addressed archives; no registry credential is required.
bun run install:workspace

# These workspace packages export dist/ files, which are absent from git.
# Build them before Next resolves their package exports.
(cd "$stage" && bun run --filter "@rosegriffon/*" build)
# Public assets are generated from their single package owner before standalone tracing.
bun packages/rg-assets/scripts/sync-website-public.ts --to apps/rg-website/public

# Next 16 standalone must be built under Node 22; Bun is used for installs and
# for the final runtime. Docker reads the protected env file on the host only.
docker_cmd=(docker)
if [[ ! -r "$website_env" ]]; then docker_cmd=(sudo -n docker); fi
"${docker_cmd[@]}" image inspect "$node_image" >/dev/null
mkdir -p "$stage/.build-tmp" "$stage/.build-home"
docker_env="$stage/.docker-build.env"
python_cmd=(python3)
if [[ ! -r "$website_env" ]]; then python_cmd=(sudo -n python3); fi
"${python_cmd[@]}" - "$website_env" "$docker_env" <<'PY'
import os
import pathlib
import re
import shlex
import sys

source = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
lines = []
seen = set()
for raw in source.read_text().splitlines():
    stripped = raw.strip()
    if not stripped or stripped.startswith('#'):
        continue
    if stripped.startswith('export '):
        stripped = stripped.removeprefix('export ').lstrip()
    if '=' not in stripped:
        raise SystemExit('invalid website environment assignment')
    key, value = stripped.split('=', 1)
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key) or key in seen:
        raise SystemExit('invalid or duplicate website environment key')
    seen.add(key)
    # JSON credentials can be unquoted and contain spaces; Docker accepts the
    # entire text after '=' as one value. Decode only quoted dotenv values.
    if value.startswith(('"{', "'{")) and value.endswith(value[0]):
        # Legacy service-account JSON contains unescaped interior quotes.
        parts = [value[1:-1]]
    else:
        parts = shlex.split(value, comments=False, posix=True) if value.startswith(('"', "'")) else [value]
    if len(parts) != 1 or '\n' in parts[0] or '\r' in parts[0]:
        raise SystemExit('invalid website environment value')
    lines.append(f'{key}={parts[0]}\n')
fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as output:
    output.writelines(lines)
PY
"${docker_cmd[@]}" run --rm --network host \
  --user "$(id -u):$(id -g)" \
  --env-file "$docker_env" \
  -e NEXT_TELEMETRY_DISABLED=1 -e SENTRY_SKIP_UPLOAD=1 \
  -e NODE_OPTIONS=--max-old-space-size=8192 \
  -e HOME=/work/.build-home -e TMPDIR=/work/.build-tmp \
  -v "$stage:/work" -w /work/apps/rg-website \
  "$node_image" node node_modules/next/dist/bin/next build --turbopack
rm -f -- "$docker_env"
server="$stage/apps/rg-website/.next/standalone/apps/rg-website/server.js"
[[ -s "$stage/apps/rg-website/.next/BUILD_ID" && -s "$server" ]] || {
  echo 'Next standalone build incomplete' >&2; exit 1;
}
install -m 0644 "$server" "$stage/apps/rg-website/server.js"
rm -rf -- "$stage/apps/rg-website/.next/standalone" "$stage/.build-tmp" "$stage/.build-home"
# Mount point for the shared Next cache (BindPaths= in rg-website.service).
mkdir -p "$stage/apps/rg-website/.next/cache"

(cd "$stage/apps/rg-bot" && bun run compile &&
  bun build src/api/index.ts --target bun --packages external --outfile build/main.js &&
  bun build src/api/ranked/main.ts --target bun --packages external --outfile build/ranked/main.js)
[[ -s "$stage/apps/rg-bot/build/main.js" && -s "$stage/apps/rg-bot/build/ranked/main.js" ]] || {
  echo 'Achillea bot build incomplete' >&2; exit 1;
}
mkdir -p "$stage/apps/rg-bot/logs" "$stage/apps/rg-bot/storage"

mkdir -p "$stage/systemd" "$stage/nginx"
bun "$infra_root/scripts/iecode/rg/nginx-gen.ts" --out "$stage/nginx/rg.conf"
chmod 0644 "$stage/nginx/rg.conf"
python3 - "$stage" "$catalog" "$commit" "$yolo_root" "$infra_commit" <<'PY'
import datetime
import hashlib
import json
import pathlib
import os
import re
import subprocess
import sys

root = pathlib.Path(sys.argv[1]).resolve()
catalog_bytes = pathlib.Path(sys.argv[2]).read_bytes()
catalog = json.loads(catalog_bytes)
(root / "service-catalog.json").write_bytes(catalog_bytes)
commit = sys.argv[3]
yolo_root = sys.argv[4]
host_cli = pathlib.Path(yolo_root) / 'packages/core/src/host/cli.ts'
infra_commit = sys.argv[5]
# Timers (backups, monitor) are host-owned by aphrody-infra and never shipped in
# the release, nor are retired services; the activation adapter applies the same
# filter to its roster.
services = [service for service in catalog['services']
            if service['id'].startswith('rg-') and service['unit'].endswith('.service')
            and service.get('status') != 'retired']
for service in services:
    name = service['id']
    unit = service['unit']
    if unit != f'{name}.service':
        raise SystemExit(f'catalog unit for {name} must be {name}.service')
    text = subprocess.run(['bun', str(host_cli), 'compose-unit', unit], check=True, text=True, capture_output=True,
                          env={**os.environ, 'YOLO_ROOT': yolo_root}).stdout
    for old, new in [('apps/achillea-bot', 'apps/rg-bot'), ('apps/website', 'apps/rg-website'), ('apps/bot', 'apps/rg-bot'), ('packages/cron', 'packages/rg-cron')]:
        text = text.replace('/srv/rg/current/' + old, '/srv/rg/current/' + new)
    # Same invariants as the activation adapter, checked before the build is sealed.
    if '/home/ubuntu/rg' in text or not re.search(
            r'^WorkingDirectory=/srv/rg/current(?:/[^\s]*)?$', text, re.MULTILINE):
        raise SystemExit(f'yolo host unit is not release-based: {unit}')
    if not re.search(r'^EnvironmentFile=/etc/', text, re.MULTILINE):
        raise SystemExit(f'yolo host unit has no /etc EnvironmentFile: {unit}')
    (root / 'systemd' / unit).write_text(text)

manifest = {
    'schemaVersion': 1,
    'repository': 'aphrody-labs/aphrody',
    'iecodeSource': json.loads((root / '.cache/iecode-packages/manifest.json').read_text()),
    'commit': commit,
    'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z'),
    'services': [service['id'] for service in services],
    'infraCommit': infra_commit,
    'catalog': {'path': 'service-catalog.json', 'sha256': hashlib.sha256(catalog_bytes).hexdigest()},
}
(root / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
(root / 'RELEASE_SHA').write_text(commit + '\n')

entries = []
for path in sorted(root.rglob('*')):
    if path.name == 'SHA256SUMS':
        continue
    if path.is_symlink() and not path.resolve(strict=True).is_relative_to(root):
        raise SystemExit('release symlink escapes artifact')
    if not path.is_file():
        continue
    relative = path.relative_to(root).as_posix()
    if '\n' in relative or '\\' in relative:
        raise SystemExit('unsupported filename in release')
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    entries.append(f'{digest.hexdigest()}  {relative}\n')
(root / 'SHA256SUMS').write_text(''.join(entries))
PY

sha256sum --quiet --check "$stage/SHA256SUMS"
mv -T -- "$stage" "$destination"
stage=""
printf 'assembled %s\n' "$destination"

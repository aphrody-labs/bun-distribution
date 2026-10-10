#!/usr/bin/env bash
set -Eeuo pipefail

# The canonical adapter also handles sealed container releases, without a Bun
# installation or source reconstruction on the production host.
container_target="${2:-${1:-}}"
if [[ -n "$container_target" && ( -f "$container_target/compose.yaml" || -f "$container_target/ROLLBACK.json" ) ]]; then
  container_adapter="$(dirname "${BASH_SOURCE[0]}")/aphrody-infra-deploy-shenron-container"
  [[ -f "$container_adapter" ]] || container_adapter="$(dirname "${BASH_SOURCE[0]}")/atomic-deploy-shenron-container.py"
  exec python3 "$container_adapter" "$@"
fi

# Shenron release plane on the VPS (/home/ubuntu/apps/shenron/{releases,current,shared}),
# modelled on atomic-deploy-rg.sh. The installed catalog snapshot is the
# roster (application shenron, release-based, not retired: shenron-site and
# shenron-bot); the release carries their units and the shenron.conf vhost.
#
#   atomic-deploy-shenron.sh assemble BUNDLE_SHENRON_DIR
#       Build /home/ubuntu/apps/shenron/releases/<commit> from a bundle's shenron/ directory
#       (git archive + sealed Next artifact + `bun install --frozen-lockfile`),
#       without touching `current` or any running service. Idempotent.
#   atomic-deploy-shenron.sh [activate] /home/ubuntu/apps/shenron/releases/<commit>
#       Verify, switch `current`, restart, probe loopback health and HTTPS
#       routes; any failure restores the previous `current`, units, vhost,
#       refreshed shared files and service states.
#   atomic-deploy-shenron.sh restore BACKUP_DIR
#       Re-apply the backup of an earlier activation (bundle rollback). Only the
#       active release stays on disk: reassemble the previous bundle first.
#
# Mutable data stays in /home/ubuntu/apps/shenron/shared, linked into every release; the
# Git-tracked seed of those directories is refreshed on activation (backed up,
# never deleted). Secrets stay in /etc env files; only key names are checked,
# against the installed tools/config/secrets-contract.json.
usage='usage: atomic-deploy-shenron.sh assemble DIR | [activate] RELEASE_DIR | restore BACKUP_DIR'
root="${SHENRON_RELEASE_ROOT:-/home/ubuntu/apps/shenron}"
share="${SHENRON_INFRA_SHARE:-/usr/local/share/aphrody-infra}"
catalog="${SHENRON_SERVICE_CATALOG:-$share/service-catalog.json}"
routes="${SHENRON_NGINX_ROUTES:-$share/nginx-routes.json}"
contract="${SHENRON_SECRETS_CONTRACT:-$share/secrets-contract.json}"
systemd_dir="${SHENRON_SYSTEMD_DIR:-/etc/systemd/system}"
env_root="${SHENRON_ENV_ROOT:-/etc}"
nginx_conf="${SHENRON_NGINX_CONF:-/etc/nginx/conf.d/shenron.conf}"
probe_attempts="${SHENRON_PROBE_ATTEMPTS:-30}"
run_as="${SHENRON_RUN_AS:-ubuntu}"
bun="${SHENRON_BUN:-$(command -v bun || true)}"
# sudo resets PATH: fall back to the service user's Bun (the units run /home/<user>/.bun/bin/bun).
[[ -x "$bun" ]] || bun="$(getent passwd "$run_as" | cut -d: -f6)/.bun/bin/bun"
[[ -x "$bun" ]] || { echo "Bun not found: set SHENRON_BUN to its absolute path" >&2; exit 2; }
current="$root/current"
releases="$root/releases"
# Release path -> directory under $root/shared (the live layout since 2026-09-23).
shared_links=(
  'apps/site/public/wiki:site/wiki'
  'apps/site/.next-build/cache:site/next-cache'
  'apps/bot/assets:bot/assets'
  'apps/bot/data:bot/data'
  '.coord:coord'
)
[[ "${SHENRON_KEEP_FAILED_STAGE:-0}" = 0 || "${SHENRON_KEEP_FAILED_STAGE:-0}" = 1 ]] || { echo 'SHENRON_KEEP_FAILED_STAGE must be0or1' >&2; exit 2; }
[[ "$probe_attempts" =~ ^[1-9][0-9]*$ ]] || { echo 'invalid probe attempts' >&2; exit 2; }
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }
[[ $# -ge 1 && $# -le 2 ]] || { echo "$usage" >&2; exit 2; }
if [[ $# -eq 1 ]]; then mode=activate; target="$1"; else mode="$1"; target="$2"; fi

# Explicit source layout and target are sealed in release.json; legacy artifacts
# remain valid without these fields. Never infer target from host names.
configure_layout() {
  local manifest="$1" layout
  layout="$(python3 - "$manifest" <<'PYLAYOUT'
import json, sys
m = json.load(open(sys.argv[1]))
layout = m.get('sourceLayout', 'legacy')
if layout not in ('legacy', 'monorepo') or m.get('target', 'vps') not in ('vps', 'dbfr'):
    raise SystemExit('invalid Shenron source layout or deployment target')
print(layout)
PYLAYOUT
)" || exit 2
  site_path=apps/site
  bot_path=apps/bot
  if [[ "$layout" = monorepo ]]; then
    site_path=apps/shenron/site
    bot_path=apps/shenron/bot
  fi
  shared_links=(
    "$site_path/public/wiki:site/wiki"
    "$site_path/.next-build/cache:site/next-cache"
    "$bot_path/assets:bot/assets"
    "$bot_path/data:bot/data"
    '.coord:coord'
  )
}

resolve_next_path() {
  local release_path="$1"
  next_path="$site_path/node_modules/next/dist/bin/next"
  if [[ "$site_path" = apps/site && ! -f "$release_path/$next_path" ]]; then
    next_path=node_modules/next/dist/bin/next
  fi
  [[ -f "$release_path/$next_path" ]] || { echo 'Bun install did not provide Next for site owner' >&2; exit 2; }
}

assemble() {
  local source="$1" commit dest stage link rel
  source="$(realpath -e -- "$source")"
  configure_layout "$source/release.json"
  for file in release.json source.tar.gz site-build.tar.gz SHA256SUMS nginx/shenron.conf; do
    [[ -f "$source/$file" ]] || { echo "bundle shenron/ lacks $file" >&2; exit 2; }
  done
  (cd "$source" && sha256sum --quiet --check SHA256SUMS) || { echo 'bundle shenron/ checksum mismatch' >&2; exit 2; }
  commit="$(python3 - "$source/release.json" <<'PY'
import json
import re
import sys
manifest = json.load(open(sys.argv[1]))
if manifest.get('schemaVersion') != 1 or manifest.get('repository') not in ('shenron', 'aphrody-labs/aphrody'):
    raise SystemExit('not a Shenron release manifest')
if not re.fullmatch(r'[0-9a-f]{40}', manifest.get('commit', '')):
    raise SystemExit('release.json commit must be a full Git SHA')
print(manifest['commit'])
PY
)" || exit 2
  dest="$releases/$commit"
  if [[ -e "$dest" ]]; then
    cmp -s -- "$source/release.json" "$dest/release.json" && (cd "$dest" && sha256sum --quiet --check SHA256SUMS) || {
      echo "release $dest exists with different content; refusing to overwrite" >&2; exit 2;
    }
    printf 'already assembled %s\n' "$dest"
    return 0
  fi
  install -d -m 0755 "$releases"
  stage="$(mktemp -d "$releases/.assembling-$commit.XXXXXX")"
  chmod 0755 "$stage"
  assembling_stage="$stage"
  cleanup_assembly() {
    local status="$1"
    if [[ "$status" != 0 && "${SHENRON_KEEP_FAILED_STAGE:-0}" = 1 ]]; then
      chmod 0700 "$assembling_stage"
      printf 'failed assembly retained for private inspection: %s\n' "$assembling_stage" >&2
    else
      rm -rf -- "$assembling_stage"
    fi
  }
  trap 'cleanup_assembly "$?"' EXIT
  # Source Git history contains old tracked dependency aliases. Dependencies
  # are reconstructed exclusively by the pinned frozen Bun install below.
  tar -xzf "$source/source.tar.gz" --exclude='node_modules' --exclude='*/node_modules' --exclude='*/node_modules/*' -C "$stage"
  python3 - "$stage" <<'PY'
import pathlib
import sys
for path in pathlib.Path(sys.argv[1]).rglob('*'):
    name = path.name
    if path.is_file() and (name.endswith(('.pem', '.p12', '.pfx')) or (
            name.startswith('.env') and not name.endswith(('.example', '.sample', '.template')))):
        raise SystemExit(f'release source contains a secret-like file: {path.name}')
PY
  install -d "$stage/.artifact"
  tar -xzf "$source/site-build.tar.gz" -C "$stage/.artifact"
  python3 - "$stage/.artifact/artifact-manifest.json" "$source/release.json" <<'PY'
import json
import sys
artifact = json.load(open(sys.argv[1]))
release = json.load(open(sys.argv[2]))
expected = release.get('siteArtifact', {})
if (artifact.get('schema') != 'shenron-site-artifact/v1' or not release['commit'].startswith(artifact.get('commit') or '-')
        or artifact.get('buildId') != expected.get('buildId')):
    raise SystemExit('site artifact does not match the Shenron release manifest')
PY
  [[ -s "$stage/.artifact/build/BUILD_ID" ]] || { echo 'site artifact has no BUILD_ID' >&2; exit 2; }
  rm -rf -- "$stage/$site_path/.next-build"
  mv -T -- "$stage/.artifact/build" "$stage/$site_path/.next-build"
  mv -- "$stage/.artifact/artifact-manifest.json" "$stage/site-artifact-manifest.json"
  rm -rf -- "$stage/.artifact"
  chown -R "$run_as:$run_as" "$stage"
  local install_args=(install --frozen-lockfile)
  # Runtime targets consume sealed factory output and registry prebuilts;
  # native lifecycle compilation belongs to VPS, not DBFR assembly.
  if [[ "$site_path" = apps/shenron/site ]]; then install_args+=(--ignore-scripts); fi
  (cd "$stage" && runuser -u "$run_as" -- env HOME="$(getent passwd "$run_as" | cut -d: -f6)" "$bun" "${install_args[@]}")
  resolve_next_path "$stage"
  # Mutable directories become links into shared/; their tracked content is
  # kept as the seed refreshed at activation.
  for link in "${shared_links[@]}"; do
    rel="${link%%:*}"
    if [[ -e "$stage/$rel" || -L "$stage/$rel" ]]; then
      install -d "$stage/.shared-seed/$(dirname -- "$rel")"
      mv -T -- "$stage/$rel" "$stage/.shared-seed/$rel"
    fi
    install -d "$stage/$(dirname -- "$rel")"
    ln -s -- "$root/shared/${link#*:}" "$stage/$rel"
  done
  install -d "$stage/systemd" "$stage/nginx"
  cp -- "$source"/systemd/*.service "$stage/systemd/"
  python3 - "$source/release.json" "$stage/systemd" "$env_root" "$site_path" "$bot_path" "$next_path" <<'PYUNITS'
import json, pathlib, shlex, sys
from urllib.parse import urlsplit
manifest = json.load(open(sys.argv[1]))
units, env_root = pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
site, bot, next_path = sys.argv[4:7]
# The monorepo source archive also contains unrelated Infra templates.
# Only the two sealed Shenron release units are deployment inputs.
for name in ('shenron-site.service', 'shenron-bot.service'):
    unit = units / name
    if unit.is_symlink() or not unit.is_file():
        raise SystemExit('sealed Shenron unit missing or symlinked')
    content = unit.read_text()
    if manifest.get('sourceLayout') == 'monorepo':
        content = content.replace('/apps/site', '/' + site).replace('/apps/bot', '/' + bot)
    content = content.replace('/home/ubuntu/apps/shenron/current/node_modules/next/dist/bin/next', '/home/ubuntu/apps/shenron/current/' + next_path)
    if manifest.get('target', 'vps') == 'dbfr':
        values = {}
        for line in content.splitlines():
            if not line.startswith('EnvironmentFile='):
                continue
            for name in line.split('=', 1)[1].split():
                path = pathlib.Path(name.lstrip('-'))
                if not path.resolve().is_relative_to(env_root.resolve()):
                    raise SystemExit(f'DBFR environment path outside private env root: unit={unit.name}, path={path}, root={env_root}')
                if not path.is_file():
                    continue
                if path.stat().st_mode & 0o777 != 0o600:
                    raise SystemExit('DBFR environment must be private 0600')
                for raw in path.read_text().splitlines():
                    raw = raw.strip().removeprefix('export ').strip()
                    if not raw or raw.startswith('#') or '=' not in raw:
                        continue
                    key, value = raw.split('=', 1)
                    words = shlex.split(value, comments=False)
                    values[key.strip()] = words[0] if len(words) == 1 else value
        if unit.name == 'shenron-site.service':
            url = urlsplit(values.get('DATABASE_URL', ''))
            if url.scheme not in ('postgres', 'postgresql') or url.hostname not in ('localhost', '127.0.0.1', '::1') or url.port not in (None, 5432):
                raise SystemExit('DBFR site requires qualified host-local PostgreSQL configuration')
        # Local PostgreSQL replaces the VPS SSH forward. Never start that
        # self-tunnel implicitly when activating the DBFR release.
        content = '\n'.join(line.replace(' shenron-pg-tunnel.service', '')
                            for line in content.splitlines()) + '\n'
    unit.write_text(content)
PYUNITS
  cp -- "$source/nginx/shenron.conf" "$stage/nginx/shenron.conf"
  cp -- "$source/release.json" "$stage/release.json"
  printf '%s\n' "$commit" > "$stage/RELEASE_SHA"
  python3 - "$stage" "$root" "${shared_links[@]}" <<'PY'
import hashlib
import pathlib
import sys
root = pathlib.Path(sys.argv[1]).resolve()
shared = {link.split(':', 1)[0] for link in sys.argv[3:]}
entries = []
for path in sorted(root.rglob('*')):
    relative = path.relative_to(root).as_posix()
    if relative == 'SHA256SUMS' or relative in shared:
        continue
    if path.is_symlink() and not path.resolve(strict=True).is_relative_to(root):
        raise SystemExit(f'release symlink escapes the artifact: {relative}')
    if not path.is_file():
        continue
    if '\n' in relative or '\\' in relative:
        raise SystemExit('unsupported filename in release')
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    entries.append(f'{digest.hexdigest()}  {relative}\n')
(root / 'SHA256SUMS').write_text(''.join(entries))
PY
  (cd "$stage" && sha256sum --quiet --check SHA256SUMS)
  chown -R -h "$run_as:$run_as" "$stage"
  mv -T -- "$stage" "$dest"
  trap - EXIT
  printf 'assembled %s\n' "$dest"
}

restore_backup() {
  local backup="$1" previous service
  mapfile -t roster_units < "$backup/units"
  for service in "${roster_units[@]}"; do systemctl stop "$service" >/dev/null 2>&1 || true; done
  for service in "${roster_units[@]}"; do
    if [[ ! -e "$backup/$service.enabled" ]]; then systemctl disable "$service" >/dev/null 2>&1 || true; fi
    if [[ -e "$backup/$service" ]]; then cp -a -- "$backup/$service" "$systemd_dir/$service"
    else rm -f -- "$systemd_dir/$service"; fi
  done
  # Shared seed: put back overwritten files, drop the ones activation created.
  if [[ -f "$backup/seed.created" ]]; then
    while IFS= read -r file; do [[ -z "$file" ]] || rm -f -- "$root/shared/$file"; done < "$backup/seed.created"
  fi
  if [[ -d "$backup/seed" ]]; then
    # The backup tree is root-made: restore content without handing shared/ to root.
    cp -a --no-preserve=ownership -- "$backup/seed/." "$root/shared/"
    (cd "$backup/seed" && find . -mindepth 1 -print0) | (cd "$root/shared" && xargs -0 -r chown -h -- "$run_as:$run_as")
  fi
  previous="$(cat "$backup/previous-release")"
  if [[ -n "$previous" ]]; then
    ln -sfn -- "$previous" "$root/.current.rollback.$$"
    mv -Tf -- "$root/.current.rollback.$$" "$current"
  else
    rm -f -- "$current"
  fi
  if [[ -e "$backup/shenron.conf" ]]; then cp -a -- "$backup/shenron.conf" "$nginx_conf"; else rm -f -- "$nginx_conf"; fi
  systemctl daemon-reload || true
  for service in "${roster_units[@]}"; do
    if [[ -e "$backup/$service.enabled" ]]; then systemctl enable "$service" >/dev/null 2>&1 || true; fi
    if [[ -e "$backup/$service.active" ]]; then systemctl restart "$service" || true; fi
  done
  if nginx -t; then systemctl reload nginx || true; fi
}

case "$mode" in
  assemble) assemble "$target"; exit 0 ;;
  restore)
    backup="$(realpath -e -- "$target")"
    [[ "$(cat "$backup/kind" 2>/dev/null || true)" = shenron && -f "$backup/previous-release" && -f "$backup/units" ]] || {
      echo "not a Shenron activation backup: $backup" >&2; exit 2;
    }
    restored="$(cat "$backup/previous-release")"
    [[ -z "$restored" || -d "$restored" ]] || {
      echo "release $restored was pruned after activation: assemble its bundle again, then activate it" >&2; exit 2;
    }
    restore_backup "$backup"
    printf 'restored Shenron from %s; current=%s\n' "$backup" "$(if [[ -L "$current" ]]; then readlink -f -- "$current"; else echo none; fi)"
    exit 0 ;;
  activate) ;;
  *) echo "$usage" >&2; exit 2 ;;
esac

for file in "$catalog" "$routes" "$contract"; do [[ -r "$file" ]] || { echo "installed catalog missing: $file" >&2; exit 2; }; done
release="$(realpath -e -- "$target")"
configure_layout "$release/release.json"
resolve_next_path "$release"
release_root="$(realpath -m -- "$releases")"
[[ "$release" = "$release_root/"* ]] || { echo 'release must be under the Shenron release root' >&2; exit 2; }
for file in release.json RELEASE_SHA SHA256SUMS nginx/shenron.conf site-artifact-manifest.json "$site_path/.next-build/BUILD_ID" "$next_path"; do
  [[ -e "$release/$file" ]] || { echo "release lacks $file" >&2; exit 2; }
done

roster="$(python3 - "$catalog" "$contract" "$release" "$env_root" "$root" "${shared_links[@]}" <<'PY'
import json
import pathlib
import re
import sys

catalog = json.loads(pathlib.Path(sys.argv[1]).read_text())
contract = json.loads(pathlib.Path(sys.argv[2]).read_text()).get('services', {})
release = pathlib.Path(sys.argv[3])
env_root = pathlib.Path(sys.argv[4]).resolve()
root = pathlib.Path(sys.argv[5])
links = dict(link.split(':', 1) for link in sys.argv[6:])
manifest = json.loads((release / 'release.json').read_text())
services = [item for item in catalog['services']
            if item.get('application') == 'shenron' and item['unit'].endswith('.service')
            and item.get('status') != 'retired'
            and item.get('workingDirectory', '').startswith('/home/ubuntu/apps/shenron/current')]
ids = [item['id'] for item in services]
if manifest.get('schemaVersion') != 1 or manifest.get('repository') not in ('shenron', 'aphrody-labs/aphrody') or manifest.get('services') != ids:
    raise SystemExit('release.json does not match the installed Shenron service catalog')
commit = manifest.get('commit', '')
if not re.fullmatch(r'[0-9a-f]{40}', commit) or release.name != commit:
    raise SystemExit('release directory must be named after the full Shenron commit')
if (release / 'RELEASE_SHA').read_text().strip() != commit:
    raise SystemExit('RELEASE_SHA differs from release.json commit')
checked = set()
for raw in (release / 'SHA256SUMS').read_text().splitlines():
    match = re.fullmatch(r'[0-9a-fA-F]{64} [ *](.+)', raw)
    if not match:
        raise SystemExit('invalid SHA256SUMS entry')
    path = pathlib.PurePosixPath(match.group(1))
    if path.is_absolute() or '..' in path.parts or match.group(1).startswith('-'):
        raise SystemExit('SHA256SUMS path escapes release')
    checked.add(match.group(1))
for name in ['release.json', 'RELEASE_SHA', 'nginx/shenron.conf'] + [f"systemd/{item['unit']}" for item in services]:
    if name not in checked:
        raise SystemExit(f'SHA256SUMS omits {name}')
for rel, target in links.items():
    link = release / rel
    if not link.is_symlink() or link.readlink() != root / 'shared' / target:
        raise SystemExit(f'shared link {rel} must point to {root / "shared" / target}')
for item in services:
    unit = item['unit']
    if not re.fullmatch(r'shenron-[a-z0-9-]+\.service', unit):
        raise SystemExit('invalid Shenron unit name')
    path = release / 'systemd' / unit
    if not path.is_file():
        raise SystemExit(f'missing unit: {unit}')
    content = path.read_text()
    if not re.search(r'^WorkingDirectory=/home/ubuntu/apps/shenron/current(?:/[^\s]*)?$', content, re.MULTILINE):
        raise SystemExit(f'unit not release-based: {unit}')
    keys = set()
    present = 0
    for line in content.splitlines():
        if not line.startswith('EnvironmentFile='):
            continue
        for env in line.split('=', 1)[1].split():
            optional = env.startswith('-')
            env_path = pathlib.Path(env.removeprefix('-'))
            if not env_path.is_absolute() or not env_path.resolve().is_relative_to(env_root):
                raise SystemExit(f'env file outside {env_root} for {unit}')
            if not env_path.is_file():
                if optional:
                    continue
                raise SystemExit(f'external env file missing for {unit}')
            if env_path.stat().st_mode & 0o777 != 0o600:
                raise SystemExit(f'external env file must be 0600 for {unit}')
            present += 1
            for raw in env_path.read_text().splitlines():
                raw = raw.strip().removeprefix('export ').strip()
                if raw and not raw.startswith('#') and '=' in raw:
                    keys.add(raw.split('=', 1)[0].strip())
    if present == 0:
        raise SystemExit(f'unit has no external env file: {unit}')
    missing = [secret['name'] for secret in contract.get(item['id'], {}).get('secrets', [])
               if secret.get('required') and secret['name'] not in keys]
    if missing:
        raise SystemExit(f"{unit}: required keys missing from its env files: {', '.join(missing)}")
    health = item.get('health', '')
    if health and not re.fullmatch(r'http://127\.0\.0\.1:[0-9]+/[A-Za-z0-9/_-]*', health):
        raise SystemExit(f'invalid loopback health URL: {unit}')
    print(f"{unit}\t{health}")
PY
)" || exit 2
[[ -n "$roster" ]] || { echo 'empty Shenron service roster' >&2; exit 2; }
(cd "$release" && sha256sum --quiet --check SHA256SUMS) || { echo 'release checksum mismatch' >&2; exit 2; }
public_urls="$(python3 - "$catalog" "$routes" "$release/nginx/shenron.conf" <<'PY'
import json
import pathlib
import re
import sys
from urllib.parse import urlsplit

services = {item['id']: item for item in json.loads(pathlib.Path(sys.argv[1]).read_text())['services']}
config = pathlib.Path(sys.argv[3]).read_text()
for route in json.loads(pathlib.Path(sys.argv[2]).read_text())['routes']:
    service = services.get(route['service'], {})
    if service.get('application') != 'shenron' or route.get('status') == 'retired' or service.get('status') == 'retired':
        continue
    host = route['host']
    if not re.fullmatch(r'[a-z0-9.-]+', host):
        raise SystemExit('invalid Shenron public host in route catalog')
    if not re.search(r'\bserver_name\s+[^;]*\b' + re.escape(host) + r'\b[^;]*;', config):
        raise SystemExit(f'packaged nginx config omits {host}')
    health = service.get('health', '')
    if health.startswith('http://'):
        path = route.get('probePath') or urlsplit(health).path or '/'
        if not path.startswith('/') or '\n' in path or '\r' in path:
            raise SystemExit(f'invalid public probe path: {host}')
        print(f'{host}\t{path}')
PY
)" || exit 2

mapfile -t entries <<< "$roster"
services=()
health_urls=()
for entry in "${entries[@]}"; do
  services+=("${entry%%$'\t'*}")
  health_urls+=("${entry#*$'\t'}")
done
previous=''
if [[ -L "$current" ]]; then previous="$(readlink -f -- "$current")"; fi
[[ -z "$previous" || "$previous" = "$release_root/"* ]] || { echo 'current points outside Shenron releases' >&2; exit 2; }
[[ ! -e "$current" || -L "$current" ]] || { echo 'current is not a symlink' >&2; exit 2; }
for link in "${shared_links[@]}"; do install -d -o "$run_as" -g "$run_as" "$root/shared/${link#*:}"; done

backup="${SHENRON_BACKUP_DIR:-$root/deploy-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$}"
install -d -m 0700 "$backup"
[[ -z "$(ls -A -- "$backup")" ]] || { echo "backup directory is not empty: $backup" >&2; exit 2; }
printf 'shenron\n' > "$backup/kind"
printf '%s\n' "$previous" > "$backup/previous-release"
printf '%s\n' "$release" > "$backup/target-release"
printf '%s\n' "${services[@]}" > "$backup/units"
if [[ -e "$nginx_conf" ]]; then cp -a -- "$nginx_conf" "$backup/shenron.conf"; fi
for service in "${services[@]}"; do
  if [[ -e "$systemd_dir/$service" ]]; then cp -a -- "$systemd_dir/$service" "$backup/$service"; fi
  if systemctl is-active --quiet "$service"; then touch "$backup/$service.active"; fi
  if systemctl is-enabled --quiet "$service"; then touch "$backup/$service.enabled"; fi
done

activated=no
rollback() {
  local status=$?
  trap - ERR
  if [[ "$activated" = yes ]]; then restore_backup "$backup"; fi
  echo "Shenron activation failed; rollback attempted; backup=$backup" >&2
  exit "$status"
}
trap rollback ERR
activated=yes
for service in "${services[@]}"; do install -m 0644 "$release/systemd/$service" "$systemd_dir/$service"; done
systemctl daemon-reload
if [[ -d "$release/.shared-seed" ]]; then
  # Refresh the tracked seed into shared/ (never deleting), backing up what changes.
  python3 - "$release/.shared-seed" "$root/shared" "$backup" "$run_as" "${shared_links[@]}" <<'PY'
import filecmp
import os
import pathlib
import pwd
import shutil
import sys

seed, shared, backup = (pathlib.Path(arg) for arg in sys.argv[1:4])
user = pwd.getpwnam(sys.argv[4])
created = []
for link in sys.argv[5:]:
    source_rel, shared_rel = link.split(':', 1)
    source = seed / source_rel
    if not source.is_dir():
        continue
    for path in sorted(source.rglob('*')):
        if not path.is_file() or path.is_symlink():
            continue
        relative = pathlib.PurePosixPath(shared_rel) / path.relative_to(source).as_posix()
        target = shared / relative
        if target.is_file() and filecmp.cmp(path, target, shallow=False):
            continue
        if target.exists():
            saved = backup / 'seed' / relative
            saved.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, saved)
        else:
            created.append(str(relative))
        missing = []
        parent = target.parent
        while not parent.exists():
            missing.append(parent)
            parent = parent.parent
        for directory in reversed(missing):
            directory.mkdir()
            os.chown(directory, user.pw_uid, user.pw_gid)
        shutil.copy2(path, target)
        os.chown(target, user.pw_uid, user.pw_gid)
(backup / 'seed.created').write_text(''.join(f'{name}\n' for name in created))
PY
fi
ln -sfn -- "$release" "$root/.current.new.$$"
mv -Tf -- "$root/.current.new.$$" "$current"
for service in "${services[@]}"; do systemctl enable "$service" >/dev/null; systemctl restart "$service"; done
for i in "${!services[@]}"; do
  service="${services[$i]}"; url="${health_urls[$i]}"
  healthy=no
  for _ in $(seq 1 "$probe_attempts"); do
    if systemctl is-active --quiet "$service" &&
       { [[ -z "$url" ]] || curl --fail --silent --show-error --max-time 5 "$url" >/dev/null 2>&1; }; then
      healthy=yes; break
    fi
    sleep 1
  done
  [[ "$healthy" = yes ]] || { echo "readiness failed: $service" >&2; false; }
done
install -m 0644 "$release/nginx/shenron.conf" "$nginx_conf"
nginx -t
systemctl reload nginx
if [[ -n "$public_urls" ]]; then
  while IFS=$'\t' read -r host path; do
    routed=no
    for _ in $(seq 1 "$probe_attempts"); do
      if curl --fail --silent --max-time 5 --noproxy '*' \
        --resolve "$host:443:127.0.0.1" "https://$host$path" >/dev/null 2>&1; then
        routed=yes
        break
      fi
      sleep 1
    done
    [[ "$routed" = yes ]] || { echo "public route readiness failed: $host$path" >&2; false; }
  done <<< "$public_urls"
fi
trap - ERR
# One release on disk: once `current` is healthy every other release goes (each was ~2.4 GB; 34 had filled
# the release disk on 2026-10-09). In-flight .assembling-* stages belong to a concurrent assemble and are kept.
pruned=0
for old in "$release_root"/* "$release_root"/.superseded-*; do
  [[ -d "$old" && "$old" != "$release" ]] || continue
  rm -rf -- "$old"
  pruned=$((pruned + 1))
done
printf 'activated Shenron %s; previous=%s (pruned with %s other releases); backup=%s\n' \
  "$(cat "$release/RELEASE_SHA")" "${previous:-none}" "$pruned" "$backup"

#!/usr/bin/env bash
set -Eeuo pipefail

# Activate a complete, independently built RG release. The release owns its
# systemd units and nginx routes; this script verifies both before switching.
release_arg="${1:?usage: atomic-deploy-rg.sh /srv/rg/releases/ID}"
root="${RG_RELEASE_ROOT:-/srv/rg}"
catalog="${RG_SERVICE_CATALOG:-/usr/local/share/aphrody-infra/service-catalog.json}"
routes="${RG_NGINX_ROUTES:-/usr/local/share/aphrody-infra/nginx-routes.json}"
systemd_dir="${RG_SYSTEMD_DIR:-/etc/systemd/system}"
env_root="${RG_ENV_ROOT:-/etc}"
nginx_conf="${RG_NGINX_CONF:-/etc/nginx/conf.d/rg.conf}"
probe_attempts="${RG_PROBE_ATTEMPTS:-30}"
current="$root/current"
[[ "$probe_attempts" =~ ^[1-9][0-9]*$ ]] || { echo 'invalid probe attempts' >&2; exit 2; }
[[ "$(id -u)" = 0 ]] || { echo 'run as root' >&2; exit 2; }
[[ -r "$catalog" ]] || { echo 'installed service catalog missing' >&2; exit 2; }
[[ -r "$routes" ]] || { echo 'installed nginx route catalog missing' >&2; exit 2; }
release="$(realpath -e -- "$release_arg")"
release_root="$(realpath -m -- "$root/releases")"
[[ "$release" = "$release_root/"* ]] || { echo 'release must be under RG release root' >&2; exit 2; }
[[ -f "$release/release.json" && -f "$release/RELEASE_SHA" && -f "$release/SHA256SUMS" && -f "$release/nginx/rg.conf" ]] || {
  echo 'release manifest, provenance or checksums missing' >&2; exit 2;
}

# The catalog is the roster; release.json is a signed-off inventory of precisely
# the workloads that will switch. Neither contains credentials.
roster="$(python3 - "$catalog" "$release" "$env_root" <<'PY'
import datetime
import json
import pathlib
import re
import sys

catalog = json.loads(pathlib.Path(sys.argv[1]).read_text())
release = pathlib.Path(sys.argv[2])
env_root = pathlib.Path(sys.argv[3]).resolve()
manifest = json.loads((release / 'release.json').read_text())
# Timers (backups, monitor) are host-owned by aphrody-infra, not shipped in the RG release;
# retired services keep their catalog entry and unit template but are never started.
services = [item for item in catalog['services']
            if item['id'].startswith('rg-') and item['unit'].endswith('.service')
            and item.get('status') != 'retired']
ids = [item['id'] for item in services]
# Retained pre-monorepo artifacts remain valid explicit rollback targets.
if (manifest.get('schemaVersion') != 1 or manifest.get('repository') not in {'rg', 'aphrody-labs/aphrody'}
        or manifest.get('services') != ids):
    raise SystemExit('release.json does not match the installed RG service catalog')
commit = manifest.get('commit', '')
if not re.fullmatch(r'[0-9a-f]{40}', commit):
    raise SystemExit('release.json commit must be a full Git SHA')
if (release / 'RELEASE_SHA').read_text().strip() != commit:
    raise SystemExit('RELEASE_SHA differs from release.json commit')
try:
    built = datetime.datetime.fromisoformat(manifest['builtAt'].replace('Z', '+00:00'))
    if built.tzinfo is None:
        raise ValueError('timezone missing')
except (KeyError, TypeError, ValueError):
    raise SystemExit('release.json builtAt must be a timestamp with timezone')
if not (release / 'apps').is_dir() or not (release / 'packages').is_dir():
    raise SystemExit('release must contain apps/ and packages/')
checked = set()
for raw in (release / 'SHA256SUMS').read_text().splitlines():
    match = re.fullmatch(r'[0-9a-fA-F]{64} [ *](.+)', raw)
    if not match:
        raise SystemExit('invalid SHA256SUMS entry')
    name = match.group(1)
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or name.startswith('-'):
        raise SystemExit('SHA256SUMS path escapes release')
    if not (release / name).resolve(strict=True).is_relative_to(release):
        raise SystemExit('SHA256SUMS symlink escapes release')
    checked.add(name)
for name in ['release.json', 'RELEASE_SHA', 'nginx/rg.conf'] + [f"systemd/{item['unit']}" for item in services]:
    if name not in checked:
        raise SystemExit(f'SHA256SUMS omits {name}')
for path in release.rglob('*'):
    if path.is_symlink() and not path.resolve(strict=True).is_relative_to(release):
        raise SystemExit('release contains symlink escaping its root')
    if path.is_file() and path.name != 'SHA256SUMS':
        name = path.relative_to(release).as_posix()
        if name not in checked:
            raise SystemExit(f'SHA256SUMS omits {name}')
for item in services:
    unit = item['unit']
    if not re.fullmatch(r'rg-[a-z0-9-]+\.service', unit):
        raise SystemExit('invalid RG unit name')
    path = release / 'systemd' / unit
    if not path.is_file():
        raise SystemExit(f'missing unit: {unit}')
    content = path.read_text()
    if '/home/ubuntu/rg' in content or (
        item['id'] != 'rg-postgrest'
        and not re.search(r'^WorkingDirectory=/srv/rg/current(?:/[^\s]*)?$', content, re.MULTILINE)
    ):
        raise SystemExit(f'unit not release-based: {unit}')
    # The source checkout is never a runtime secret provider. Require every
    # declared env file, including systemd's optional (-) ones, before switch.
    env_count = 0
    for line in content.splitlines():
        if not line.startswith('EnvironmentFile='):
            continue
        for env in line.split('=', 1)[1].split():
            env = env.removeprefix('-')
            env_path = pathlib.Path(env)
            if not env_path.is_absolute() or not env_path.is_file() or not env_path.resolve().is_relative_to(env_root):
                raise SystemExit(f'external env file missing for {unit}')
            if env_path.stat().st_mode & 0o777 != 0o600:
                raise SystemExit(f'external env file must be 0600 for {unit}')
            env_count += 1
    if item['id'] != 'rg-postgrest' and env_count == 0:
        raise SystemExit(f'unit has no external env file: {unit}')
    health = item.get('health', '')
    if health and not re.fullmatch(r'http://127\.0\.0\.1:[0-9]+/[A-Za-z0-9/_-]*', health):
        raise SystemExit(f'invalid loopback health URL: {unit}')
    print(f"{unit}\t{health}")
PY
)" || exit 2
[[ -n "$roster" ]] || { echo 'empty RG service roster' >&2; exit 2; }
(cd "$release" && sha256sum --quiet --check SHA256SUMS) || { echo 'release checksum mismatch' >&2; exit 2; }
public_urls="$(python3 - "$catalog" "$routes" "$release/nginx/rg.conf" <<'PY'
import json
import pathlib
import re
import sys
from urllib.parse import urlsplit

services = {item['id']: item for item in json.loads(pathlib.Path(sys.argv[1]).read_text())['services']}
routes = json.loads(pathlib.Path(sys.argv[2]).read_text())['routes']
config = pathlib.Path(sys.argv[3]).read_text()
for route in routes:
    service_id = route['service']
    if (not service_id.startswith('rg-') or route.get('status') == 'retired'
            or services.get(service_id, {}).get('status') == 'retired'):
        continue
    host = route['host']
    if not re.fullmatch(r'[a-z0-9.-]+', host):
        raise SystemExit('invalid RG public host in route catalog')
    if not re.search(r'\bserver_name\s+[^;]*\b' + re.escape(host) + r'\b[^;]*;', config):
        raise SystemExit(f'packaged nginx config omits {host}')
    health = services[service_id].get('health')
    if health:
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

install -d -m 0755 "$root"
backup="$root/deploy-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m 0700 "$backup"
previous=""
if [[ -L "$current" ]]; then previous="$(readlink -f -- "$current")"; fi
[[ -z "$previous" || "$previous" = "$release_root/"* ]] || { echo 'current points outside RG releases' >&2; exit 2; }
[[ ! -e "$current" || -L "$current" ]] || { echo 'current is not a symlink' >&2; exit 2; }
printf '%s\n' "$previous" > "$backup/previous-release"
if [[ -e "$nginx_conf" ]]; then cp -a -- "$nginx_conf" "$backup/rg.conf"; fi
for service in "${services[@]}"; do
  if [[ -e "$systemd_dir/$service" ]]; then cp -a -- "$systemd_dir/$service" "$backup/$service"; fi
  if systemctl is-active --quiet "$service"; then touch "$backup/$service.active"; fi
  if systemctl is-enabled --quiet "$service"; then touch "$backup/$service.enabled"; fi
done

activated=no
rollback() {
  status=$?
  trap - ERR
  if [[ "$activated" = yes ]]; then
    for service in "${services[@]}"; do systemctl stop "$service" >/dev/null 2>&1 || true; done
    for service in "${services[@]}"; do
      if [[ ! -e "$backup/$service.enabled" ]]; then systemctl disable "$service" >/dev/null 2>&1 || true; fi
    done
    for service in "${services[@]}"; do
      if [[ -e "$backup/$service" ]]; then cp -a -- "$backup/$service" "$systemd_dir/$service"
      else rm -f -- "$systemd_dir/$service"; fi
    done
    if [[ -n "$previous" ]]; then
      ln -sfn -- "$previous" "$root/.current.rollback.$$"
      mv -Tf -- "$root/.current.rollback.$$" "$current"
    else
      rm -f -- "$current"
    fi
    if [[ -e "$backup/rg.conf" ]]; then cp -a -- "$backup/rg.conf" "$nginx_conf"
    else rm -f -- "$nginx_conf"; fi
    systemctl daemon-reload || true
    for service in "${services[@]}"; do
      if [[ -e "$backup/$service.enabled" ]]; then systemctl enable "$service" >/dev/null 2>&1 || true; fi
      if [[ -e "$backup/$service.active" ]]; then systemctl restart "$service" || true; fi
    done
    nginx -t && systemctl reload nginx || true
  fi
  echo "RG activation failed; rollback attempted; backup=$backup" >&2
  exit "$status"
}
trap rollback ERR
activated=yes
for service in "${services[@]}"; do install -m 0644 "$release/systemd/$service" "$systemd_dir/$service"; done
systemctl daemon-reload
ln -sfn -- "$release" "$root/.current.new.$$"
mv -Tf -- "$root/.current.new.$$" "$current"
for service in "${services[@]}"; do systemctl enable "$service" >/dev/null; systemctl restart "$service"; done
for i in "${!services[@]}"; do
  service="${services[$i]}"; url="${health_urls[$i]}"
  healthy=no
  for _ in $(seq 1 "$probe_attempts"); do
    if systemctl is-active --quiet "$service" &&
       { [[ -z "$url" ]] || curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; }; then
      healthy=yes; break
    fi
    sleep 1
  done
  [[ "$healthy" = yes ]] || { echo "readiness failed: $service" >&2; false; }
done
install -m 0644 "$release/nginx/rg.conf" "$nginx_conf"
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
rm -f -- "$backup/previous-release" "$backup/rg.conf" "$backup/"*.service "$backup/"*.active "$backup/"*.enabled || true
rmdir -- "$backup" || echo "activation healthy; cleanup pending: $backup" >&2
printf 'activated RG %s; previous=%s\n' "$(cat "$release/RELEASE_SHA")" "$previous"

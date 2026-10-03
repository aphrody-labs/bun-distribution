#!/usr/bin/env bash
# Run only through Infra SSH on VPS. Private bytes stream VPS -> DBFR.
set -Eeuo pipefail
[[ $# = 0 || ( $# = 1 && ( "$1" = --apply || "$1" = --probe ) ) ]] || { echo 'usage: shenron-env-transfer.sh [--apply|--probe]' >&2; exit 2; }
if [[ "${1:-}" = --probe ]]; then
  sudo -n python3 - <<'PYPROBE'
import os, pathlib, shlex, subprocess
from urllib.parse import urlsplit, unquote, parse_qs
try:
    path = pathlib.Path('/etc/rose-griffon/shenron-site.env')
    if not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o777 != 0o600:
        raise ValueError()
    values = {}
    for raw in path.read_text().splitlines():
        raw = raw.strip().removeprefix('export ').strip()
        if raw and not raw.startswith('#') and '=' in raw:
            key, value = raw.split('=', 1); words = shlex.split(value, comments=False)
            values[key.strip()] = words[0] if len(words) == 1 else value
    url = urlsplit(values.get('DATABASE_URL', ''))
    if url.scheme not in ('postgres', 'postgresql') or url.hostname not in ('localhost', '127.0.0.1', '::1') or url.port not in (None, 5432):
        raise ValueError()
    env = dict(os.environ, PGHOST=url.hostname, PGPORT='5432', PGDATABASE=unquote(url.path.lstrip('/')), PGUSER=unquote(url.username or ''), PGPASSWORD=unquote(url.password or ''), PGCONNECT_TIMEOUT='5')
    mode = parse_qs(url.query).get('sslmode')
    if mode: env['PGSSLMODE'] = mode[0]
    result = subprocess.run(['psql', '-X', '-w', '-t', '-A', '-c', 'SELECT 1;'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    if result.returncode: raise ValueError()
    print('DBFR configured private PostgreSQL connection: ready; schema/product qualification remains separate')
except Exception:
    raise SystemExit('DBFR private PostgreSQL readiness failed; no credentials logged')
PYPROBE
  exit 0
fi
if [[ $# = 0 ]]; then
  echo 'plan: stream only Shenron site/bot/optional compute env to DBFR private staging; local PostgreSQL5432/Redis6379; back up existing files; install0600'
  exit 0
fi
sudo -n python3 - <<'PY' | ssh -oBatchMode=yes -oConnectTimeout=10 -oStrictHostKeyChecking=yes dbfr 'sudo -n bash -c '\''set -Eeuo pipefail; stage=$(mktemp -d /etc/.shenron-env-transfer.XXXXXX); chmod 700 "$stage"; trap "rm -rf -- \"$stage\"" EXIT; tar -xf - -C "$stage" --no-same-owner; backup=/etc/.shenron-env-backup-$(date -u +%Y%m%dT%H%M%SZ); install -d -m 0700 "$backup"; for relative in rose-griffon/shenron-site.env rose-griffon/shenron-bot.env aphrody/shenron-compute-client.env; do if test -f "$stage/$relative"; then target=/etc/$relative; test ! -L "$target"; test ! -L "$(dirname "$target")"; install -d -m 0755 "$(dirname "$target")"; if test -e "$target"; then install -d -m 0700 "$backup/$(dirname "$relative")"; cp -p "$target" "$backup/$relative"; chmod 600 "$backup/$relative"; fi; install -m 0600 -o root -g root "$stage/$relative" "$target.next.$$"; mv -Tf "$target.next.$$" "$target"; fi; done; printf "Shenron private environments installed0600; backup=%s\n" "$backup"'\'''
import io, pathlib, shlex, sys, tarfile
from urllib.parse import urlsplit, urlunsplit
try:
    files = ['rose-griffon/shenron-site.env', 'rose-griffon/shenron-bot.env', 'aphrody/shenron-compute-client.env']
    payloads = []
    for relative in files:
        path = pathlib.Path('/etc') / relative
        if not path.exists():
            if relative.startswith('aphrody/'):
                continue
            raise ValueError('required private environment missing')
        if not path.is_file() or path.is_symlink() or path.stat().st_mode & 0o777 != 0o600:
            raise ValueError('source environment must be a regular private0600 file')
        output = []
        site_database_found = False
        for line in path.read_text().splitlines():
            raw = line.strip().removeprefix('export ').strip()
            if not raw or raw.startswith('#') or '=' not in raw:
                output.append(line); continue
            key, value = raw.split('=', 1)
            words = shlex.split(value, comments=False)
            decoded = words[0] if len(words) == 1 else value
            if key.strip() in ('DATABASE_URL',) or key.strip().endswith('REDIS_URL'):
                url = urlsplit(decoded)
                if relative.endswith('shenron-site.env') and key.strip() == 'DATABASE_URL':
                    if url.scheme not in ('postgres', 'postgresql') or not url.path.lstrip('/'):
                        raise ValueError('site PostgreSQL configuration required')
                    site_database_found = True
                if url.scheme in ('postgres', 'postgresql', 'redis', 'rediss'):
                    userinfo = url.netloc.rsplit('@', 1)[0] + '@' if '@' in url.netloc else ''
                    port = 5432 if url.scheme in ('postgres', 'postgresql') else 6379
                    decoded = urlunsplit((url.scheme, userinfo + f'127.0.0.1:{port}', url.path, url.query, url.fragment))
                    line = key.strip() + '=' + shlex.quote(decoded)
            output.append(line)
        if relative.endswith('shenron-site.env') and not site_database_found:
            raise ValueError('site DATABASE_URL required')
        payloads.append((relative, ('\n'.join(output) + '\n').encode()))
    with tarfile.open(fileobj=sys.stdout.buffer, mode='w|') as archive:
        for relative, data in payloads:
            entry = tarfile.TarInfo(relative); entry.size = len(data); entry.mode = 0o600
            archive.addfile(entry, io.BytesIO(data))
except Exception:
    raise SystemExit('private environment transfer validation failed; no values logged')
PY

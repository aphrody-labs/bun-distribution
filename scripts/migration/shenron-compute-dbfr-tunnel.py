#!/usr/bin/env python3
"""Root reads private endpoint; Ubuntu owns supervised compute-only reverse SSH."""
import os
from pathlib import Path
import pwd
import shlex
import socket
import sys
from urllib.parse import urlsplit

def compute_port(text):
    values = {}
    for raw in text.splitlines():
        raw = raw.strip().removeprefix('export ').strip()
        if raw and not raw.startswith('#') and '=' in raw:
            key, value = raw.split('=', 1)
            words = shlex.split(value, comments=True)
            if key.strip() == 'APHRODY_AI_HTTP_URL' and len(words) == 1:
                values[key.strip()] = words[0]
    url = urlsplit(values.get('APHRODY_AI_HTTP_URL', ''))
    if url.scheme != 'http' or url.hostname not in ('localhost', '127.0.0.1') or url.username or url.password or url.query or url.fragment:
        raise ValueError('compute endpoint must be a plain loopback HTTP origin')
    port = url.port or 80
    if not 1024 <= port <= 65535:
        raise ValueError('compute tunnel requires an unprivileged port')
    return port

def main():
    if sys.argv[1:] not in ([], ['--run']):
        raise SystemExit('usage: shenron-compute-dbfr-tunnel.py [--run]')
    if not sys.argv[1:]:
        print('plan: root-private compute port only; Ubuntu SSH DBFR reverse loopback forwarding; source models and HTTP service retained')
        return
    if os.geteuid() != 0:
        raise SystemExit('root required to read private endpoint')
    path = Path('/etc/aphrody/shenron-compute-client.env')
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != 0 or path.stat().st_mode & 0o777 != 0o600:
        raise SystemExit('private compute config must be root-owned regular0600')
    try:
        port = compute_port(path.read_text())
        with socket.create_connection(('127.0.0.1', port), timeout=5):
            pass
    except Exception:
        raise SystemExit('private compute endpoint qualification failed; no values logged')
    user = pwd.getpwnam('ubuntu')
    os.initgroups(user.pw_name, user.pw_gid)
    os.setgid(user.pw_gid)
    os.setuid(user.pw_uid)
    args = ['/usr/bin/ssh', '-F', '/home/ubuntu/.ssh/config', '-NT',
            '-oBatchMode=yes', '-oStrictHostKeyChecking=yes', '-oExitOnForwardFailure=yes',
            '-oConnectTimeout=10', '-oServerAliveInterval=15', '-oServerAliveCountMax=3',
            '-R', f'127.0.0.1:{port}:127.0.0.1:{port}', 'dbfr']
    os.execve(args[0], args, {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})

if __name__ == '__main__':
    main()

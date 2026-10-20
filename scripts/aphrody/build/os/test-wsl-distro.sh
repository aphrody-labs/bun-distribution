#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Root-only fixture tests: all bootstrap/chroot/mount operations are intercepted.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo 'Run with sudo -n bash scripts/aphrody/build/os/test-wsl-distro.sh' >&2; exit 2; }
python3 - "$(dirname "$0")/build-wsl-distro.sh" <<'PY'
import hashlib, json, os, pathlib, subprocess, sys, tarfile, tempfile
builder = pathlib.Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix='aphrody-wsl-fixture-') as tmp:
    root = pathlib.Path(tmp)
    fake = root / 'bin'
    fake.mkdir()
    log = root / 'calls'
    commands = {
        'debootstrap': '''#!/bin/bash
set -eu
r=$5
mkdir -p "$r"/{etc/apt/sources.list.d,usr/sbin,proc,sys,dev/pts,var/lib/apt/lists,var/lib/dbus,tmp,var/tmp}
''',
        'mount': '#!/bin/bash\n[[ $1 == --make-private ]] || touch "${@: -1}/.fixture-mounted"\n',
        'mountpoint': '#!/bin/bash\n[[ -f "${@: -1}/.fixture-mounted" ]]\n',
        'umount': '#!/bin/sh\n[ "${FAKE_UNMOUNT_FAIL:-0}" = 0 ] || exit 1\nrm -f "$1/.fixture-mounted"\n',
        'chroot': '''#!/bin/bash
set -eu
printf '%s\\n' "$*" >> "$FAKE_LOG"
shift
case "$1" in
 id) echo 1000 ;;
 locale) echo en_US.utf8 ;;
 dpkg-query) echo 'cosmic-session=fixture' ;;
 env) if [[ "${FAKE_INSTALL_FAIL:-0}" = 1 && "$*" == *'apt-get -y install'* ]]; then exit 91; fi ;;
 runuser) echo 'qualified-fixture-version' ;;
esac
''',
    }
    for name, text in commands.items():
        path = fake / name
        path.write_text(text)
        path.chmod(0o755)
    payload = root / 'payload'
    files = payload / 'rootfs'
    (files / 'usr/local/bin').mkdir(parents=True)
    (files / 'usr/local/share/aphrody').mkdir(parents=True)
    for product in ('aphrody', 'yolo', 'vu'):
        path = files / 'usr/local/bin' / product
        path.write_text('#!/bin/sh\necho fixture\n')
        path.chmod(0o755)
    (files / 'usr/local/share/aphrody/qualification.json').write_text(json.dumps({'fixture': True}))
    def seal():
        entries = []
        for path in sorted(files.rglob('*')):
            if path.is_file() and not path.is_symlink():
                entries.append(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.relative_to(files).as_posix())
        (payload / 'SHA256SUMS').write_text('\n'.join(entries) + '\n')
    seal()
    env = dict(os.environ, PATH=str(fake) + ':' + os.environ['PATH'], FAKE_LOG=str(log), APHRODY_WSL_PAYLOAD=str(payload))
    def run(name, *, okay=False, extra_env=None, packages='systemd,locales,cosmic-session'):
        output = root / name
        result = subprocess.run(['bash', str(builder), str(output), 'AphrodyOS', 'resolute', 'https://archive.ubuntu.com/ubuntu', packages], env=env | (extra_env or {}), text=True, capture_output=True)
        if (result.returncode == 0) != okay:
            raise AssertionError(name + ': ' + result.stdout + result.stderr)
        return output, result
    output, _ = run('valid', okay=True)
    with tarfile.open(output / 'AphrodyOS.wsl') as archive:
        def read(name):
            return archive.extractfile('.//' + name).read().decode()
        assert 'systemd=true' in read('etc/wsl.conf') and 'default=aphro' in read('etc/wsl.conf')
        assert read('etc/locale.gen') == 'en_US.UTF-8 UTF-8\n'
        assert read('etc/machine-id') == ''
        assert read('usr/local/bin/aphrody').endswith('echo fixture\n')
        assert './usr/sbin/policy-rc.d' not in archive.getnames()
    subprocess.run(['sha256sum', '-c', 'SHA256SUMS'], cwd=output, check=True, capture_output=True)
    calls = log.read_text()
    for required in ('groupadd --gid 1000 aphro', 'useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash aphro', 'passwd --lock aphro', 'passwd --lock root', 'runuser -u aphro -- /usr/local/bin/aphrody --version'):
        assert required in calls, required
    run('missing', extra_env={'APHRODY_WSL_PAYLOAD': ''})
    run('driver', packages='nvidia-driver-580')
    run('kernel', packages='linux-image-generic')
    run('apt-failure', extra_env={'FAKE_INSTALL_FAIL': '1'})
    assert not list((root / 'apt-failure').glob('.rootfs.*')), 'Failed bootstrap must clean unmounted staging'
    held, _ = run('umount-failure', extra_env={'FAKE_UNMOUNT_FAIL': '1'})
    assert list(held.glob('.rootfs.*')), 'Unmount failure must retain staging'
    current = files / 'usr/local/bin/aphrody'
    saved = current.read_bytes()
    current.write_bytes(b'changed')
    run('bad-checksum')
    current.write_bytes(saved)
    outside = files / 'usr/local/bin/unlisted'
    outside.write_text('unlisted')
    run('unlisted')
    outside.unlink()
    symlink = files / 'usr/local/bin/escape'
    symlink.symlink_to('/etc/passwd')
    run('escaping-link')
    symlink.unlink()
    (payload / 'SHA256SUMS').write_text('0' * 64 + '  ../escape\n')
    run('traversal')
    print('WSL builder: 10 fixture cases passed (packaging/account/locale, 9 failure boundaries).')
PY

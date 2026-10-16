#!/usr/bin/env python3
"""Rebuild the audited official WSLg recipe without modifying upstream files."""
import argparse
import os
import hashlib
import json
import pathlib
import subprocess

BASE = 'mcr.microsoft.com/azurelinux/base/core@sha256:1324a2cf7ed34e5f48a1022816b205782b86c7305651658e611dcd3d30756751'
PINS = {
    'FreeRDP': ('https://github.com/microsoft/FreeRDP-mirror', 'f31f15e7cc3dd3c84916ca5241f67fcb74c915cb'),
    'weston': ('https://github.com/microsoft/weston-mirror', '7fbf69314f8a74450c265650232f66f59a4e0630'),
    'pulseaudio': ('https://github.com/microsoft/PulseAudio-mirror', 'c33051f2296af748ac5cd13e51abfac4d129e4c7'),
    'DirectX-Headers-1.0': ('https://github.com/microsoft/DirectX-Headers.git', 'cf123266ce6f1e9a6e700642edb6356bff1e3d55'),
    'mesa': ('https://gitlab.freedesktop.org/mesa/mesa.git', 'be4f7fb656180ab55a50eff01f36672b0bf5f146'),
}
WSLG_PIN = '6942bb534b537302a7a22617261d9274db3cfa37'


def git(directory, *args):
    return subprocess.check_output(['git', '-C', str(directory), *args], text=True).strip()


def logged(args, log, cwd=None, env=None):
    with log.open('w') as stream:
        subprocess.run(args, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=pathlib.Path, required=True,
                        help='wslg checkout; restore first: yolo update sources sync --only wslg --apply')
    parser.add_argument('--output', type=pathlib.Path, default=pathlib.Path(os.environ.get('XDG_DATA_HOME') or pathlib.Path.home() / '.local' / 'share') / 'aphrody' / 'wsl-artifacts' / 'wslg')
    parser.add_argument('--engine', default='podman', choices=('podman', 'docker'))
    parser.add_argument('--version', default='dev')
    args = parser.parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if git(source, 'rev-parse', 'HEAD') != WSLG_PIN or git(source, 'status', '--porcelain', '--untracked-files=no'):
        raise SystemExit('WSLg checkout must match the pinned clean upstream revision')
    provenance = {'wslg': {'url': 'https://github.com/microsoft/wslg', 'commit': WSLG_PIN}}
    for name, (url, commit) in PINS.items():
        path = source / 'vendor' / name
        if not path.exists():
            subprocess.run(['git', 'clone', '--no-checkout', '--filter=blob:none', url, str(path)], check=True)
            subprocess.run(['git', '-C', str(path), 'checkout', '--detach', commit], check=True)
        if git(path, 'rev-parse', 'HEAD') != commit or git(path, 'status', '--porcelain', '--untracked-files=no'):
            raise SystemExit(f'{name} checkout must match pinned clean revision {commit}')
        provenance[name] = {'url': url, 'commit': commit}
    (output / 'sources.json').write_text(json.dumps(provenance, indent=2) + '\n')
    tag = 'localhost/aphrody-wslg:x64'
    cmd = [args.engine, 'build', '--network', 'host', '-f', str(source / 'Dockerfile'), '-t', tag]
    if args.engine == 'podman':
        cmd += ['--format', 'docker']
    build_args = {'MARINER_IMAGE': BASE, 'WSLG_VERSION': args.version, 'WSLG_COMMIT': WSLG_PIN,
                  'WSLG_ARCH': 'x86_64', 'DIRECTX_HEADERS_VERSION': PINS['DirectX-Headers-1.0'][1],
                  'FREERDP_COMMIT': PINS['FreeRDP'][1], 'MESA_VERSION': PINS['mesa'][1],
                  'PULSEAUDIO_COMMIT': PINS['pulseaudio'][1], 'WESTON_COMMIT': PINS['weston'][1],
                  'SYSTEMDISTRO_DEBUG_BUILD': ''}
    for key, value in build_args.items():
        cmd += ['--build-arg', f'{key}={value}']
    cmd += [str(source)]
    (output / 'build-command.json').write_text(json.dumps(cmd, indent=2) + '\n')
    logged(cmd, output / 'build.log', cwd=source)
    container = subprocess.check_output([args.engine, 'create', tag], text=True).strip()
    try:
        subprocess.run([args.engine, 'export', '-o', str(output / 'system_x64.tar'), container], check=True)
    finally:
        subprocess.run([args.engine, 'rm', container], check=True)
    logged(['go', 'run', 'github.com/Microsoft/hcsshim/cmd/tar2ext4@v0.13.0', '-vhd',
            '-i', str(output / 'system_x64.tar'), '-o', str(output / 'system_x64.vhd')], output / 'export.log')
    hashes = {}
    for name in ('system_x64.tar', 'system_x64.vhd'):
        digest = hashlib.sha256()
        with (output / name).open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        hashes[name] = {'sha256': digest.hexdigest(), 'bytes': (output / name).stat().st_size}
    (output / 'artifacts.json').write_text(json.dumps(hashes, indent=2) + '\n')
    print(json.dumps(hashes, indent=2))


if __name__ == '__main__':
    main()

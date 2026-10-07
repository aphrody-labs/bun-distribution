#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Usage (root): build-wsl-distro.sh <output> <distribution> <suite> <https-mirror> <pkg,pkg,...> [name|url|suite|components|fingerprint ...]
# APHRODY_WSL_PAYLOAD: qualified staging directory containing rootfs/ and SHA256SUMS.
# The guest carries no kernel or credentials; WSL supplies WSLg and /mnt/wsl GPU support.
set -euo pipefail
[[ $# -ge 5 ]] || { echo 'Expected output, distribution, suite, HTTPS mirror and package list' >&2; exit 2; }
output_dir=$1
distribution=$2
suite=$3
mirror=$4
IFS=, read -r -a packages <<<"$5"
shift 5
repositories=("$@")
[[ $EUID -eq 0 ]] || { echo 'build-wsl-distro.sh must run as root' >&2; exit 1; }
[[ $distribution =~ ^[A-Za-z][A-Za-z0-9_-]*$ && $suite =~ ^[a-z][a-z0-9-]*$ && $mirror == https://* ]] || { echo 'Invalid distribution, suite or HTTPS mirror' >&2; exit 2; }
[[ ${#packages[@]} -gt 0 ]] || { echo 'Empty package list' >&2; exit 2; }
for package in "${packages[@]}"; do
  [[ $package =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || { echo 'Invalid package name' >&2; exit 2; }
  [[ $package != nvidia-* && $package != linux-image-* ]] || { echo 'WSL supplies the kernel and GPU driver' >&2; exit 2; }
done
payload=${APHRODY_WSL_PAYLOAD:-}
[[ -n $payload ]] || { echo 'APHRODY_WSL_PAYLOAD must name a checksum-qualified product payload' >&2; exit 2; }
payload=$(realpath "$payload")
# Validate before bootstrap: every payload byte is listed, confined and checksummed.
python3 - "$payload" <<'PY'
import hashlib, pathlib, re, stat, sys
root = pathlib.Path(sys.argv[1]).resolve(strict=True)
files = root / 'rootfs'
manifest = root / 'SHA256SUMS'
if not files.is_dir() or not manifest.is_file():
    raise SystemExit('Payload needs rootfs/ and SHA256SUMS')
allowed = ('opt/aphrody/', 'usr/local/bin/', 'usr/local/lib/aphrody/', 'usr/local/share/aphrody/')
seen = set()
for line in manifest.read_text().splitlines():
    match = re.fullmatch(r'([0-9a-fA-F]{64})  ([A-Za-z0-9_./+-]+)', line)
    if not match:
        raise SystemExit('Invalid payload checksum entry')
    digest, name = match.groups()
    path = pathlib.PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or name in seen or not name.startswith(allowed):
        raise SystemExit('Payload manifest path outside product allowlist')
    target = files / name
    if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(files.resolve()):
        raise SystemExit('Manifest entries must be confined regular files')
    if hashlib.file_digest(target.open('rb'), 'sha256').hexdigest().lower() != digest.lower():
        raise SystemExit('Payload checksum mismatch')
    seen.add(name)
for path in files.rglob('*'):
    name = path.relative_to(files).as_posix()
    mode = path.lstat().st_mode
    if stat.S_ISDIR(mode):
        continue
    if not name.startswith(allowed) or path.suffix.lower() in {'.db', '.sqlite', '.sqlite3', '.gguf', '.safetensors'}:
        raise SystemExit('Protected or unrelated payload path rejected')
    if stat.S_ISLNK(mode):
        try:
            target = path.resolve(strict=True)
        except (OSError, RuntimeError):
            raise SystemExit('Invalid payload symlink')
        if not target.is_relative_to(files.resolve()) or not target.is_file():
            raise SystemExit('Payload symlink escapes product staging')
    elif not stat.S_ISREG(mode) or name not in seen:
        raise SystemExit('Unlisted payload file or unsupported file type')
for required in ('usr/local/bin/aphrody', 'usr/local/bin/yolo', 'usr/local/bin/vu', 'usr/local/share/aphrody/qualification.json'):
    if not (files / required).is_file():
        raise SystemExit('Payload lacks required qualified product: ' + required)
PY

mkdir -p "$output_dir"
output_dir=$(realpath "$output_dir")
work=$(mktemp -d "$output_dir/.rootfs.XXXXXX")
rootfs=$work/rootfs
mounted=()
cleanup() {
  local result=$? failed=0 mount
  trap - EXIT
  for ((i=${#mounted[@]}-1; i>=0; i--)); do
    mount=${mounted[i]}
    if mountpoint -q "$rootfs/$mount" && ! umount "$rootfs/$mount"; then failed=1; fi
  done
  if [[ $failed -eq 0 ]]; then
    rm -rf --one-file-system "$work"
  else
    echo "Rootfs retained after unmount failure: $work" >&2
    result=1
  fi
  exit "$result"
}
trap cleanup EXIT

# The installed bootstrap suite table can lag a signed Ubuntu release.
script=/usr/share/debootstrap/scripts/$suite
[[ -e $script ]] || script=/usr/share/debootstrap/scripts/gutsy
debootstrap --variant=minbase --components=main,universe --include=ca-certificates,gnupg,locales,passwd "$suite" "$rootfs" "$mirror" "$script"
cat >"$rootfs/etc/apt/sources.list.d/ubuntu.sources" <<EOF
Types: deb
URIs: $mirror
Suites: $suite $suite-updates $suite-backports
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: https://security.ubuntu.com/ubuntu
Suites: $suite-security
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
: >"$rootfs/etc/apt/sources.list"
install -d -m 0755 "$rootfs/etc/apt/keyrings"
for spec in "${repositories[@]}"; do
  IFS='|' read -r name url repo_suite components fingerprint extra <<<"$spec"
  [[ $name =~ ^[a-z0-9][a-z0-9-]*$ && $url == https://* && $repo_suite =~ ^[a-z][a-z0-9-]*$ && $components =~ ^[a-z0-9\ -]+$ && $fingerprint =~ ^[0-9A-Fa-f]{40}$ && -z ${extra:-} ]] || { echo 'Invalid signed repository specification' >&2; exit 2; }
  keyring=$rootfs/etc/apt/keyrings/$name.gpg
  curl -fsSL "https://keyserver.ubuntu.com/pks/lookup?op=get&options=mr&search=0x$fingerprint" | gpg --dearmor >"$keyring"
  actual=$(gpg --show-keys --with-colons "$keyring" | awk -F: '$1=="fpr" { print $10; exit }')
  [[ ${actual^^} == "${fingerprint^^}" ]] || { echo "$name signing fingerprint mismatch" >&2; exit 1; }
  chmod 0644 "$keyring"
  cat >"$rootfs/etc/apt/sources.list.d/$name.sources" <<EOF
Types: deb
URIs: $url
Suites: $repo_suite
Components: $components
Signed-By: /etc/apt/keyrings/$name.gpg
EOF
done

# Deny service autostart before any package upgrades or product installation.
printf '#!/bin/sh\nexit 101\n' >"$rootfs/usr/sbin/policy-rc.d"
chmod 0755 "$rootfs/usr/sbin/policy-rc.d"
for mount in proc sys dev dev/pts; do
  case $mount in
    proc) mount -t proc proc "$rootfs/proc" ;;
    sys) mount -t sysfs -o ro sys "$rootfs/sys" ;;
    dev|dev/pts) mount --bind "/$mount" "$rootfs/$mount" ;;
  esac
  mounted+=("$mount")
  if [[ $mount == dev || $mount == dev/pts ]]; then mount --make-private "$rootfs/$mount"; fi
done
chroot "$rootfs" env DEBIAN_FRONTEND=noninteractive apt-get update
chroot "$rootfs" env DEBIAN_FRONTEND=noninteractive apt-get -y full-upgrade
chroot "$rootfs" env DEBIAN_FRONTEND=noninteractive apt-get -y install "${packages[@]}"
printf 'en_US.UTF-8 UTF-8\n' >"$rootfs/etc/locale.gen"
chroot "$rootfs" locale-gen
chroot "$rootfs" update-locale LANG=en_US.UTF-8
chroot "$rootfs" groupadd --gid 1000 aphro
chroot "$rootfs" useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash aphro
chroot "$rootfs" passwd --lock aphro
chroot "$rootfs" passwd --lock root
chroot "$rootfs" usermod --append --groups sudo aphro
# Product payload supplies immutable binaries/config, never host authentication or HOME.
cp -a -- "$payload/rootfs/." "$rootfs/"
(cd "$rootfs" && sha256sum -c "$payload/SHA256SUMS")
install -d -m 0755 "$rootfs/usr/local/share/aphrody"
install -m 0644 "$payload/SHA256SUMS" "$rootfs/usr/local/share/aphrody/payload.SHA256SUMS"
cat >"$rootfs/etc/wsl.conf" <<EOF
[boot]
systemd=true
[user]
default=aphro
EOF
cat >"$rootfs/etc/wsl-distribution.conf" <<EOF
[oobe]
defaultName=$distribution
EOF
[[ $(chroot "$rootfs" id -u aphro) == 1000 && $(chroot "$rootfs" id -g aphro) == 1000 ]]
chroot "$rootfs" locale -a | grep -qi '^en_US\.utf8$'
for product in aphrody yolo vu; do
  chroot "$rootfs" runuser -u aphro -- "/usr/local/bin/$product" --version
 done
# shellcheck disable=SC2016 # dpkg-query expands package fields inside the guest.
chroot "$rootfs" dpkg-query -W -f='${Package}=${Version}\n' >"$work/packages.txt"
chroot "$rootfs" apt-get clean
rm -f "$rootfs/usr/sbin/policy-rc.d"
rm -rf "$rootfs"/var/lib/apt/lists/* "$rootfs"/tmp/* "$rootfs"/var/tmp/*
: >"$rootfs/etc/machine-id"
rm -f "$rootfs/var/lib/dbus/machine-id"
for ((i=${#mounted[@]}-1; i>=0; i--)); do umount "$rootfs/${mounted[i]}"; done
mounted=()

tar -C "$rootfs" --numeric-owner --xattrs --acls -czf "$work/$distribution.wsl" .
(cd "$work" && sha256sum "$distribution.wsl" packages.txt > SHA256SUMS)
mv "$work/packages.txt" "$output_dir/packages.txt"
mv "$work/$distribution.wsl" "$output_dir/$distribution.wsl"
mv "$work/SHA256SUMS" "$output_dir/SHA256SUMS"
(cd "$output_dir" && sha256sum -c SHA256SUMS)

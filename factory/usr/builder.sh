#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Runs inside a privileged archlinux container with the job directory at /job.
# Inputs: /job/pacman.conf, /job/packages.txt, /job/overlay/, /job/env (KEYS, KEYSERVER, FALLBACK_KERNEL, VERITY, ...).
set -euo pipefail
source /job/env
out=/job/out root=/job/root
mkdir -p "$out" "$root"
log() { printf '[bun-os-usr] %s\n' "$*"; }

log "builder tools"
pacman-key --init >/dev/null
pacman-key --populate archlinux >/dev/null
pacman -Sy --noconfirm --needed ${BUILDER_PACKAGES} >/dev/null
for key in ${KEYS}; do
  pacman-key --keyserver "${KEYSERVER}" --recv-keys "$key"
  pacman-key --lsign-key "$key"
done

mapfile -t packages </job/packages.txt
pacman --config /job/pacman.conf -Sy >/dev/null
for i in "${!packages[@]}"; do
  if ! pacman --config /job/pacman.conf -Si "${packages[$i]}" >/dev/null 2>&1 \
    && ! pacman --config /job/pacman.conf -Sg "${packages[$i]}" >/dev/null 2>&1; then
    if [ "${packages[$i]}" = linux-cachyos ]; then packages[$i]="${FALLBACK_KERNEL}"; else
      log "missing package: ${packages[$i]}"; exit 3; fi
  fi
done

log "pacstrap ${#packages[@]} targets"
pacstrap -C /job/pacman.conf -c -G -M "$root" "${packages[@]}"
install -Dm644 /job/pacman.conf "$root/etc/pacman.conf"

log "merged-usr hierarchy"
for d in ${USR_DIRS}; do install -d "$root/usr/$d"; done
for pair in ${ROOT_LINKS}; do
  name=${pair%%=*} target=${pair#*=}
  [ -L "$root/$name" ] && [ "$(readlink "$root/$name")" = "$target" ] || { log "bad /$name"; exit 4; }
done
for pair in ${USR_LINKS}; do
  name=${pair%%=*} target=${pair#*=}
  [ -L "$root/usr/$name" ] || { rm -rf "$root/usr/$name"; ln -s "$target" "$root/usr/$name"; }
done

log "Bun OS overlay"
cp -a --no-preserve=ownership /job/overlay/. "$root/"
chmod 0755 "$root/usr/bin/bunsh" "$root/usr/bin/bun-python"
ln -sf ../usr/lib/os-release "$root/etc/os-release"
for p in ${REQUIRED}; do [ -e "$root/$p" ] || { log "missing $p"; exit 5; }; done
"$root/usr/bin/bun" --version >"$out/bun-version.txt"

log "inventory"
pacman -r "$root" -Q >"$out/packages.txt"
pacman -r "$root" -Qi | awk -F': ' '/^Name/{n=$2}/^Licenses/{print n"\t"$2}' >"$out/licenses.tsv"
(cd "$root" && find usr -maxdepth 2 -printf '%y %p%l\n' | sort) >"$out/tree.txt"
du -sb "$root/usr" | cut -f1 >"$out/usr-bytes.txt"
rm -rf "$root"/var/cache/pacman/pkg/* "$root"/var/lib/pacman/sync/*

log "images"
mkfs.erofs -z"${EROFS_COMPRESSION}" -T0 --all-root "$out/usr.erofs" "$root/usr" >/dev/null
mksquashfs "$root/usr" "$out/usr.squashfs" -comp "${SQUASHFS_COMPRESSION}" -all-root -noappend -quiet
if [ "${VERITY}" = 1 ]; then
  veritysetup format "$out/usr.erofs" "$out/usr.erofs.verity" | awk '/Root hash/{print $3}' >"$out/usr.erofs.roothash"
fi
log "rootfs tarball"
tar --zstd --xattrs --acls --numeric-owner -C "$root" -cf "$out/rootfs.tar.zst" .
(cd "$out" && sha256sum usr.erofs usr.squashfs rootfs.tar.zst $( [ "${VERITY}" = 1 ] && echo usr.erofs.verity ) >SHA256SUMS)
rm -rf "$root"
chmod -R a+rX "$out"
ls -l "$out"
log done

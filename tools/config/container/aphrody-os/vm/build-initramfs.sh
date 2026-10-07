#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Assemble a GNU-coreutils-free initramfs: Bun (PID 1 + shell), uutils coreutils,
# sudo-rs and eza, plus the glibc/PAM shared objects they link against.
set -euo pipefail
#
# Inputs (built beforehand, git-ignored):
#   userland/inst/bin/{coreutils,eza,sudo,su,visudo}  cargo install --root userland/inst coreutils --features unix; sudo-rs; eza
#   userland/bun/package/bin/bun                       npm tarball @oven/bun-linux-x64 (needs AVX2: run QEMU with -cpu max)
#   aphrody-init/target/release/aphrody-init           cargo build --release --manifest-path aphrody-init/Cargo.toml
# Kernel: Linux 7.2.x + patches/linux/0001-misc-add-aphrody_runtime-Rust-driver.patch, config
# tinyconfig + aphrody.config (merge_config.sh), make LLVM=1 bzImage, copied to out/bzImage.

ROOT=$(cd "$(dirname "$0")" && pwd)
INST=$ROOT/userland/inst/bin
BUN=$ROOT/userland/bun/package/bin/bun
STAGE=$ROOT/out/rootfs
OUT=$ROOT/out/initramfs.cpio.gz

rm -rf "$STAGE"
mkdir -p "$STAGE"/{usr/bin,usr/sbin,usr/lib/x86_64-linux-gnu/security,sbin,etc/pam.d,etc/sudoers.d,proc,sys,dev,tmp,run,root,home/agent,var/lib,var/run}
ln -s usr/bin "$STAGE/bin"
ln -s usr/lib "$STAGE/lib"
ln -s usr/lib "$STAGE/lib64"

# Binaries.
install -m 0755 "$BUN" "$STAGE/usr/bin/bun"
install -m 0755 "$INST/coreutils" "$STAGE/usr/bin/coreutils"
install -m 0755 "$INST/eza" "$STAGE/usr/bin/eza"
install -m 4755 "$INST/sudo" "$STAGE/usr/bin/sudo"
install -m 4755 "$INST/su" "$STAGE/usr/bin/su"
install -m 0755 "$INST/visudo" "$STAGE/usr/sbin/visudo"
install -m 0755 "$ROOT/rootfs/usr/bin/bunsh" "$STAGE/usr/bin/bunsh"
install -m 0755 "$ROOT/rootfs/sbin/init.ts" "$STAGE/sbin/init.ts"
install -m 0755 "$ROOT/aphrody-init/target/release/aphrody-init" "$STAGE/sbin/init"
ln -s bunsh "$STAGE/usr/bin/sh"

# One symlink per uutils utility (multicall binary).
for util in $("$INST/coreutils" --list); do
	[ -e "$STAGE/usr/bin/$util" ] || ln -s coreutils "$STAGE/usr/bin/$util"
done

# Shared objects: glibc, PAM and whatever the binaries pull in.
copy_deps() {
	{ ldd "$1" 2>/dev/null | grep -oE '/[^ ]+\.so[^ ]*' || true; } | while read -r lib; do
		dest=$STAGE/usr/lib/x86_64-linux-gnu/$(basename "$lib")
		[ -e "$dest" ] || cp -L "$lib" "$dest"
	done
}
for bin in "$BUN" "$INST"/coreutils "$INST"/eza "$INST"/sudo "$INST"/su; do
	copy_deps "$bin"
done
cp -L /lib64/ld-linux-x86-64.so.2 "$STAGE/usr/lib/ld-linux-x86-64.so.2"
for mod in pam_permit.so pam_deny.so pam_env.so; do
	src=/usr/lib/x86_64-linux-gnu/security/$mod
	cp -L "$src" "$STAGE/usr/lib/x86_64-linux-gnu/security/"
	copy_deps "$src"
done

# Identity and policy. "agent" is the unprivileged account autonomous agents run as.
cat > "$STAGE/etc/passwd" <<'EOF'
root:x:0:0:root:/root:/usr/bin/bunsh
agent:x:1000:1000:autonomous agent:/home/agent:/usr/bin/bunsh
EOF
cat > "$STAGE/etc/group" <<'EOF'
root:x:0:
sudo:x:27:agent
agent:x:1000:
EOF
cat > "$STAGE/etc/shadow" <<'EOF'
root:!:20000::::::
agent:!:20000::::::
EOF
chmod 0640 "$STAGE/etc/shadow"
cat > "$STAGE/etc/nsswitch.conf" <<'EOF'
passwd: files
group: files
shadow: files
hosts: files
EOF
echo aphrody > "$STAGE/etc/hostname"
printf '127.0.0.1 localhost aphrody\n' > "$STAGE/etc/hosts"

# sudo-rs policy: yolo mode, the agent account gets root without a password.
cat > "$STAGE/etc/sudoers" <<'EOF'
Defaults env_reset
Defaults secure_path="/usr/sbin:/usr/bin"
root  ALL=(ALL:ALL) ALL
agent ALL=(ALL:ALL) NOPASSWD: ALL
@includedir /etc/sudoers.d
EOF
chmod 0440 "$STAGE/etc/sudoers"

# No human in the loop: PAM accepts every session for sudo/su.
for svc in sudo su sudo-i; do
	cat > "$STAGE/etc/pam.d/$svc" <<'EOF'
auth     required pam_permit.so
account  required pam_permit.so
session  required pam_permit.so
password required pam_deny.so
EOF
done
chown -R 1000:1000 "$STAGE/home/agent"
chmod 1777 "$STAGE/tmp"

# Staged as root, so cpio records root ownership (and the setuid bits) as-is.
(cd "$STAGE" && find . -print0 | cpio --null -o -H newc --quiet | gzip -9) > "$OUT"
du -h "$OUT"

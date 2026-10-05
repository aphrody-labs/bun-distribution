// SPDX-License-Identifier: Apache-2.0
// A minimal Linux image for the app: an initramfs holding a tiny static PID 1, the compiled executable and
// exactly the shared libraries `ldd` lists for it. Boots with any kernel that has an initramfs, a network
// driver and no more (QEMU's user-mode network by default).
//
// Honest limits, measured with `bun build --compile` (Bun 1.4): the executable is NOT static. The glibc targets
// link libc, libm, libdl, libpthread and the loader; the musl targets link musl and libstdc++. So the image is
// "executable + 5 libraries + a 20-line init", not "one file". A fully static executable would need a static Bun
// build, which Bun does not publish. The init is plain C and is built statically (gcc -static or musl-gcc).
import { GENERATED_NOTE, type GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

export const initSource = (c: TargetContext): string => `/* ${GENERATED_NOTE} */
/* PID 1 of the ${c.name} image: mount /proc /sys /dev /tmp, bring up lo and one interface, run the app, power off when it exits.
 * Kernel command line: m3.iface=eth0 m3.ip=10.0.2.15 m3.mask=255.255.255.0 m3.gw=10.0.2.2 (QEMU user-mode defaults). */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/reboot.h>
#include <net/if.h>
#include <net/route.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mount.h>
#include <sys/reboot.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>

static void sockaddr_in_of(struct sockaddr *out, const char *text) {
  struct sockaddr_in *in = (struct sockaddr_in *)out;
  memset(in, 0, sizeof *in);
  in->sin_family = AF_INET;
  inet_pton(AF_INET, text, &in->sin_addr);
}

static void link_up(const char *name, const char *ip, const char *mask) {
  int fd = socket(AF_INET, SOCK_DGRAM, 0);
  struct ifreq req;
  memset(&req, 0, sizeof req);
  strncpy(req.ifr_name, name, IFNAMSIZ - 1);
  sockaddr_in_of(&req.ifr_addr, ip);
  if (ioctl(fd, SIOCSIFADDR, &req) < 0) perror("SIOCSIFADDR");
  sockaddr_in_of(&req.ifr_netmask, mask);
  if (ioctl(fd, SIOCSIFNETMASK, &req) < 0) perror("SIOCSIFNETMASK");
  if (ioctl(fd, SIOCGIFFLAGS, &req) == 0) {
    req.ifr_flags |= IFF_UP | IFF_RUNNING;
    if (ioctl(fd, SIOCSIFFLAGS, &req) < 0) perror("SIOCSIFFLAGS");
  }
  close(fd);
}

static void default_route(const char *gateway, const char *name) {
  int fd = socket(AF_INET, SOCK_DGRAM, 0);
  struct rtentry route;
  memset(&route, 0, sizeof route);
  sockaddr_in_of(&route.rt_gateway, gateway);
  sockaddr_in_of(&route.rt_dst, "0.0.0.0");
  sockaddr_in_of(&route.rt_genmask, "0.0.0.0");
  route.rt_flags = RTF_UP | RTF_GATEWAY;
  route.rt_dev = (char *)name;
  if (ioctl(fd, SIOCADDRT, &route) < 0) perror("SIOCADDRT");
  close(fd);
}

/* Value of "key=value" on /proc/cmdline, or the fallback. */
static const char *cmdline(const char *key, const char *fallback) {
  static char buffer[4096];
  static int loaded;
  if (!loaded) {
    int fd = open("/proc/cmdline", O_RDONLY);
    ssize_t n = fd >= 0 ? read(fd, buffer, sizeof buffer - 1) : 0;
    buffer[n > 0 ? n : 0] = 0;
    if (fd >= 0) close(fd);
    loaded = 1;
  }
  static char value[128];
  char needle[64];
  snprintf(needle, sizeof needle, "%s=", key);
  char *at = strstr(buffer, needle);
  if (!at) return fallback;
  at += strlen(needle);
  size_t len = strcspn(at, " \\n");
  if (len >= sizeof value) len = sizeof value - 1;
  memcpy(value, at, len);
  value[len] = 0;
  return value;
}

int main(void) {
  mount("proc", "/proc", "proc", 0, NULL);
  mount("sysfs", "/sys", "sysfs", 0, NULL);
  mount("devtmpfs", "/dev", "devtmpfs", 0, NULL);
  mount("tmpfs", "/tmp", "tmpfs", 0, NULL);

  link_up("lo", "127.0.0.1", "255.0.0.0");
  char iface[32], ip[32], mask[32], gw[32];
  snprintf(iface, sizeof iface, "%s", cmdline("m3.iface", "eth0"));
  snprintf(ip, sizeof ip, "%s", cmdline("m3.ip", "10.0.2.15"));
  snprintf(mask, sizeof mask, "%s", cmdline("m3.mask", "255.255.255.0"));
  snprintf(gw, sizeof gw, "%s", cmdline("m3.gw", "10.0.2.2"));
  link_up(iface, ip, mask);
  default_route(gw, iface);

  setenv("PORT", cmdline("m3.port", "${c.port}"), 1);
  setenv("HOST", "0.0.0.0", 1);
  setenv("HOME", "/tmp", 1);

  pid_t app = fork();
  if (app == 0) {
    char *argv[] = {"/app/server", NULL};
    execv(argv[0], argv);
    perror("exec /app/server");
    _exit(127);
  }
  for (;;) {
    int status;
    pid_t done = wait(&status);
    if (done == app) break;
    if (done < 0 && errno != EINTR) break;
  }
  sync();
  reboot(LINUX_REBOOT_CMD_POWER_OFF);
  return 0;
}
`;

export const buildScript = (c: TargetContext): string => `#!/usr/bin/env bash
# ${GENERATED_NOTE}
# Assemble the ${c.name} image from a compiled Linux executable:
#   ${c.cli} compile --target linux-x64 --outfile bin/${c.binary}
#   ./build-image.sh bin/${c.binary} [outdir]
# Writes <outdir>/rootfs (the tree), initramfs.cpio.gz (boot it) and rootfs.tar (docker import / FROM scratch ADD).
set -euo pipefail
BIN=\${1:?usage: build-image.sh <compiled-linux-executable> [outdir]}
OUT=\${2:-image}
HERE=$(cd "$(dirname "$0")" && pwd)

rm -rf "$OUT"
mkdir -p "$OUT/rootfs/app" "$OUT/rootfs/proc" "$OUT/rootfs/sys" "$OUT/rootfs/dev" "$OUT/rootfs/tmp" "$OUT/rootfs/etc"
cp "$BIN" "$OUT/rootfs/app/server"
chmod 0755 "$OUT/rootfs/app/server"

# The executable is dynamic: copy every library ldd lists, at the same absolute path (dereferencing symlinks).
for lib in $(ldd "$BIN" | awk '/=> \\//{print $3} /^[[:space:]]*\\//{print $1}'); do
  cp --parents -L "$lib" "$OUT/rootfs"
done

# PID 1: static, so it needs nothing from the tree.
if command -v musl-gcc >/dev/null 2>&1; then CC=musl-gcc; else CC=\${CC:-cc}; fi
"$CC" -static -Os -o "$OUT/rootfs/init" "$HERE/init.c"

printf 'root:x:0:0:root:/tmp:/app/server\\n' > "$OUT/rootfs/etc/passwd"
printf '127.0.0.1 localhost\\n' > "$OUT/rootfs/etc/hosts"

(cd "$OUT/rootfs" && find . | cpio -o -H newc --quiet | gzip -9) > "$OUT/initramfs.cpio.gz"
tar -C "$OUT/rootfs" -cf "$OUT/rootfs.tar" .
du -sh "$OUT/rootfs" "$OUT/initramfs.cpio.gz" | sed 's/^/size: /'
`;

export const qemuScript = (c: TargetContext): string => `#!/usr/bin/env bash
# ${GENERATED_NOTE}
# Boot the image in QEMU and forward host port 8080 to the app. KERNEL must be a Linux bzImage with an initramfs,
# virtio or e1000 networking and devtmpfs (a distro kernel; /boot/vmlinuz-* on a regular host).
# Bun needs the AVX2-era instruction set: QEMU's default CPU lacks it (the app dies with "invalid opcode"), so the
# script uses the host CPU under KVM and \`-cpu max\` under software emulation (slower, but boots in seconds).
set -euo pipefail
KERNEL=\${KERNEL:-/boot/vmlinuz-$(uname -r)}
INITRD=\${1:-image/initramfs.cpio.gz}
[ -r "$KERNEL" ] || { echo "set KERNEL to a readable Linux kernel image (not found: $KERNEL)" >&2; exit 1; }
if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then CPU=(-enable-kvm -cpu host); else CPU=(-cpu "\${QEMU_CPU:-max}"); fi
exec qemu-system-x86_64 -m 512 -nographic -no-reboot "\${CPU[@]}" \\
  -kernel "$KERNEL" -initrd "$INITRD" \\
  -append "console=ttyS0 panic=1 quiet m3.port=${c.port}" \\
  -nic user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:\${HOST_PORT:-8080}-:${c.port}
`;

export const readme = (c: TargetContext): string => `# ${c.name}: minimal Linux image

${GENERATED_NOTE}

What it is: an initramfs with \`/init\` (a static PID 1 written in C), \`/app/server\` (the compiled ${c.name}) and the shared
libraries of that executable. Roughly 90 MB, almost all of it the Bun runtime inside the executable.

What it is not: a one-file or "no libc" image. \`bun build --compile\` produces a dynamic executable: glibc targets need
libc, libm, libdl, libpthread and the loader; \`-musl\` targets need musl and libstdc++. Bun publishes no static build, so the
libraries ship in the image. The init is the only static binary.

\`\`\`sh
${c.cli} compile --target linux-x64 --outfile bin/${c.binary}
./build-image.sh bin/${c.binary}          # -> image/{rootfs,initramfs.cpio.gz,rootfs.tar}
KERNEL=/boot/vmlinuz-6.8.0-generic ./run-qemu.sh   # on WSL: KERNEL="/mnt/c/Program Files/WSL/tools/kernel"
curl -s http://127.0.0.1:8080/healthz
\`\`\`

\`rootfs.tar\` also works as \`docker import image/rootfs.tar ${c.image}:${c.version}\`.
`;

export const linuxImage: Target = {
  id: "linux-image",
  title: "Minimal Linux image",
  description: "initramfs recipe: static C init, the executable and its ldd libraries; QEMU runner; README with the honest limits",
  generate(c): GeneratedFile[] {
    return [
      { path: "README.md", content: readme(c) },
      { path: "init.c", content: initSource(c) },
      { path: "build-image.sh", content: buildScript(c), mode: 0o755 },
      { path: "run-qemu.sh", content: qemuScript(c), mode: 0o755 },
    ];
  },
};

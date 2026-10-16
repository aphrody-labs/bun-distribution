// SPDX-License-Identifier: Apache-2.0
// A minimal Linux image for the app, built by `scripts/aphrody/initramfs.ts` of the aphrody-labs/bun fork: the
// compiled executable is the only Bun in the image. Installed as /bin/bun it is plain Bun (the fork treats a compiled
// executable called `bun` as the engine) and runs /init, the fork's TypeScript PID 1 on `bun:linux` (mounts, kernel
// modules, network over rtnetlink with a static address or DHCP, orphan reaping, power-off); /init then starts the
// same file under the app's name, which boots the compiled app.
//
// Honest limits, measured with `bun build --compile` (Bun 1.4): the executable is NOT static. The glibc targets link
// libc, libm, libdl, libpthread and the loader; the musl targets link musl and libstdc++. initramfs.ts copies them
// (PT_INTERP and DT_NEEDED read from the ELF, resolved under SYSROOT). The executable must come from a fork build that
// has `bun:linux`; build-image.sh checks it before assembling anything.
import { GENERATED_NOTE, type GeneratedFile } from "../util.ts";
import type { Target, TargetContext } from "./types.ts";

export const INITRAMFS_SCRIPTS = [
  "initramfs.ts",
  "initramfs-init.ts",
  "initramfs-net.ts",
] as const;

export const buildScript = (c: TargetContext): string => `#!/usr/bin/env bash
# ${GENERATED_NOTE}
# Assemble the ${c.name} image from a compiled Linux executable:
#   ${c.cli} compile --target linux-x64 --outfile bin/${c.binary}
#   ./build-image.sh bin/${c.binary} [outdir]          # -> <outdir>/initramfs.cpio.gz
# Environment:
#   BUN_SRC   aphrody-labs/bun checkout providing scripts/aphrody/initramfs*.ts (default: fetched from BUN_REF)
#   BUN_REF   git ref fetched when BUN_SRC is unset (default: main)
#   INITRAMFS_ARGS   extra initramfs.ts arguments, split on spaces (e.g. --file host:/target)
#   SYSROOT   where the executable's loader and libraries are taken from (default: /)
#   M3_IP     dhcp, or a static address with prefix (default: 10.0.2.15/24, QEMU user-mode network)
#   M3_GW, M3_DNS   gateway and resolver of a static address (default: 10.0.2.2 and 10.0.2.3)
#   MODULES   kernel modules loaded before the network, dependencies first (default: failover, net_failover and
#             virtio_net of /lib/modules/$(uname -r) when they are modules there)
set -euo pipefail
BIN=\${1:?usage: build-image.sh <compiled-linux-executable> [outdir]}
OUT=\${2:-image}
SYSROOT=\${SYSROOT:-/}
M3_IP=\${M3_IP:-10.0.2.15/24}

if ! BUN_BE_BUN=1 "$BIN" -e 'require("bun:linux")' >/dev/null 2>&1; then
  echo "$BIN has no bun:linux: compile it with an aphrody-labs/bun build that has it" >&2
  exit 1
fi

if [ -n "\${BUN_SRC:-}" ]; then
  SRC="$BUN_SRC/scripts/aphrody"
else
  SRC=$(mktemp -d)
  trap 'rm -rf "$SRC"' EXIT
  for f in ${INITRAMFS_SCRIPTS.join(" ")}; do
    curl -fsSL -o "$SRC/$f" "https://raw.githubusercontent.com/aphrody-labs/bun/\${BUN_REF:-main}/scripts/aphrody/$f"
  done
fi

if [ -z "\${MODULES+x}" ]; then
  MODULES=""
  for m in kernel/net/core/failover kernel/drivers/net/net_failover kernel/drivers/net/virtio/virtio_net kernel/drivers/net/virtio_net; do
    for f in "/lib/modules/$(uname -r)/$m".ko*; do [ -e "$f" ] && MODULES="$MODULES $f"; done
  done
fi

args=(--bun "$BIN" --argv0 ${c.binary} --sysroot "$SYSROOT" --hostname ${c.name} --ip "$M3_IP")
if [ "$M3_IP" != dhcp ]; then args+=(--gateway "\${M3_GW:-10.0.2.2}" --dns "\${M3_DNS:-10.0.2.3}"); fi
for m in $MODULES; do args+=(--module "$m"); done
args+=(--env PORT=${c.port} --env HOST=0.0.0.0)
# shellcheck disable=SC2206
args+=(\${INITRAMFS_ARGS:-})

mkdir -p "$OUT"
bun "$SRC/initramfs.ts" "\${args[@]}" --out "$OUT/initramfs.cpio.gz" -- /bin/bun
du -sh "$OUT/initramfs.cpio.gz" | sed 's/^/size: /'
`;

export const qemuScript = (c: TargetContext): string => `#!/usr/bin/env bash
# ${GENERATED_NOTE}
# Boot the image in QEMU and forward host port 8080 to the app. KERNEL must be a Linux bzImage with an initramfs,
# devtmpfs and virtio networking, built in or passed to build-image.sh as MODULES from the same kernel release.
# Bun needs the AVX2-era instruction set: QEMU's default CPU lacks it (the app dies with "invalid opcode"), so the
# script uses the host CPU under KVM and \`-cpu max\` under software emulation (slower, but boots in seconds).
set -euo pipefail
KERNEL=\${KERNEL:-/boot/vmlinuz-$(uname -r)}
INITRD=\${1:-image/initramfs.cpio.gz}
[ -r "$KERNEL" ] || { echo "set KERNEL to a readable Linux kernel image (not found: $KERNEL)" >&2; exit 1; }
if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then CPU=(-enable-kvm -cpu host); else CPU=(-cpu "\${QEMU_CPU:-max}"); fi
exec qemu-system-x86_64 -m 512 -nographic -no-reboot "\${CPU[@]}" \\
  -kernel "$KERNEL" -initrd "$INITRD" \\
  -append "console=ttyS0 panic=1 quiet" \\
  -nic user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:\${HOST_PORT:-8080}-:${c.port}
`;

export const readme = (
  c: TargetContext,
): string => `# ${c.name}: minimal Linux image

${GENERATED_NOTE}

What it is: an initramfs built by \`scripts/aphrody/initramfs.ts\` of the aphrody-labs/bun fork. It holds \`/bin/bun\`
(the compiled ${c.name}, the only Bun in the image), \`/init\` (the fork's TypeScript PID 1 on \`bun:linux\`), the shared
libraries of the executable and, when needed, the kernel's network modules. \`/init\` mounts the pseudo file systems,
loads the modules, configures the network (static address or DHCP, default route, \`/etc/resolv.conf\`), starts the app
with PORT=${c.port} and HOST=0.0.0.0, and powers the machine off when it exits.

What it is not: a one-file or "no libc" image. \`bun build --compile\` produces a dynamic executable: glibc targets need
libc, libm, libdl, libpthread and the loader; \`-musl\` targets need musl and libstdc++. Bun publishes no static build, so the
libraries ship in the image. The executable must be compiled by a fork build that has \`bun:linux\`. The network settings
are fixed when the image is built (\`M3_IP\`, \`M3_GW\`, \`M3_DNS\` of build-image.sh). For a container, use the docker
target.

\`\`\`sh
${c.cli} compile --target linux-x64 --outfile bin/${c.binary}
./build-image.sh bin/${c.binary}          # -> image/initramfs.cpio.gz
KERNEL=/boot/vmlinuz-$(uname -r) ./run-qemu.sh
curl -s http://127.0.0.1:8080/healthz
\`\`\`
`;

export const linuxImage: Target = {
  id: "linux-image",
  title: "Minimal Linux image",
  description:
    "initramfs from the fork's scripts/aphrody/initramfs.ts: the executable as the only Bun, the bun:linux PID 1, its libraries; QEMU runner; README with the honest limits",
  generate(c): GeneratedFile[] {
    return [
      { path: "README.md", content: readme(c) },
      { path: "build-image.sh", content: buildScript(c), mode: 0o755 },
      { path: "run-qemu.sh", content: qemuScript(c), mode: 0o755 },
    ];
  },
};

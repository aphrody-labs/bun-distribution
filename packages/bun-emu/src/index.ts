import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type TargetId =
  "android" | "nds" | "ps2" | "arm-bios" | "linux" | "windows";

export interface RunOptions {
  image?: string;
  arch?: "x86_64" | "arm64";
  memory?: string;
  avd?: string;
  extra: string[];
}

export interface Target {
  id: TargetId;
  title: string;
  /** Executable names tried in order, after the BUN_EMU_<ID> override. */
  tools: string[];
  /** Input the caller must supply (never bundled). */
  needs: string;
  command(tool: string, o: RunOptions): string[];
}

const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(process.env.LOCALAPPDATA ?? homedir(), "Android", "Sdk");
const mem = (o: RunOptions, d: string) => o.memory ?? d;
const need = (o: RunOptions, what: string): string => {
  if (!o.image) throw new Error(`missing image: ${what}`);
  return o.image;
};

const qemuTools = (arch: RunOptions["arch"]) => [
  arch === "arm64" ? "qemu-system-aarch64" : "qemu-system-x86_64",
];
const accel =
  process.platform === "win32"
    ? "whpx,kernel-irqchip=off:tcg"
    : process.platform === "darwin"
      ? "hvf:tcg"
      : "kvm:tcg";

export const targets: Record<TargetId, Target> = {
  android: {
    id: "android",
    title: "Android (AVD)",
    tools: [join(sdk, "emulator", "emulator"), "emulator"],
    needs: "an AVD name (default: first AVD found)",
    command: (tool, o) => [
      tool,
      "-avd",
      o.avd ?? o.image ?? "bun_pixel_api37",
      ...o.extra,
    ],
  },
  nds: {
    id: "nds",
    title: "Nintendo DS/DSi",
    tools: ["melonDS", "melonds", "dust"],
    needs: "a .nds ROM (firmware and BIOS caller-supplied)",
    command: (tool, o) => [tool, need(o, ".nds ROM"), ...o.extra],
  },
  ps2: {
    id: "ps2",
    title: "PlayStation 2",
    tools: ["pcsx2-qt", "pcsx2"],
    needs: "an ISO/CHD image and a caller-supplied PS2 BIOS",
    command: (tool, o) => [
      tool,
      "-batch",
      ...o.extra,
      "--",
      need(o, "PS2 ISO/CHD"),
    ],
  },
  "arm-bios": {
    id: "arm-bios",
    title: "ARM firmware/BIOS (virt board)",
    tools: qemuTools("arm64"),
    needs: "an AArch64 firmware or kernel image (UEFI, U-Boot, BIOS)",
    command: (tool, o) => [
      tool,
      "-M",
      "virt",
      "-cpu",
      "max",
      "-m",
      mem(o, "1G"),
      "-nographic",
      "-bios",
      need(o, "firmware"),
      ...o.extra,
    ],
  },
  linux: {
    id: "linux",
    title: "Linux guest",
    tools: ["qemu-system-x86_64", "qemu-system-aarch64"],
    needs:
      "a disk image or ISO (default arch x86_64, --arch arm64 for AArch64)",
    command: (_tool, o) => {
      const img = need(o, "Linux disk image or ISO");
      const disk = /\.iso$/i.test(img)
        ? ["-cdrom", img]
        : ["-drive", `file=${img},if=virtio`];
      return o.arch === "arm64"
        ? [
            "qemu-system-aarch64",
            "-M",
            "virt",
            "-accel",
            accel,
            "-cpu",
            "max",
            "-m",
            mem(o, "4G"),
            "-device",
            "virtio-gpu-pci",
            "-device",
            "qemu-xhci",
            "-device",
            "usb-kbd",
            "-device",
            "usb-tablet",
            ...disk,
            ...o.extra,
          ]
        : [
            "qemu-system-x86_64",
            "-machine",
            "q35",
            "-accel",
            accel,
            "-cpu",
            "max",
            "-m",
            mem(o, "4G"),
            "-smp",
            "4",
            "-device",
            "virtio-vga",
            "-device",
            "qemu-xhci",
            "-device",
            "usb-tablet",
            ...disk,
            ...o.extra,
          ];
    },
  },
  windows: {
    id: "windows",
    title: "Windows guest",
    tools: ["qemu-system-x86_64"],
    needs: "a Windows disk image or install ISO (licence caller-supplied)",
    command: (tool, o) => {
      const img = need(o, "Windows disk image or ISO");
      const disk = /\.iso$/i.test(img)
        ? ["-cdrom", img]
        : ["-drive", `file=${img},if=ide`];
      return [
        tool,
        "-machine",
        "q35",
        "-accel",
        accel,
        "-cpu",
        "max",
        "-m",
        mem(o, "8G"),
        "-smp",
        "4",
        "-vga",
        "std",
        "-device",
        "qemu-xhci",
        "-device",
        "usb-tablet",
        "-rtc",
        "base=localtime",
        ...disk,
        ...o.extra,
      ];
    },
  },
};

export function resolveTool(t: Target): string | undefined {
  const override =
    process.env[`BUN_EMU_${t.id.toUpperCase().replace("-", "_")}`];
  if (override) return existsSync(override) ? override : undefined;
  for (const name of t.tools) {
    const hit =
      name.includes("/") || name.includes("\\")
        ? existsSync(name) || existsSync(`${name}.exe`)
          ? name
          : undefined
        : Bun.which(name);
    if (hit) return hit;
  }
  return undefined;
}

export function plan(id: TargetId, o: RunOptions): string[] {
  const t = targets[id];
  const tool = resolveTool(t);
  if (!tool)
    throw new Error(
      `no backend for ${id}: install one of ${t.tools.join(", ")} or set BUN_EMU_${id.toUpperCase().replace("-", "_")}`,
    );
  const argv = t.command(tool, o);
  if (id === "linux" || id === "windows") argv[0] = Bun.which(argv[0]!) ?? tool;
  return argv;
}

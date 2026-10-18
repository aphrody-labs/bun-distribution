// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";

interface V86Instance {
  add_listener(event: string, fn: (...args: unknown[]) => void): void;
  destroy(): void | Promise<void>;
  run(): void;
  stop(): Promise<void> | void;
  restart(): void;
  is_running(): boolean;
  keyboard_send_scancodes(codes: number[]): void;
  keyboard_set_status?(enabled: boolean): void;
}
type V86Ctor = new (options: Record<string, unknown>) => V86Instance;

interface VmManifest {
  v86: string;
  alpine: string;
  iso: string;
  isoBytes: number;
}

/**
 * Alpine Linux (x86, 32-bit) booted by v86, the x86 emulator that JIT-compiles to WebAssembly. The ISO streams from
 * the edge with Range requests (only the sectors Linux reads are downloaded), so first boot needs no full download.
 */
export async function linuxApp(root: HTMLElement) {
  const manifest = (await (await fetch("/vm/manifest.json")).json()) as VmManifest;
  const screen = h("div", { class: "vm-screen" }, h("div", {}), h("canvas", {}));
  const status = h(
    "div",
    { class: "files-status" },
    `Alpine Linux ${manifest.alpine} · v86 ${manifest.v86} · log in as root (no password)`,
  );
  let vm: V86Instance | undefined;

  const stage = h("div", { class: "vm-stage" });
  const start = async () => {
    start$.disabled = true;
    status.textContent = "Starting… the first boot reads the disk image from the network on demand.";
    try {
      const url = "/vm/libv86.mjs";
      const mod = (await import(/* @vite-ignore */ url)) as { V86: V86Ctor };
      stage.replaceChildren(screen);
      const instance = new mod.V86({
        wasm_path: "/vm/v86.wasm",
        memory_size: 256 * 1024 * 1024,
        vga_memory_size: 8 * 1024 * 1024,
        screen_container: screen,
        bios: { url: "/vm/bios/seabios.bin" },
        vga_bios: { url: "/vm/bios/vgabios.bin" },
        cdrom: { url: `/vm/alpine.iso?v=${manifest.alpine}`, async: true, size: manifest.isoBytes },
        boot_order: 0x123,
        autostart: true,
        disable_speaker: true,
      });
      vm = instance;
      instance.add_listener(
        "emulator-started",
        () => (status.textContent = "Running. Click the screen to type; Alpine login is root with no password."),
      );
      instance.add_listener("download-progress", (...args) => {
        const e = args[0] as { file_name?: string; loaded?: number; total?: number } | undefined;
        if (e?.total && e.loaded !== undefined)
          status.textContent = `Reading ${e.file_name ?? "disk"} · ${Math.round((e.loaded / e.total) * 100)}%`;
      });
      screen.addEventListener("click", () => screen.querySelector("canvas")?.focus());
      pause$.disabled = reset$.disabled = cad$.disabled = false;
    } catch (error) {
      status.textContent = `The Linux machine could not start: ${String((error as Error).message ?? error)}`;
      start$.disabled = false;
    }
  };

  const start$ = h("button", { class: "btn", onclick: () => void start() }, "Start Linux") as HTMLButtonElement;
  const pause$ = h(
    "button",
    {
      class: "btn tonal",
      disabled: true,
      onclick: async () => {
        if (!vm) return;
        if (vm.is_running()) {
          await vm.stop();
          pause$.textContent = "Resume";
        } else {
          vm.run();
          pause$.textContent = "Pause";
        }
      },
    },
    "Pause",
  ) as HTMLButtonElement;
  const reset$ = h(
    "button",
    { class: "btn tonal", disabled: true, onclick: () => vm?.restart() },
    "Restart",
  ) as HTMLButtonElement;
  const cad$ = h(
    "button",
    {
      class: "btn tonal",
      disabled: true,
      onclick: () => vm?.keyboard_send_scancodes([0x1d, 0x38, 0x53, 0xd3, 0xb8, 0x9d]),
    },
    "Ctrl+Alt+Del",
  ) as HTMLButtonElement;

  stage.append(
    h("div", { class: "empty" }, "A real Alpine Linux, running in your browser. Nothing is installed on your device."),
  );
  root.append(
    h("div", { class: "store" }, h("div", { class: "files-bar" }, start$, pause$, reset$, cad$), stage, status),
  );
  root.addEventListener("remove", () => void vm?.destroy());
}

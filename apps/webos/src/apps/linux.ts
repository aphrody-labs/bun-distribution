// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { HOME, webos } from "../os";
import type { WebOs } from "@aphrody/webos-wasm";
import css from "./linux.css" with { type: "text" };

/*
 * Alpine Linux (x86, 32-bit) booted by v86, the x86 emulator that JIT-compiles to WebAssembly. The ISO streams
 * from the edge with Range requests, so first boot needs no full download. On top of that this app adds:
 *  - persistence: v86 save_state() gzip-compressed into OPFS, restored on the next start (the ISO is a live system,
 *    so the machine state, not a disk, is what survives);
 *  - a shared folder: the 9p device of v86 mirrors /home/user/Shared of the Rust VFS, copied in both directions
 *    on demand (v86 has no live host file hook), mounted in the guest at /mnt/host;
 *  - a serial console (ttyS0) with its own input line, started from the guest shell on request;
 *  - auto-login, keyboard capture scoped to the VM, and a clipboard bridge.
 */

interface Fs9p {
  SearchPath(path: string): { id: number; parentid: number; name: string };
  CreateDirectory(name: string, parentid: number): number;
  IsDirectory(id: number): boolean;
  read_dir(path: string): string[] | undefined;
  read_file(path: string): Promise<Uint8Array | null>;
}

interface V86Instance {
  add_listener(event: string, fn: (...args: unknown[]) => void): void;
  destroy(): void | Promise<void>;
  run(): void;
  stop(): Promise<void> | void;
  restart(): void;
  is_running(): boolean;
  keyboard_send_scancodes(codes: number[]): void;
  keyboard_send_text(text: string, delay?: number): Promise<void>;
  keyboard_set_status(enabled: boolean): void;
  mouse_set_status(enabled: boolean): void;
  serial0_send(text: string): void;
  save_state(): Promise<ArrayBuffer>;
  restore_state(state: ArrayBuffer): Promise<void>;
  create_file(path: string, data: Uint8Array): Promise<void>;
  wait_until_vga_screen_contains(text: string): Promise<void>;
  screen_set_scale(x: number, y: number): void;
  fs9p?: Fs9p;
}
type V86Ctor = new (options: Record<string, unknown>) => V86Instance;

interface VmManifest {
  v86: string;
  alpine: string;
  iso: string;
  isoBytes: number;
}

export const SHARED_DIR = `${HOME}/Shared`;
/** Where the guest sees the shared folder. */
export const GUEST_MOUNT = "/mnt/host";
const MAX_SHARED_FILE = 8 * 1024 * 1024;
const MAX_SHARED_TOTAL = 48 * 1024 * 1024;
const AUTOSAVE_MS = 3 * 60 * 1000;
const SERIAL_KEEP = 64 * 1024;

const pref = {
  get: (key: string, fallback: boolean) => {
    try {
      const v = localStorage.getItem(`webos.vm.${key}`);
      return v === null ? fallback : v === "1";
    } catch {
      return fallback;
    }
  },
  set: (key: string, value: boolean) => {
    try {
      localStorage.setItem(`webos.vm.${key}`, value ? "1" : "0");
    } catch {
      // Storage unavailable: preferences last for this session.
    }
  },
};

type OpfsDir = {
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{ getFile(): Promise<File>; createWritable(): Promise<WritableStream<Uint8Array>> }>;
  removeEntry(name: string): Promise<void>;
};
const opfs = async () => (await (navigator.storage as unknown as { getDirectory(): Promise<OpfsDir> }).getDirectory());

async function readState(name: string): Promise<ArrayBuffer | null> {
  try {
    const file = await (await opfs()).getFileHandle(name);
    return await new Response((await file.getFile()).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  } catch {
    return null;
  }
}

async function writeState(name: string, state: ArrayBuffer): Promise<number> {
  const file = await (await opfs()).getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await new Blob([state]).stream().pipeThrough(new CompressionStream("gzip")).pipeTo(writable);
  return (await file.getFile()).size;
}

async function stateSize(name: string): Promise<number | null> {
  try {
    return (await (await (await opfs()).getFileHandle(name)).getFile()).size;
  } catch {
    return null;
  }
}

const mib = (n: number) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MiB`;

function joinPath(a: string, b: string) {
  return `${a.replace(/\/$/, "")}/${b}`;
}

/** Create the directory chain in the 9p filesystem; returns the id of the last one. */
function mkdirs9p(fs: Fs9p, path: string): number {
  let id = 0;
  let at = "";
  for (const part of path.split("/").filter(Boolean)) {
    at = `${at}/${part}`;
    const found = fs.SearchPath(at);
    id = found.id !== -1 ? found.id : fs.CreateDirectory(part, id);
  }
  return id;
}

/** Copy the VFS shared folder into the 9p filesystem (the guest sees it at GUEST_MOUNT). */
async function pushShared(os: WebOs, vm: V86Instance): Promise<{ files: number; bytes: number; skipped: number }> {
  const fs = vm.fs9p;
  if (!fs) throw new Error("the 9p device is not available");
  try {
    os.fs.mkdir(SHARED_DIR);
  } catch {
    // Already exists.
  }
  const stats = { files: 0, bytes: 0, skipped: 0 };
  const walk = async (vfsDir: string, guestDir: string) => {
    mkdirs9p(fs, guestDir);
    for (const e of JSON.parse(os.fs.list(vfsDir)) as { name: string; kind: string; size: number }[]) {
      const from = joinPath(vfsDir, e.name);
      const to = joinPath(guestDir, e.name);
      if (e.kind === "dir") await walk(from, to);
      else if (e.size > MAX_SHARED_FILE || stats.bytes + e.size > MAX_SHARED_TOTAL) stats.skipped++;
      else {
        await vm.create_file(to, os.fs.read(from));
        stats.files++;
        stats.bytes += e.size;
      }
    }
  };
  await walk(SHARED_DIR, "/");
  return stats;
}

/** Copy the 9p filesystem into the VFS shared folder (files that exist on both sides are overwritten). */
async function pullShared(os: WebOs, vm: V86Instance): Promise<{ files: number; bytes: number; skipped: number }> {
  const fs = vm.fs9p;
  if (!fs) throw new Error("the 9p device is not available");
  const stats = { files: 0, bytes: 0, skipped: 0 };
  os.fs.mkdir(SHARED_DIR);
  const walk = async (guestDir: string, vfsDir: string) => {
    os.fs.mkdir(vfsDir);
    for (const name of fs.read_dir(guestDir) ?? []) {
      const from = joinPath(guestDir, name);
      const to = joinPath(vfsDir, name);
      const node = fs.SearchPath(from);
      if (node.id === -1) continue;
      if (fs.IsDirectory(node.id)) await walk(from, to);
      else {
        const data = await fs.read_file(from);
        if (!data || data.byteLength > MAX_SHARED_FILE || stats.bytes + data.byteLength > MAX_SHARED_TOTAL) {
          stats.skipped++;
          continue;
        }
        os.fs.write(to, data);
        stats.files++;
        stats.bytes += data.byteLength;
      }
    }
  };
  await walk("/", SHARED_DIR);
  await os.flush();
  return stats;
}

/** Alpine Linux in v86 with saved machine state, shared folder, serial console and clipboard bridge. */
export async function linuxApp(root: HTMLElement) {
  const manifest = (await (await fetch("/vm/manifest.json")).json()) as VmManifest;
  const os = await webos();
  if (!document.getElementById("vm-css")) document.head.append(h("style", { id: "vm-css" }, css));
  const stateName = `alpine-${manifest.alpine}-v86-${manifest.v86}.state.gz`;

  const screen = h("div", { class: "vm-screen" }, h("div", {}), h("canvas", {}));
  const stage = h("div", { class: "vm-stage", tabindex: 0, "data-capture-keys": "1" });
  const status = h("div", { class: "files-status vm-status" });
  const serialOut = h("pre", { class: "vm-serial-out" });
  const serialIn = h("input", { class: "vm-serial-in", placeholder: "Serial console (ttyS0): type a command, Enter", spellcheck: "false" });
  const serialBox = h("div", { class: "vm-serial", hidden: true }, serialOut, serialIn);
  let vm: V86Instance | undefined;
  let busy = false;
  let loggedIn = false;
  let serialWanted = false;
  let serialLoggedIn = false;
  let autosave: ReturnType<typeof setInterval> | undefined;
  let watch: ReturnType<typeof setInterval> | undefined;
  let scale = 1;
  const say = (text: string) => (status.textContent = text);

  const refreshSaved = async () => {
    const size = await stateSize(stateName);
    start$.textContent = size ? "Resume Linux" : "Start Linux";
    drop$.disabled = !size;
    return size;
  };

  /** Type into the guest console; waits for each line so slow guests do not drop characters. */
  const typeText = async (text: string) => {
    if (!vm) return;
    // v86 ignores simulated keys while capture is off, so open it for the duration of the typing.
    vm.keyboard_set_status(true);
    try {
      await vm.keyboard_send_text(text, 4);
    } finally {
      vm?.keyboard_set_status(stage.classList.contains("capturing"));
    }
  };
  const typeLine = async (text: string) => {
    await typeText(`${text}
`);
    await new Promise(r => setTimeout(r, 250));
  };

  const saveState = async (reason: string) => {
    if (!vm || busy) return;
    busy = true;
    const wasRunning = vm.is_running();
    try {
      say(`Saving the machine (${reason})…`);
      const buffer = await vm.save_state();
      const bytes = await writeState(stateName, buffer);
      say(`Saved ${mib(bytes)} compressed in this browser. Start Linux resumes exactly here.`);
      void refreshSaved();
    } catch (error) {
      say(`Could not save the machine: ${String((error as Error).message ?? error)}`);
    } finally {
      busy = false;
      if (wasRunning && vm && !vm.is_running()) vm.run();
    }
  };

  const teardown = async () => {
    clearInterval(autosave);
    clearInterval(watch);
    const current = vm;
    vm = undefined;
    if (!current) return;
    try {
      if (!loggedIn) throw new Error("not logged in: keep the previous state");
      const buffer = await current.save_state();
      await writeState(stateName, buffer);
    } catch {
      // Closing: a failed final save keeps the previous one.
    }
    await current.destroy();
  };

  /**
   * Alpine's VGA console is a pixel framebuffer, so its login prompt cannot be read; the same boot prints the same
   * prompt on the serial console (ttyS0, enabled in the ISO), which can. Both gettys start together.
   */
  const onSerialText = () => {
    const tail = serialText.slice(-60);
    if (!/login: $/.test(tail.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, ""))) return;
    if (!loggedIn && autologin$.checked) {
      loggedIn = true;
      void typeLine("root").then(() => say("Logged in as root on the console automatically."));
    }
    if (serialWanted && !serialLoggedIn) {
      serialLoggedIn = true;
      vm?.serial0_send("root\n");
    }
  };

  const start = async () => {
    start$.disabled = true;
    say("Starting… the first boot reads the disk image from the network on demand.");
    try {
      const url = "/vm/libv86.mjs";
      const mod = (await import(/* @vite-ignore */ url)) as { V86: V86Ctor };
      const saved = await readState(stateName);
      stage.replaceChildren(screen);
      const options: Record<string, unknown> = {
        wasm_path: "/vm/v86.wasm",
        memory_size: 256 * 1024 * 1024,
        vga_memory_size: 8 * 1024 * 1024,
        screen_container: screen,
        bios: { url: "/vm/bios/seabios.bin" },
        vga_bios: { url: "/vm/bios/vgabios.bin" },
        cdrom: { url: `/vm/alpine.iso?v=${manifest.alpine}`, async: true, size: manifest.isoBytes },
        // An empty 9p filesystem: the shared folder. Part of the device set, so every saved state includes it.
        filesystem: {},
        boot_order: 0x123,
        autostart: true,
        disable_speaker: true,
      };
      if (saved) options.initial_state = { buffer: saved };
      const instance = new mod.V86(options);
      vm = instance;
      loggedIn = Boolean(saved);
      instance.add_listener("emulator-started", () => {
        say(
          saved
            ? "Resumed from the saved machine state."
            : "Running. Click the screen to type; auto-login as root follows the boot.",
        );

      });
      instance.add_listener("download-progress", (...args) => {
        const e = args[0] as { file_name?: string; loaded?: number; total?: number } | undefined;
        if (e?.total && e.loaded !== undefined)
          say(`Reading ${e.file_name ?? "disk"} · ${Math.round((e.loaded / e.total) * 100)}%`);
      });
      instance.add_listener("serial0-output-byte", (...args) => {
        const code = args[0] as number;
        serialText += String.fromCharCode(code);
        if (!serialTimer)
          serialTimer = setTimeout(() => {
            serialTimer = undefined;
            if (serialText.length > SERIAL_KEEP) serialText = serialText.slice(-SERIAL_KEEP);
            // Drop terminal escape sequences and carriage returns; this is a log view, not a terminal emulator.
            serialOut.textContent = serialText.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
            serialOut.scrollTop = serialOut.scrollHeight;
            onSerialText();
          }, 50);
      });
      // Keyboard capture is scoped to the VM: v86 reads window key events only while this stage has focus.
      instance.keyboard_set_status(false);
      const capture = (on: boolean) => {
        instance.keyboard_set_status(on);
        stage.classList.toggle("capturing", on);
      };
      stage.addEventListener("focusin", () => capture(true));
      stage.addEventListener("focusout", () => capture(false));
      screen.addEventListener("mousedown", () => stage.focus());
      stage.focus();
      for (const b of [pause$, reset$, cad$, save$, sync$, pull$, mount$, serial$, copy$, paste$, scale$]) b.disabled = false;
      autosave = setInterval(() => {
        if (autosave$.checked && loggedIn && vm?.is_running()) void saveState("autosave");
      }, AUTOSAVE_MS);
      // The window manager removes the element without telling it: notice, save and stop the machine.
      watch = setInterval(() => {
        if (!root.isConnected) void teardown();
      }, 2000);
    } catch (error) {
      say(`The Linux machine could not start: ${String((error as Error).message ?? error)}`);
      start$.disabled = false;
    }
  };
  let serialText = "";
  let serialTimer: ReturnType<typeof setTimeout> | undefined;

  const btn = (label: string, onclick: () => void, tonal = true, disabled = true) =>
    h("button", { class: tonal ? "btn tonal" : "btn", disabled, onclick }, label) as HTMLButtonElement;
  const check = (label: string, key: string, fallback: boolean) => {
    const input = h("input", { type: "checkbox" });
    input.checked = pref.get(key, fallback);
    input.addEventListener("change", () => pref.set(key, input.checked));
    return { input, label: h("label", { class: "vm-check" }, input, label) };
  };

  const start$ = btn("Start Linux", () => void start(), false, false);
  const pause$ = btn("Pause", async () => {
    if (!vm) return;
    if (vm.is_running()) {
      await vm.stop();
      pause$.textContent = "Resume";
    } else {
      vm.run();
      pause$.textContent = "Pause";
    }
  });
  const reset$ = btn("Restart", () => {
    loggedIn = false;
    serialLoggedIn = false;
    vm?.restart();
  });
  const cad$ = btn("Ctrl+Alt+Del", () => vm?.keyboard_send_scancodes([0x1d, 0x38, 0x53, 0xd3, 0xb8, 0x9d]));
  const save$ = btn("Save state", () => void saveState("manual"));
  const drop$ = btn("Forget saved state", async () => {
    try {
      await (await opfs()).removeEntry(stateName);
    } catch {
      // Nothing saved.
    }
    say("Saved state removed; the next start boots from the ISO.");
    void refreshSaved();
  }, true, true);
  const sync$ = btn("Folder → Linux", async () => {
    if (!vm) return;
    try {
      const r = await pushShared(os, vm);
      say(
        `Copied ${r.files} file(s), ${mib(r.bytes)} from ${SHARED_DIR} into the guest${r.skipped ? ` (${r.skipped} too large, skipped)` : ""}. In Linux: mount -t 9p -o trans=virtio,version=9p2000.L host9p ${GUEST_MOUNT}`,
      );
    } catch (error) {
      say(`Shared folder: ${String((error as Error).message ?? error)}`);
    }
  });
  const pull$ = btn("Linux → Folder", async () => {
    if (!vm) return;
    try {
      const r = await pullShared(os, vm);
      say(`Copied ${r.files} file(s), ${mib(r.bytes)} from the guest into ${SHARED_DIR}${r.skipped ? ` (${r.skipped} skipped)` : ""}.`);
    } catch (error) {
      say(`Shared folder: ${String((error as Error).message ?? error)}`);
    }
  });
  const mount$ = btn("Mount folder", async () => {
    if (!vm) return;
    await typeLine(`mkdir -p ${GUEST_MOUNT} && (modprobe 9pnet_virtio; modprobe 9p; mount -t 9p -o trans=virtio,version=9p2000.L host9p ${GUEST_MOUNT} && echo mounted ${GUEST_MOUNT})`);
    say(`Mount command typed in the guest console; the folder appears at ${GUEST_MOUNT}.`);
  });
  const serial$ = btn("Serial", () => {
    serialBox.hidden = !serialBox.hidden;
    if (serialBox.hidden) return;
    serialWanted = true;
    onSerialText();
    say("Serial console (ttyS0) of the same machine; it logs in as root when it shows a login prompt.");
    serialIn.focus();
  });
  serialIn.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key !== "Enter" || !vm) return;
    vm.serial0_send(`${serialIn.value}\n`);
    serialIn.value = "";
  });
  const copy$ = btn("Copy serial log", async () => {
    // The console is a framebuffer (no text to copy); the serial console is the text channel to the host.
    const text = serialOut.textContent ?? "";
    if (!text) return say("Open the Serial console first: the guest text that reaches the host goes through it.");
    await navigator.clipboard.writeText(text);
    say(`Copied ${text.length} characters of the serial log to the clipboard.`);
  });
  const paste$ = btn("Paste", async () => {
    if (!vm) return;
    await typeText(await navigator.clipboard.readText());
  });
  const scale$ = btn("Zoom 1×", () => {
    scale = scale === 1 ? 1.5 : scale === 1.5 ? 2 : scale === 2 ? 0.75 : 1;
    vm?.screen_set_scale(scale, scale);
    scale$.textContent = `Zoom ${scale}×`;
  });
  const autologinBox = check("Auto-login", "autologin", true);
  const autosaveBox = check("Autosave", "autosave", true);
  const autologin$ = autologinBox.input;
  const autosave$ = autosaveBox.input;

  stage.append(
    h("div", { class: "empty" }, "A real Alpine Linux, running in your browser. Nothing is installed on your device."),
  );
  root.append(
    h(
      "div",
      { class: "store vm-app" },
      h("div", { class: "files-bar vm-bar" }, start$, pause$, reset$, cad$, save$, drop$),
      h("div", { class: "files-bar vm-bar" }, sync$, pull$, mount$, serial$, copy$, paste$, scale$, autologinBox.label, autosaveBox.label),
      h("div", { class: "vm-main" }, stage, serialBox),
      status,
    ),
  );
  const size = await refreshSaved();
  say(
    `Alpine Linux ${manifest.alpine} · v86 ${manifest.v86} · ` +
      (size
        ? `a saved machine (${mib(size)}) is ready to resume`
        : "log in as root (no password); auto-login does it for you"),
  );
}

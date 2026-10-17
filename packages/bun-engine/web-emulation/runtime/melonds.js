// ES module wrapper of the melonDS Qt 6 WebAssembly build with the API every web core exposes:
//
//   await init({ module_or_path })      compile melonDS.wasm, load qtloader.js and the Emscripten glue
//   const handle = await start(canvas, rom, { system: "nds" })
//   handle.set_input(keys)  handle.set_touch(x, y, down)  handle.stop()  handle.free()
//
// Qt draws into its own canvas inside a container; the container takes the canvas's place and
// size. The ROM is written to the in-memory file system and passed on the command line with
// `--fullscreen`, so the screen panel fills the container and touch maps exactly. Input reaches
// Qt as keyboard events through a keymap written to melonDS.toml before boot; the gamepad API is
// polled here with the same standard mapping as the Rust cores.

const base = new URL(".", import.meta.url);
let compiled;

// machine::keys bit -> [melonDS config key, Qt::Key value, KeyboardEvent.key, KeyboardEvent.code]
const KEYS = [
  [1, "A", 0x5a, "z", "KeyZ"],
  [2, "B", 0x58, "x", "KeyX"],
  [4, "Select", 0x01000003, "Backspace", "Backspace"],
  [8, "Start", 0x01000004, "Enter", "Enter"],
  [16, "Right", 0x01000014, "ArrowRight", "ArrowRight"],
  [32, "Left", 0x01000012, "ArrowLeft", "ArrowLeft"],
  [64, "Up", 0x01000013, "ArrowUp", "ArrowUp"],
  [128, "Down", 0x01000015, "ArrowDown", "ArrowDown"],
  [256, "R", 0x57, "w", "KeyW"],
  [512, "L", 0x51, "q", "KeyQ"],
  [1024, "X", 0x53, "s", "KeyS"],
  [2048, "Y", 0x41, "a", "KeyA"],
];
const PAD = [
  [0, 1],
  [1, 2],
  [2, 1024],
  [3, 2048],
  [4, 512],
  [5, 256],
  [8, 4],
  [9, 8],
  [12, 64],
  [13, 128],
  [14, 32],
  [15, 16],
];

function script(url) {
  return new Promise((resolve, reject) => {
    const tag = Object.assign(document.createElement("script"), {
      src: url,
      async: false,
    });
    tag.onload = resolve;
    tag.onerror = () => reject(new Error(`failed to load ${url}`));
    document.head.append(tag);
  });
}

export default async function init({ module_or_path } = {}) {
  if (!globalThis.crossOriginIsolated) {
    throw new Error(
      "melonDS needs SharedArrayBuffer: serve the page with COOP same-origin and COEP",
    );
  }
  const wasm = module_or_path ?? new URL("melonDS.wasm", base);
  const [module] = await Promise.all([
    wasm instanceof WebAssembly.Module
      ? wasm
      : WebAssembly.compileStreaming(fetch(wasm)),
    globalThis.qtLoad ? null : script(new URL("qtloader.js", base)),
    globalThis.melonDS_entry || globalThis.createQtAppInstance
      ? null
      : script(new URL("melonDS.js", base)),
  ]);
  compiled = module;
}

function config() {
  const keys = KEYS.map(([, name, qt]) => `${name} = ${qt}`).join("\n");
  return `[Instance0.Keyboard]\n${keys}\n\n[Instance0.Joystick]\n${KEYS.map(([, name]) => `${name} = -1`).join("\n")}\n`;
}

function mkdirs(fs, path) {
  let at = "";
  for (const part of path.split("/").filter(Boolean)) {
    at += `/${part}`;
    try {
      fs.mkdir(at);
    } catch {
      /* exists */
    }
  }
}

function fnv1a(data) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++)
      h = BigInt.asUintN(64, (h ^ BigInt(data[i + c])) * 0x100000001b3n);
  }
  return h.toString(16).padStart(16, "0");
}

class Handle {
  constructor(instance, container, canvas) {
    this.instance = instance;
    this.container = container;
    this.original = canvas;
    this.keys = 0;
    this.pageKeys = 0;
    this.frames = 0;
    this.stopped = null;
    this.renderer = "qt-raster";
    this.audio = "sdl2-webaudio";
    this.started = performance.now();
    this.first_frame_ms = null;
    const tick = () => {
      if (this.stopped) return;
      this.#apply(this.pageKeys | this.#pad());
      if (this.first_frame_ms === null && this.lit)
        this.first_frame_ms = performance.now() - this.started;
      if (this.first_frame_ms !== null) this.frames++;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** The canvas Qt draws the main window into (largest canvas of the container). */
  get canvas() {
    const scope = this.container.shadowRoot ?? this.container;
    const all = [
      ...scope.querySelectorAll("canvas"),
      ...this.container.querySelectorAll("canvas"),
    ];
    return (
      all.sort((a, b) => b.width * b.height - a.width * a.height)[0] ??
      this.container
    );
  }

  #target() {
    const scope = this.container.shadowRoot ?? this.container;
    return (
      scope.querySelector(
        "[contenteditable], input, .qt-window-input-element",
      ) ?? this.canvas
    );
  }

  #pad() {
    let bits = 0;
    for (const pad of navigator.getGamepads?.() ?? []) {
      if (!pad) continue;
      for (const [index, bit] of PAD)
        if (pad.buttons[index]?.pressed) bits |= bit;
      const [x = 0, y = 0] = pad.axes;
      if (x < -0.5) bits |= 32;
      else if (x > 0.5) bits |= 16;
      if (y < -0.5) bits |= 64;
      else if (y > 0.5) bits |= 128;
    }
    return bits;
  }

  #apply(keys) {
    const changed = keys ^ this.keys;
    if (!changed) return;
    const target = this.#target();
    for (const [bit, , , key, code] of KEYS) {
      if (!(changed & bit)) continue;
      const type = keys & bit ? "keydown" : "keyup";
      target.dispatchEvent(
        new KeyboardEvent(type, {
          key,
          code,
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
    }
    this.keys = keys;
  }

  set_input(keys) {
    this.pageKeys = keys >>> 0;
  }

  /** Bottom-screen pixels (256x192); the panel is fullscreen: both screens stacked, letterboxed. */
  set_touch(x, y, down) {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / 256, rect.height / 384);
    const left = rect.left + (rect.width - 256 * scale) / 2;
    const top = rect.top + (rect.height - 384 * scale) / 2 + 192 * scale;
    const init = {
      clientX: left + (x + 0.5) * scale,
      clientY: top + (y + 0.5) * scale,
      bubbles: true,
      composed: true,
      button: 0,
      buttons: down ? 1 : 0,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    };
    const type = down
      ? this.touching
        ? "pointermove"
        : "pointerdown"
      : "pointerup";
    if (!down && !this.touching) return;
    canvas.dispatchEvent(new PointerEvent(type, init));
    this.touching = down;
  }

  resume_audio() {
    const ctx = this.instance.SDL2?.audioContext;
    if (ctx?.state === "suspended") ctx.resume();
  }

  #pixels() {
    const canvas = this.canvas;
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width) return null;
    const copy = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = copy.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  }

  get frame_hash() {
    const data = this.#pixels();
    return data ? fnv1a(data) : null;
  }

  get lit() {
    const data = this.#pixels();
    if (!data) return false;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] > 16 || data[i + 1] > 16 || data[i + 2] > 16) return true;
    return false;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = "stopped by the page";
    cancelAnimationFrame(this.raf);
    try {
      this.instance.qtApplication?.()?.quit?.();
    } catch {
      /* the runtime may already be gone */
    }
    this.container.replaceWith(this.original);
  }

  free() {
    this.stop();
    this.instance = null;
  }
}

/**
 * Boot `rom` in melonDS inside `canvas`'s box.
 * @param {HTMLCanvasElement} canvas
 * @param {Uint8Array} rom
 * @param {{ system?: string }} [options]
 */
export async function start(canvas, rom, { system = "nds" } = {}) {
  if (system !== "nds" && system !== "nintendo-ds")
    throw new Error(`melonDS boots nds images, not ${system}`);
  if (!compiled) await init();
  const container = document.createElement("div");
  const box = canvas.getBoundingClientRect();
  Object.assign(container.style, {
    width: `${box.width || 512}px`,
    height: `${box.height || 768}px`,
    position: "relative",
    overflow: "hidden",
  });
  container.className = canvas.className;
  canvas.replaceWith(container);
  const entry = globalThis.melonDS_entry ?? globalThis.createQtAppInstance;
  const instance = await globalThis.qtLoad({
    arguments: ["/rom/game.nds", "--fullscreen"],
    qt: {
      module: compiled,
      entryFunction: entry,
      containerElements: [container],
      onExit: (status) =>
        console.warn(`melonDS exited (${status?.code ?? status?.text ?? ""})`),
    },
    preRun: [
      (module) => {
        const fs = module.FS;
        mkdirs(fs, "/rom");
        fs.writeFile("/rom/game.nds", rom);
        for (const dir of ["/home/web_user/.config/melonDS", "/portable"]) {
          mkdirs(fs, dir);
          fs.writeFile(`${dir}/melonDS.toml`, config());
        }
      },
    ],
  });
  return new Handle(instance, container, canvas);
}

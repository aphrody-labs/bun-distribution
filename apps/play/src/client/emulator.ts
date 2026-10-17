// SPDX-License-Identifier: Apache-2.0
/**
 * Generic web emulation host. Cores are published by the web emulation owner as
 * `dist/web-emulation/<core>/{*.wasm,*.js,manifest.json}` and served at /emulation/<core>/.
 *
 * Contract (manifest.json):
 *   { id, name, systems[], extensions[], module, wasm, start?, threads?, renderer?, touch?,
 *     touchSize?: [w, h], touchArea?: { x, y, width, height } (canvas pixels), version? }
 * Module: `default({ module_or_path })` (wasm-bindgen --target web, or an ES-module wrapper of an
 * Emscripten core), then `start(canvas, rom, { system, bios? })` returns a handle with
 * `set_input(keys)`, optional `set_touch(x, y, down)` (bottom-screen pixels), `stop()`, `free()`.
 * Keys use the Bun Engine bits (crates/bun-engine-core machine::keys).
 */
export interface CoreManifest {
  id: string;
  name: string;
  systems: string[];
  extensions?: string[];
  module: string;
  wasm: string;
  start?: string;
  threads?: boolean;
  renderer?: string;
  touch?: boolean;
  touchSize?: [number, number];
  touchArea?: { x: number; y: number; width: number; height: number };
  version?: string;
  /** Placeholder manifest until the core is published. */
  stub?: boolean;
  base: string;
}

interface CoreHandle {
  set_input(keys: number): void;
  set_touch?(x: number, y: number, down: boolean): void;
  stop?(): void;
  free?(): void;
}

type CoreModule = Record<string, unknown> & {
  default: (init: { module_or_path: string }) => Promise<unknown>;
};

export const KEYS = {
  A: 1 << 0,
  B: 1 << 1,
  SELECT: 1 << 2,
  START: 1 << 3,
  RIGHT: 1 << 4,
  LEFT: 1 << 5,
  UP: 1 << 6,
  DOWN: 1 << 7,
  R: 1 << 8,
  L: 1 << 9,
  X: 1 << 10,
  Y: 1 << 11,
} as const;

const KEYBOARD: Record<string, number> = {
  KeyX: KEYS.A,
  KeyZ: KEYS.B,
  ShiftRight: KEYS.SELECT,
  Backspace: KEYS.SELECT,
  Enter: KEYS.START,
  ArrowRight: KEYS.RIGHT,
  ArrowLeft: KEYS.LEFT,
  ArrowUp: KEYS.UP,
  ArrowDown: KEYS.DOWN,
  KeyS: KEYS.R,
  KeyA: KEYS.L,
  KeyD: KEYS.X,
  KeyC: KEYS.Y,
};

// Standard Gamepad mapping -> Bun Engine keys (Nintendo layout: east = A, south = B).
const PAD: [number, number][] = [
  [1, KEYS.A],
  [0, KEYS.B],
  [3, KEYS.X],
  [2, KEYS.Y],
  [4, KEYS.L],
  [5, KEYS.R],
  [8, KEYS.SELECT],
  [9, KEYS.START],
  [12, KEYS.UP],
  [13, KEYS.DOWN],
  [14, KEYS.LEFT],
  [15, KEYS.RIGHT],
];

export function coreFor(
  cores: CoreManifest[],
  system: string,
): CoreManifest | undefined {
  return cores.find((core) => !core.stub && core.systems.includes(system));
}

export interface RunningCore {
  stop(): void;
  keys(): number;
}

export async function runCore(
  core: CoreManifest,
  canvas: HTMLCanvasElement,
  rom: Uint8Array,
  system: string,
  onStatus: (state: "loading" | "running" | "failed", detail?: string) => void,
): Promise<RunningCore> {
  if (core.threads && !crossOriginIsolated)
    throw new Error("threaded core needs a cross-origin isolated page");
  onStatus("loading");
  const mod = (await import(
    /* @vite-ignore */ `${core.base}${core.module}`
  )) as CoreModule;
  await mod.default({ module_or_path: `${core.base}${core.wasm}` });
  const start = mod[core.start ?? "start"] as
    | ((
        canvas: HTMLCanvasElement,
        rom: Uint8Array,
        options: { system: string },
      ) => CoreHandle | Promise<CoreHandle>)
    | undefined;
  if (typeof start !== "function")
    throw new Error(`${core.id}: missing export ${core.start ?? "start"}`);
  const handle = await start(canvas, rom, { system });
  onStatus("running");

  let keyboard = 0;
  let pad = 0;
  let sent = -1;
  const push = () => {
    const keys = keyboard | pad;
    if (keys !== sent) {
      sent = keys;
      handle.set_input(keys);
    }
  };
  const onKey = (event: KeyboardEvent) => {
    const bit = KEYBOARD[event.code];
    if (!bit) return;
    event.preventDefault();
    keyboard = event.type === "keydown" ? keyboard | bit : keyboard & ~bit;
    push();
  };
  addEventListener("keydown", onKey);
  addEventListener("keyup", onKey);

  let frame = 0;
  const pollPad = () => {
    const gamepad = [...navigator.getGamepads()].find(Boolean);
    pad = 0;
    if (gamepad) {
      for (const [index, bit] of PAD)
        if (gamepad.buttons[index]?.pressed) pad |= bit;
      const [ax = 0, ay = 0] = gamepad.axes;
      if (ax < -0.5) pad |= KEYS.LEFT;
      if (ax > 0.5) pad |= KEYS.RIGHT;
      if (ay < -0.5) pad |= KEYS.UP;
      if (ay > 0.5) pad |= KEYS.DOWN;
    }
    push();
    frame = requestAnimationFrame(pollPad);
  };
  frame = requestAnimationFrame(pollPad);
  document.body.dataset.gamepadCapture = "emulator";

  // Touch (DS/3DS): pointer events on the bottom screen, in bottom-screen pixels.
  const [touchW, touchH] = core.touchSize ?? [256, 192];
  const touch = (event: PointerEvent) => {
    if (!handle.set_touch) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const py = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const area = core.touchArea ?? {
      x: 0,
      y: canvas.height / 2,
      width: canvas.width,
      height: canvas.height / 2,
    };
    const inside =
      px >= area.x &&
      py >= area.y &&
      px < area.x + area.width &&
      py < area.y + area.height;
    const down =
      inside &&
      event.type !== "pointerup" &&
      event.type !== "pointercancel" &&
      event.buttons !== 0;
    const x = Math.max(
      0,
      Math.min(touchW - 1, Math.round(((px - area.x) / area.width) * touchW)),
    );
    const y = Math.max(
      0,
      Math.min(touchH - 1, Math.round(((py - area.y) / area.height) * touchH)),
    );
    handle.set_touch(x, y, down);
  };
  if (core.touch) {
    canvas.style.touchAction = "none";
    for (const type of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointercancel",
    ] as const)
      canvas.addEventListener(type, touch);
  }

  return {
    keys: () => sent,
    stop() {
      cancelAnimationFrame(frame);
      removeEventListener("keydown", onKey);
      removeEventListener("keyup", onKey);
      for (const type of [
        "pointerdown",
        "pointermove",
        "pointerup",
        "pointercancel",
      ] as const)
        canvas.removeEventListener(type, touch);
      delete document.body.dataset.gamepadCapture;
      handle.stop?.();
      handle.free?.();
    },
  };
}

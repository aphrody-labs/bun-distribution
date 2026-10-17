/** Keyboard, mouse (pointer lock) and Gamepad API capture sent over the "input" data channel. */
import type { InputMessage } from "../protocol.ts";

/** Keys handled locally and never forwarded: F8 toggles the HUD, F11 fullscreen. */
const LOCAL_KEYS = new Set(["F8", "F11"]);

export interface InputCounters {
  sent: number;
}

/**
 * `stage` receives the events (and pointer lock); `surface` is the letterboxed picture that
 * absolute coordinates are normalized against.
 */
export function captureInput(
  stage: HTMLElement,
  surface: () => HTMLElement,
  send: (message: InputMessage) => void,
): InputCounters {
  const counters: InputCounters = { sent: 0 };
  const emit = (message: InputMessage) => {
    counters.sent++;
    send(message);
  };
  const locked = () => document.pointerLockElement === stage;

  // Raw (unaccelerated) movement when the platform supports it; absolute mode otherwise.
  const lock = async () => {
    try {
      await stage.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await stage.requestPointerLock();
      } catch (error) {
        console.warn(`[gamestream] pointer lock unavailable: ${String(error)}`);
      }
    }
  };
  stage.addEventListener("click", () => {
    if (!locked()) void lock();
  });

  // Relative motion is accumulated and flushed once per animation frame.
  let dx = 0;
  let dy = 0;
  stage.addEventListener("pointermove", (event) => {
    if (locked()) {
      dx += event.movementX;
      dy += event.movementY;
      return;
    }
    const rect = surface().getBoundingClientRect();
    emit({
      t: "ma",
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    });
  });
  stage.addEventListener("pointerdown", (event) =>
    emit({ t: "mb", b: event.button, d: true }),
  );
  stage.addEventListener("pointerup", (event) =>
    emit({ t: "mb", b: event.button, d: false }),
  );
  stage.addEventListener("contextmenu", (event) => event.preventDefault());
  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.deltaY !== 0) emit({ t: "mw", dy: Math.sign(event.deltaY) });
    },
    { passive: false },
  );

  const onKey = (down: boolean) => (event: KeyboardEvent) => {
    if (LOCAL_KEYS.has(event.code)) return;
    event.preventDefault();
    if (event.repeat) return;
    emit({ t: "k", c: event.code, d: down });
  };
  window.addEventListener("keydown", onKey(true));
  window.addEventListener("keyup", onKey(false));

  // Gamepads: standard mapping snapshots, sent only when they change.
  const last = new Map<number, string>();
  const frame = () => {
    if (dx !== 0 || dy !== 0) {
      emit({ t: "mm", dx, dy });
      dx = 0;
      dy = 0;
    }
    for (const pad of navigator.getGamepads()) {
      if (!pad || pad.mapping !== "standard") continue;
      const b = pad.buttons.map(
        (button) => Math.round(button.value * 100) / 100,
      );
      const a = pad.axes.map((axis) =>
        Math.abs(axis) < 0.05 ? 0 : Math.round(axis * 1000) / 1000,
      );
      const key = `${b.join()}|${a.join()}`;
      if (last.get(pad.index) === key) continue;
      last.set(pad.index, key);
      emit({ t: "gp", i: pad.index, b, a });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return counters;
}

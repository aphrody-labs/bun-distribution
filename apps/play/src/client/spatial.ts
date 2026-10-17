// SPDX-License-Identifier: Apache-2.0
/**
 * 10-foot navigation: arrow keys and the Gamepad API move focus spatially between focusable
 * elements; A / Enter activates, B / Escape goes back. While an emulator or the stream owns the
 * gamepad (`document.body.dataset.gamepadCapture`), the UI does not consume it.
 */
const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select, [tabindex]:not([tabindex='-1'])";

type Direction = "up" | "down" | "left" | "right";

function visible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    getComputedStyle(element).visibility !== "hidden"
  );
}

export function moveFocus(direction: Direction): boolean {
  const current =
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
      ? document.activeElement
      : null;
  const candidates = [
    ...document.querySelectorAll<HTMLElement>(FOCUSABLE),
  ].filter(
    (element) =>
      element !== current && visible(element) && !element.closest("[inert]"),
  );
  if (!current) {
    candidates[0]?.focus();
    return candidates.length > 0;
  }
  const from = current.getBoundingClientRect();
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const element of candidates) {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - fx;
    const dy = y - fy;
    const along =
      direction === "left"
        ? -dx
        : direction === "right"
          ? dx
          : direction === "up"
            ? -dy
            : dy;
    if (along <= 1) continue;
    const across =
      direction === "left" || direction === "right"
        ? Math.abs(dy)
        : Math.abs(dx);
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = element;
    }
  }
  if (!best) return false;
  best.focus({ preventScroll: true });
  // Keep focus clear of the sticky navigation (scroll-padding covers keyboard scrolling).
  best.scrollIntoView({
    block: "nearest",
    inline: "nearest",
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth",
  });
  return true;
}

function back(): void {
  const dialog = document.querySelector<HTMLDialogElement>("dialog[open]");
  if (dialog) dialog.close();
  else if (location.pathname !== "/") history.back();
}

export function installSpatialNavigation(): void {
  addEventListener("keydown", (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    if (document.body.dataset.gamepadCapture) return;
    const target = event.target as HTMLElement;
    if (
      target.matches("input, textarea, select") &&
      !["ArrowUp", "ArrowDown", "Escape"].includes(event.key)
    )
      return;
    const direction = (
      {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      } as const
    )[event.key as "ArrowUp"];
    if (direction && moveFocus(direction)) event.preventDefault();
    else if (event.key === "Escape" || event.key === "Backspace") {
      if (!target.matches("input, textarea")) {
        back();
        event.preventDefault();
      }
    }
  });

  // Gamepad: standard mapping (0 = A, 1 = B, 12-15 = D-pad) and the left stick, with key repeat.
  const held = new Map<string, number>();
  const repeat = (
    key: string,
    active: boolean,
    now: number,
    action: () => void,
  ) => {
    if (!active) {
      held.delete(key);
      return;
    }
    const since = held.get(key);
    if (since === undefined) {
      held.set(key, now + 380);
      action();
    } else if (now >= since) {
      held.set(key, now + 110);
      action();
    }
  };
  let polling = false;
  const poll = (now: number) => {
    const pad = [...navigator.getGamepads()].find(Boolean);
    if (pad && !document.body.dataset.gamepadCapture) {
      const button = (index: number) => pad.buttons[index]?.pressed === true;
      const [ax = 0, ay = 0] = pad.axes;
      repeat("up", button(12) || ay < -0.6, now, () => moveFocus("up"));
      repeat("down", button(13) || ay > 0.6, now, () => moveFocus("down"));
      repeat("left", button(14) || ax < -0.6, now, () => moveFocus("left"));
      repeat("right", button(15) || ax > 0.6, now, () => moveFocus("right"));
      repeat("a", button(0), now, () =>
        (document.activeElement as HTMLElement | null)?.click(),
      );
      repeat("b", button(1), now, back);
    }
    polling = [...navigator.getGamepads()].some(Boolean);
    if (polling) requestAnimationFrame(poll);
  };
  addEventListener("gamepadconnected", () => {
    document.documentElement.dataset.input = "gamepad";
    if (!polling) {
      polling = true;
      requestAnimationFrame(poll);
    }
  });
  addEventListener("pointerdown", () => {
    document.documentElement.dataset.input = "pointer";
  });
}

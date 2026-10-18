// SPDX-License-Identifier: Apache-2.0
// Keyboard navigation after the Omarchy manual (04-navigation): Alt (or the Meta key where the browser
// receives it) plays Super. Browsers keep Ctrl+W/T/N, so every chord uses Alt.
import { h } from "./dom";
import type { Direction, WindowManager } from "./wm";

export interface KeyActions {
  launcher(): void;
  launch(id: string): void;
  help(): void;
  /** Alt+Shift+<letter> of a pinned web app; true when one opened. */
  webHotkey(code: string): boolean;
}

export const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: "Launch",
    items: [
      ["Alt + Space", "Launcher"],
      ["Alt + Enter", "Terminal"],
      ["Alt + Shift + Enter", "Browser"],
      ["Alt + Shift + F", "Files"],
      ["Alt + /", "This list"],
      ["Alt + Ctrl + T", "Activity"],
      ["Alt + Ctrl + Q", "Calculator"],
      ["Alt + Shift + A / Y / X / P", "ChatGPT, YouTube, X, Google Photos"],
    ],
  },
  {
    group: "Windows",
    items: [
      ["Alt + Arrows", "Move focus"],
      ["Alt + Shift + Arrows", "Swap windows (floating: snap to a half)"],
      ["Alt + F", "Maximize"],
      ["Alt + W / Alt + Q", "Close window"],
      ["Alt + Shift + Q", "Close all windows"],
      ["Alt + M", "Minimize"],
      ["Alt + O", "Pop out as floating"],
      ["Alt + drag / right-drag", "Move / resize a window"],
    ],
  },
  {
    group: "Layout",
    items: [
      ["Alt + T", "Tiled or floating"],
      ["Alt + L / Alt + Shift + L", "Cycle dwindle, scrolling, floating"],
    ],
  },
  {
    group: "Workspaces",
    items: [
      ["Alt + 1 to 0", "Go to workspace"],
      ["Alt + Tab or Alt + .", "Next workspace (Alt + Shift + Tab: previous)"],
      ["Alt + Shift + 1 to 0", "Move window to workspace"],
      ["Ctrl + Alt + 1 to 0", "Move window without switching"],
    ],
  },
  {
    group: "Scratchpad",
    items: [
      ["Alt + S or Alt + `", "Show or hide the scratchpad"],
      ["Alt + Shift + S", "Send window to the scratchpad"],
    ],
  },
];

const DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

export function installKeys(wm: WindowManager, actions: KeyActions) {
  window.addEventListener("keydown", e => {
    if (!(e.altKey || e.metaKey) || e.isComposing) return;
    const shift = e.shiftKey;
    const ctrl = e.ctrlKey;
    const digit = /^Digit(\d)$/.exec(e.code)?.[1];
    const run = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    const cur = () => wm.active();

    if (digit !== undefined) {
      const n = digit === "0" ? 10 : Number(digit);
      if (ctrl) return run(() => cur() && wm.moveToWorkspace(cur()!, n, false));
      if (shift) return run(() => cur() && wm.moveToWorkspace(cur()!, n, true));
      return run(() => wm.goTo(n));
    }
    if (e.code in DIRECTIONS)
      return run(() => (shift ? wm.swapDirection(DIRECTIONS[e.code]!) : wm.focusDirection(DIRECTIONS[e.code]!)));

    if (shift && !ctrl && actions.webHotkey(e.code)) return run(() => {});
    if (ctrl && e.code === "KeyT") return run(() => actions.launch("activity"));
    if (ctrl && e.code === "KeyQ") return run(() => actions.launch("calculator"));

    switch (e.code) {
      case "Space":
        return run(actions.launcher);
      case "Enter":
        return run(() => actions.launch(shift ? "browser" : "terminal"));
      case "KeyF":
        return run(() => (shift ? actions.launch("files") : cur() && wm.toggleMax(cur()!)));
      case "KeyW":
      case "KeyQ":
        return run(() => (shift && e.code === "KeyQ" ? wm.closeAll() : cur()?.close()));
      case "KeyM":
        return run(() => cur() && wm.minimize(cur()!));
      case "KeyO":
        return run(() => wm.setLayout("floating"));
      case "KeyT":
        return run(() => wm.toggleTiled());
      case "KeyL":
        return run(() => wm.cycleLayout(shift ? -1 : 1));
      case "Tab":
      case "Period":
        return run(() => wm.cycleWorkspace(shift ? -1 : 1));
      case "KeyS":
      case "Backquote":
        return run(() => (shift ? cur() && wm.sendToScratchpad(cur()!) : wm.toggleScratchpad()));
      case "Slash":
        return run(actions.help);
    }
  });
}

/** Window content listing every shortcut. */
export function shortcutsView(): HTMLElement {
  return h(
    "div",
    { class: "detail" },
    h("h2", {}, "Keyboard"),
    h(
      "p",
      { class: "muted" },
      "Alt works as the Super key. Meta (Windows, Command) works too where the browser receives it.",
    ),
    ...SHORTCUTS.flatMap(g => [
      h("h3", {}, g.group),
      h("dl", { class: "kv" }, ...g.items.flatMap(([k, d]) => [h("dt", { class: "mono" }, k), h("dd", {}, d)])),
    ]),
  );
}

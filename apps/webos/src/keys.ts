// SPDX-License-Identifier: Apache-2.0
// Keyboard navigation after the Omarchy manual (04-navigation): Alt (or the Meta key where the browser
// receives it) plays Super. Every chord comes from shortcuts.ts, overridden by the "keys.bindings" preference.
import { h } from "./dom";
import { prefs } from "./prefs";
import {
  ACTIONS,
  GROUPS,
  chordCaps,
  chordOf,
  familyOf,
  type ShortcutAction,
} from "./shortcuts";
import type { Direction, WindowManager } from "./wm";

export interface KeyActions {
  launcher(): void;
  launch(id: string): void;
  help(): void;
  /** Alt+Shift+<letter> of a pinned web app; true when one opened. */
  webHotkey(code: string): boolean;
}

/** Current chords of an action. */
export function bindingsOf(action: ShortcutAction): string[] {
  return prefs.get("keys.bindings")[action.id] ?? action.keys;
}
/** The first chord of an action id, for hints. */
export function hintOf(id: string): string | undefined {
  const a = ACTIONS.find((x) => x.id === id);
  return a ? bindingsOf(a)[0] : undefined;
}

/** chord -> action, rebuilt when bindings change. */
let table = new Map<string, ShortcutAction>();
function rebuild() {
  table = new Map();
  for (const a of ACTIONS)
    for (const c of bindingsOf(a)) if (!table.has(c)) table.set(c, a);
}

let suspended = false;
/** Pause shell shortcuts while Settings records a new chord. */
export function suspendKeys(on: boolean) {
  suspended = on;
}

export function installKeys(wm: WindowManager, actions: KeyActions) {
  rebuild();
  prefs.subscribe("keys.bindings", rebuild);
  const cur = () => wm.active();
  const run = (a: ShortcutAction, arg?: string) => {
    const w = cur();
    switch (a.id) {
      case "launcher":
        return actions.launcher();
      case "help":
        return actions.help();
      case "focus":
        return wm.focusDirection(arg as Direction);
      case "swap":
        return wm.swapDirection(arg as Direction);
      case "window.maximize":
        return w && wm.toggleMax(w);
      case "window.close":
        return w?.close();
      case "window.closeAll":
        return wm.closeAll();
      case "window.minimize":
        return w && wm.minimize(w);
      case "layout.float":
        return wm.setLayout("floating");
      case "layout.toggle":
        return wm.toggleTiled();
      case "layout.next":
        return wm.cycleLayout(1);
      case "layout.previous":
        return wm.cycleLayout(-1);
      case "workspace.go":
        return wm.goTo(Number(arg));
      case "workspace.move":
        return w && wm.moveToWorkspace(w, Number(arg), true);
      case "workspace.send":
        return w && wm.moveToWorkspace(w, Number(arg), false);
      case "workspace.next":
        return wm.cycleWorkspace(1);
      case "workspace.previous":
        return wm.cycleWorkspace(-1);
      case "scratchpad.toggle":
        return wm.toggleScratchpad();
      case "scratchpad.send":
        return w && wm.sendToScratchpad(w);
      default:
        if (a.id.startsWith("launch."))
          actions.launch(a.id.slice("launch.".length));
    }
  };
  window.addEventListener("keydown", (e) => {
    if (suspended || e.isComposing || !(e.altKey || e.metaKey || e.ctrlKey))
      return;
    const fam = familyOf(e.code);
    // Meta plays Super: a Meta chord falls back to the same chord with Alt.
    const candidates = (chord: string) =>
      e.metaKey && !e.altKey ? [chord, chord.replace("Meta", "Alt")] : [chord];
    const lookups: [string, string | undefined][] = [
      ...candidates(chordOf(e)).map(
        (c) => [c, undefined] as [string, undefined],
      ),
      ...(fam
        ? candidates(chordOf(e, fam.family)).map(
            (c) =>
              [
                c,
                fam.family === "Digit"
                  ? String(fam.value === "0" ? 10 : Number(fam.value))
                  : fam.value,
              ] as [string, string],
          )
        : []),
    ];
    for (const [chord, arg] of lookups) {
      const a = table.get(chord);
      if (!a || (a.family && arg === undefined)) continue;
      e.preventDefault();
      e.stopPropagation();
      run(a, arg);
      return;
    }
    if (
      (e.altKey || e.metaKey) &&
      e.shiftKey &&
      !e.ctrlKey &&
      actions.webHotkey(e.code)
    ) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

/** <kbd> caps of one chord. */
export function chordKbd(chord: string): HTMLElement {
  return h(
    "span",
    { class: "chord" },
    ...chordCaps(chord).map((k) => h("kbd", {}, k)),
  );
}

/** Sheet of every shortcut with its current chords; follows rebinding live. */
export function shortcutsView(): HTMLElement {
  const view = h("div", { class: "detail shortcuts" });
  const render = () =>
    view.replaceChildren(
      h("h2", {}, "Keyboard shortcuts"),
      h(
        "p",
        { class: "muted" },
        "Alt works as the Super key. Meta (Windows, Command) works too where the browser receives it. Change any shortcut in Settings, Keyboard.",
      ),
      ...GROUPS.flatMap((g) => [
        h("h3", {}, g),
        h(
          "dl",
          { class: "kv" },
          ...ACTIONS.filter((a) => a.group === g).flatMap((a) => {
            const chords = bindingsOf(a);
            return [
              h(
                "dt",
                {},
                ...(chords.length
                  ? chords.map(chordKbd)
                  : [h("span", { class: "muted" }, "Not set")]),
              ),
              h("dd", {}, a.label),
            ];
          }),
        ),
      ]),
      h("h3", {}, "Mouse"),
      h(
        "dl",
        { class: "kv" },
        h("dt", {}, chordKbd("Alt+Drag")),
        h("dd", {}, "Move a window (right-drag resizes)"),
        h("dt", {}, chordKbd("Alt+Shift+Letter")),
        h("dd", {}, "Open the web app given that letter in Web Apps"),
      ),
    );
  const off = prefs.subscribe("keys.bindings", () =>
    view.isConnected ? render() : off(),
  );
  render();
  return view;
}

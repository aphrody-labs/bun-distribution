// SPDX-License-Identifier: Apache-2.0
// Every shell shortcut: one action table with its default chords. The keyboard handler (keys.ts), the shortcuts
// sheet and Settings > Keyboard all read it; user bindings in the "keys.bindings" preference override the defaults.
//
// A chord is modifiers in the order Ctrl, Alt, Shift, Meta, then a KeyboardEvent.code, joined with "+":
// "Alt+Shift+KeyF". Two families stand for a set of keys: "Digit" (1 to 0, one per workspace) and "Arrow"
// (the four directions). Alt plays the Super key; Meta works too where the browser receives it.

export type ActionGroup =
  "Launch" | "Windows" | "Layout" | "Workspaces" | "Scratchpad";

export interface ShortcutAction {
  id: string;
  group: ActionGroup;
  label: string;
  /** Default chords; the first one is shown in hints. */
  keys: string[];
  /** The chord names a family of keys instead of one key. */
  family?: "Digit" | "Arrow";
}

export const ACTIONS: readonly ShortcutAction[] = [
  {
    id: "launcher",
    group: "Launch",
    label: "Launcher and search",
    keys: ["Alt+Space", "Ctrl+KeyK"],
  },
  {
    id: "launch.terminal",
    group: "Launch",
    label: "Terminal",
    keys: ["Alt+Enter"],
  },
  {
    id: "launch.browser",
    group: "Launch",
    label: "Browser",
    keys: ["Alt+Shift+Enter"],
  },
  {
    id: "launch.files",
    group: "Launch",
    label: "Files",
    keys: ["Alt+Shift+KeyF"],
  },
  {
    id: "launch.settings",
    group: "Launch",
    label: "Settings",
    keys: ["Alt+Comma"],
  },
  {
    id: "launch.activity",
    group: "Launch",
    label: "Activity",
    keys: ["Ctrl+Alt+KeyT"],
  },
  {
    id: "launch.calculator",
    group: "Launch",
    label: "Calculator",
    keys: ["Ctrl+Alt+KeyQ"],
  },
  {
    id: "help",
    group: "Launch",
    label: "Keyboard shortcuts",
    keys: ["Alt+Slash"],
  },
  {
    id: "focus",
    group: "Windows",
    label: "Move focus",
    keys: ["Alt+Arrow"],
    family: "Arrow",
  },
  {
    id: "swap",
    group: "Windows",
    label: "Swap windows (floating: snap to a half)",
    keys: ["Alt+Shift+Arrow"],
    family: "Arrow",
  },
  {
    id: "window.maximize",
    group: "Windows",
    label: "Maximize",
    keys: ["Alt+KeyF"],
  },
  {
    id: "window.close",
    group: "Windows",
    label: "Close window",
    keys: ["Alt+KeyW", "Alt+KeyQ"],
  },
  {
    id: "window.closeAll",
    group: "Windows",
    label: "Close all windows",
    keys: ["Alt+Shift+KeyQ"],
  },
  {
    id: "window.minimize",
    group: "Windows",
    label: "Minimize",
    keys: ["Alt+KeyM"],
  },
  {
    id: "layout.float",
    group: "Layout",
    label: "Float this workspace",
    keys: ["Alt+KeyO"],
  },
  {
    id: "layout.toggle",
    group: "Layout",
    label: "Tiled or floating",
    keys: ["Alt+KeyT"],
  },
  {
    id: "layout.next",
    group: "Layout",
    label: "Next layout",
    keys: ["Alt+KeyL"],
  },
  {
    id: "layout.previous",
    group: "Layout",
    label: "Previous layout",
    keys: ["Alt+Shift+KeyL"],
  },
  {
    id: "workspace.go",
    group: "Workspaces",
    label: "Go to workspace",
    keys: ["Alt+Digit"],
    family: "Digit",
  },
  {
    id: "workspace.move",
    group: "Workspaces",
    label: "Move window to workspace",
    keys: ["Alt+Shift+Digit"],
    family: "Digit",
  },
  {
    id: "workspace.send",
    group: "Workspaces",
    label: "Move window without switching",
    keys: ["Ctrl+Alt+Digit"],
    family: "Digit",
  },
  {
    id: "workspace.next",
    group: "Workspaces",
    label: "Next workspace",
    keys: ["Alt+Tab", "Alt+Period"],
  },
  {
    id: "workspace.previous",
    group: "Workspaces",
    label: "Previous workspace",
    keys: ["Alt+Shift+Tab", "Alt+Shift+Period"],
  },
  {
    id: "scratchpad.toggle",
    group: "Scratchpad",
    label: "Show or hide the scratchpad",
    keys: ["Alt+KeyS", "Alt+Backquote"],
  },
  {
    id: "scratchpad.send",
    group: "Scratchpad",
    label: "Send window to the scratchpad",
    keys: ["Alt+Shift+KeyS"],
  },
];

export const GROUPS: readonly ActionGroup[] = [
  "Launch",
  "Windows",
  "Layout",
  "Workspaces",
  "Scratchpad",
];

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Meta"] as const;

/** The chord of a key event, or of its modifiers alone with a family name. */
export function chordOf(e: KeyboardEvent, family?: "Digit" | "Arrow"): string {
  const mods = [
    e.ctrlKey && "Ctrl",
    e.altKey && "Alt",
    e.shiftKey && "Shift",
    e.metaKey && "Meta",
  ].filter(Boolean);
  return [...mods, family ?? e.code].join("+");
}

/** True when the code is a modifier key alone (no chord yet). */
export const isModifierCode = (code: string) =>
  /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(code);

/** The family a key code belongs to, if any. */
export function familyOf(
  code: string,
): { family: "Digit" | "Arrow"; value: string } | undefined {
  const digit = /^Digit(\d)$/.exec(code)?.[1];
  if (digit !== undefined) return { family: "Digit", value: digit };
  const arrow = /^Arrow(Left|Right|Up|Down)$/.exec(code)?.[1];
  if (arrow) return { family: "Arrow", value: arrow.toLowerCase() };
  return undefined;
}

/** A chord must hold a modifier other than Shift, so typing never triggers a shortcut. */
export function validChord(chord: string): boolean {
  const parts = chord.split("+");
  return (
    parts.some((p) => p === "Ctrl" || p === "Alt" || p === "Meta") &&
    !isModifierCode(parts.at(-1) ?? "")
  );
}

const KEY_NAMES: Record<string, string> = {
  Space: "Space",
  Enter: "Enter",
  Slash: "/",
  Comma: ",",
  Period: ".",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backslash: "\\",
  Tab: "Tab",
  Escape: "Esc",
  Backspace: "Backspace",
  Digit: "1 to 0",
  Arrow: "Arrows",
};

/** Human label: "Alt+Shift+KeyF" becomes "Alt + Shift + F". */
export function chordLabel(chord: string): string {
  return chord
    .split("+")
    .map((p) =>
      MODIFIERS.includes(p as (typeof MODIFIERS)[number])
        ? p
        : (KEY_NAMES[p] ??
          p
            .replace(/^Key/, "")
            .replace(/^Digit/, "")
            .replace(/^Arrow/, "")),
    )
    .join(" + ");
}

/** Chords as separate key caps, for <kbd> rendering. */
export const chordCaps = (chord: string) => chordLabel(chord).split(" + ");

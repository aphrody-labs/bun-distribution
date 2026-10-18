// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { HOME, webos } from "../os";
import type { Snapshot, Terminal, WebOs } from "@aphrody/webos-wasm";
import css from "./terminal.css" with { type: "text" };

/*
 * Terminal app. The shell is the Rust `LocalShell` (aphrody-shell-web) running in WebAssembly on the Rio VT state;
 * this file is the host the plans call for ("rendering and complete terminal interaction belong to the host"):
 * rendering, scrollback, selection, clipboard, tabs and splits that share the one VFS, themes, history, completion.
 *
 * Facts the code relies on (crates/aphrody-shell-web/src/local.rs): the line editor is append-only (no cursor
 * movement), the prompt is "aphrody> ", the only Up/Down recall is its in-memory history, `snapshot()` returns the
 * plain text of the screen with no styles and no scrollback. Hence: scrollback is a tall VT screen (ROWS) that the
 * view scrolls, and the host reads the current line from the snapshot.
 */

const ESC = String.fromCharCode(27);
const DEL = String.fromCharCode(127);
const PROMPT = "aphrody> ";
/** VT height: the scrollback the view can reach (older lines scroll out of the VT itself). */
const ROWS = 1000;
const HISTORY_FILE = `${HOME}/.shell_history`;
const HISTORY_MAX = 1000;
const THEMES = ["surface", "inverse", "primary", "secondary", "tertiary"] as const;
type Theme = (typeof THEMES)[number];

const KEYS: Record<string, string> = {
  Enter: "\r",
  Backspace: DEL,
  Tab: "\t",
  Escape: ESC,
  Delete: `${ESC}[3~`,
  Home: `${ESC}[H`,
  End: `${ESC}[F`,
  ArrowUp: `${ESC}[A`,
  ArrowDown: `${ESC}[B`,
  ArrowRight: `${ESC}[C`,
  ArrowLeft: `${ESC}[D`,
};

/** What each command of the browser shell does; the list shown to the user is read from the shell's own `help`. */
const DESCRIPTIONS: Record<string, string> = {
  help: "list the commands",
  clear: "clear the screen",
  env: "print the environment",
  set: "set NAME [VALUE...]  set a variable",
  history: "this session's command history",
  version: "shell version",
  exit: "end the shell (Enter restarts it)",
  cd: "change directory",
  pwd: "print the working directory",
  ls: "list a directory (names only, no flags)",
  mkdir: "make directories",
  rm: "remove files",
  cp: "copy files",
  mv: "move files",
  touch: "create empty files",
  cat: "print files, or standard input",
  basename: "strip the directory from a path",
  dirname: "strip the file name from a path",
  cut: "select fields of each line",
  echo: "print arguments",
  false: "exit with failure",
  true: "exit with success",
  head: "first lines of a file",
  tail: "last lines of a file",
  printf: "formatted output",
  seq: "print a sequence of numbers",
  sort: "sort lines",
  tee: "copy input to a file and to output",
  tr: "translate characters",
  uniq: "drop repeated lines",
  wc: "count lines, words, bytes (-l lines)",
  triage: "triage FILE  binary format report (JSON, aphrody-re)",
  strings: "strings FILE [MIN]  printable strings (JSON)",
  "apply-patch": "apply a *** Begin Patch document read from stdin",
  search: "search WORDS...  BM25 search over the home directory",
  "detect-lang": "detect-lang [FILE]  language of a file or stdin",
};

/** Terminal-side aliases: rewritten on Enter into a command the shell really has. */
export const TERMINAL_ALIASES: Record<string, string> = {
  ll: "ls",
  la: "ls",
  l: "ls",
  dir: "ls",
  type: "cat",
  more: "cat",
  less: "cat",
  cls: "clear",
  q: "exit",
  h: "history",
  md: "mkdir",
  "..": "cd ..",
  "...": "cd ../..",
  "~": `cd ${HOME}`,
  z: "cd <best match of your visited directories>",
};

/** Command names of the wasm shell, read from its own `help` (never a hand-kept list). */
let commandsPromise: Promise<string[]> | undefined;
export function shellCommands(): Promise<string[]> {
  commandsPromise ??= webos().then(os => {
    const probe = os.terminal(600, 4);
    const text = probe.type("help\r").lines.join("\n");
    const match = /commands: (.*)/.exec(text);
    return match?.[1]?.trim().split(/\s+/) ?? Object.keys(DESCRIPTIONS);
  });
  return commandsPromise;
}

interface PickItem {
  label: string;
  detail?: string;
  run: () => void;
}

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(`webos.term.${key}`);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(`webos.term.${key}`, value);
    } catch {
      // Storage unavailable (private mode): settings last for this session only.
    }
  },
};

const sym = (name: string) => {
  const s = h("span", { class: "mi material-symbols-rounded", "aria-hidden": "true" }, name);
  return s;
};

/** Resolve `target` against `cwd` (absolute, `.`, `..`), quotes removed. */
function resolvePath(cwd: string, target: string): string {
  const raw = target.replace(/^(["'])(.*)\1$/, "$2");
  const parts = (raw.startsWith("/") ? [] : cwd.split("/")).concat(raw.split("/"));
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return `/${out.join("/")}`;
}

function listDir(os: WebOs, path: string): { name: string; kind: string }[] {
  try {
    return JSON.parse(os.fs.list(path)) as { name: string; kind: string }[];
  } catch {
    return [];
  }
}

function isDir(os: WebOs, path: string): boolean {
  try {
    os.fs.list(path);
    return true;
  } catch {
    return false;
  }
}

interface DirStat {
  n: number;
  t: number;
}
function loadDirs(): Record<string, DirStat> {
  try {
    return JSON.parse(store.get("dirs") ?? "{}") as Record<string, DirStat>;
  } catch {
    return {};
  }
}

/** zoxide-style: best visited directory whose path contains every word of `query` (frequency, then recency). */
function bestDir(query: string): string | undefined {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const now = Date.now();
  let best: { path: string; score: number } | undefined;
  for (const [path, s] of Object.entries(loadDirs())) {
    const low = path.toLowerCase();
    if (!words.every(w => low.includes(w))) continue;
    const last = words[words.length - 1] ?? "";
    const tail = low.slice(low.lastIndexOf("/") + 1);
    const age = (now - s.t) / 3_600_000;
    const score = s.n * (age < 1 ? 4 : age < 24 ? 2 : 1) * (tail.includes(last) ? 3 : 1);
    if (!best || score > best.score) best = { path, score };
  }
  return best?.path;
}

function visit(path: string) {
  const dirs = loadDirs();
  const s = dirs[path] ?? { n: 0, t: 0 };
  dirs[path] = { n: s.n + 1, t: Date.now() };
  store.set("dirs", JSON.stringify(dirs));
}

async function copyText(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = h("textarea", { style: "position:fixed;opacity:0" });
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

/** Overlay with a filter field and a list; Enter runs the selected item. */
function openPicker(host: HTMLElement, placeholder: string, items: PickItem[], note: string, done: () => void) {
  let selected = 0;
  let shown = items;
  const input = h("input", { type: "text", placeholder, spellcheck: "false", autocomplete: "off" });
  const list = h("ul", { role: "listbox" });
  const box = h("div", { class: "tm-pick" }, input, list);
  if (note) box.append(h("div", { class: "tm-note" }, note));
  const close = () => {
    box.remove();
    done();
  };
  const render = () => {
    list.replaceChildren(
      ...shown.map((item, i) => {
        const li = h(
          "li",
          { role: "option", "aria-selected": i === selected ? "true" : "false" },
          h("b", {}, item.label),
          h("span", {}, item.detail ?? ""),
        );
        li.addEventListener("mousedown", e => {
          e.preventDefault();
          close();
          item.run();
        });
        return li;
      }),
    );
    list.children[selected]?.scrollIntoView({ block: "nearest" });
  };
  input.addEventListener("input", () => {
    const q = input.value.toLowerCase();
    shown = items.filter(i => `${i.label} ${i.detail ?? ""}`.toLowerCase().includes(q));
    selected = 0;
    render();
  });
  input.addEventListener("keydown", e => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      selected = Math.min(shown.length - 1, selected + 1);
      render();
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      selected = Math.max(0, selected - 1);
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = shown[selected];
      close();
      item?.run();
    }
  });
  input.addEventListener("blur", () => setTimeout(() => box.isConnected && close(), 120));
  host.append(box);
  render();
  input.focus();
}

interface Tab {
  page: HTMLElement;
  button: HTMLButtonElement;
  label: HTMLElement;
  panes: Pane[];
  active?: Pane;
  seq: number;
}

interface Pane {
  el: HTMLElement;
  tab: Tab;
  focus(): void;
  dispose(): void;
  cwd: string;
}

/** The Rust shell (aphrody-shell-session) running in WebAssembly on the same files as the explorer. */
export async function terminalApp(root: HTMLElement) {
  const os = await webos();
  const commands = await shellCommands();
  if (!document.getElementById("tm-css")) document.head.append(h("style", { id: "tm-css" }, css));
  void document.fonts?.load('14px "Google Sans Code"');

  let history: string[] = [];
  try {
    history = new TextDecoder()
      .decode(os.fs.read(HISTORY_FILE))
      .split("\n")
      .filter(Boolean)
      .slice(-HISTORY_MAX);
  } catch {
    // First run: no history file yet.
  }
  const remember = (line: string) => {
    if (history[history.length - 1] === line) return;
    history.push(line);
    if (history.length > HISTORY_MAX) history.splice(0, history.length - HISTORY_MAX);
    try {
      os.fs.write(HISTORY_FILE, new TextEncoder().encode(`${history.join("\n")}\n`));
      void os.flush();
    } catch {
      // Read-only file system: history stays in memory.
    }
  };

  let theme = (store.get("theme") as Theme | null) ?? "surface";
  if (!THEMES.includes(theme)) theme = "surface";
  let size = Number(store.get("size")) || 14;
  const app = h("div", { class: "tm-app" });
  const tabsEl = h("div", { class: "tm-tabs", role: "tablist" });
  const body = h("div", { class: "tm-body" });
  const tabs: Tab[] = [];
  let current: Tab | undefined;
  let focused: Pane | undefined;
  let counter = 0;
  const panes = new Set<Pane>();

  const applyLook = () => {
    app.dataset.theme = theme;
    app.style.setProperty("--tm-size", `${size}px`);
    store.set("theme", theme);
    store.set("size", String(size));
    for (const p of panes) p.el.dispatchEvent(new Event("tm-relayout"));
  };

  function createPane(tab: Tab, cwd = HOME): Pane {
    const screen = h("pre", { class: "tm-screen", "aria-live": "off" });
    const view = h("div", { class: "tm-view" }, screen);
    const sink = h("textarea", {
      class: "tm-sink",
      "aria-label": "Terminal input",
      autocapitalize: "off",
      autocomplete: "off",
      spellcheck: "false",
    });
    const status = h("div", { class: "tm-status" });
    const el = h("div", { class: "tm-pane", tabindex: 0 }, view, sink, status);
    let term: Terminal;
    let cols = 80;
    let sig = "";
    let wasExited = false;
    const pane: Pane = {
      el,
      tab,
      cwd,
      focus() {
        focusPane(pane);
      },
      dispose() {
        observer.disconnect();
        panes.delete(pane);
      },
    };

    const startShell = () => {
      term = os.terminal(cols, ROWS);
      // The shell starts in HOME; follow a directory chosen for a new pane with a first command.
      if (pane.cwd !== HOME) term.type(`cd ${pane.cwd}\r`);
      sig = "";
    };

    const measure = () => {
      const probe = h("span", { class: "tm-probe" }, "MMMMMMMMMM");
      el.append(probe);
      const w = probe.getBoundingClientRect().width / 10;
      probe.remove();
      return Math.max(20, Math.floor((view.clientWidth - 20) / (w || 8)) - 1);
    };

    /** Text typed after the prompt, up to the cursor; null when the shell is not at a prompt. */
    const currentLine = (): string | null => {
      const s = term.snapshot();
      const l = s.lines[s.cursor.row] ?? "";
      return l.startsWith(PROMPT) ? l.slice(PROMPT.length, s.cursor.col) : null;
    };

    const drawStatus = (s: Snapshot) => {
      status.replaceChildren(
        h("span", {}, pane.cwd),
        h("span", { class: "grow" }),
        h("span", {}, term.exited ? "exited · Enter restarts" : `${cols}×${s.rows} · ${history.length} in history`),
      );
    };

    const draw = (stick = false) => {
      const s = term.snapshot();
      let last = s.lines.length - 1;
      while (last > s.cursor.row && !(s.lines[last] ?? "").trim()) last--;
      const rows = s.lines.slice(0, last + 1).map(l => l.trimEnd());
      const key = `${s.cursor.row},${s.cursor.col},${s.cursor.visible ? 1 : 0},${term.exited ? 1 : 0}|${rows.join("\n")}`;
      if (key === sig) return;
      sig = key;
      const atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 8;
      const before = rows.slice(0, s.cursor.row);
      const row = (rows[s.cursor.row] ?? "").padEnd(s.cursor.col + 1);
      const head = (before.length ? `${before.join("\n")}\n` : "") + row.slice(0, s.cursor.col);
      const tail = row.slice(s.cursor.col + 1).trimEnd() + rows.slice(s.cursor.row + 1).map(l => `\n${l}`).join("");
      const nodes: (Node | string)[] = [head];
      const ch = row[s.cursor.col] ?? " ";
      nodes.push(s.cursor.visible ? h("span", { class: "tm-cursor" }, ch) : ch, tail);
      screen.replaceChildren(...nodes);
      drawStatus(s);
      if (stick || atBottom) view.scrollTop = view.scrollHeight;
    };

    const send = (data: string) => {
      if (term.exited) return;
      term.type(data);
      draw(true);
      if (term.exited && !wasExited) wasExited = true;
    };

    const replaceLine = (text: string) => {
      const line = currentLine();
      if (line === null) return;
      send(DEL.repeat(line.length) + text);
    };

    const expand = (line: string): string => {
      const first = line.split(/\s+/)[0] ?? "";
      const rest = line.slice(first.length);
      if (first === "z") {
        const target = bestDir(rest);
        return target ? `cd ${target}` : `echo z: no visited directory matches${rest}`;
      }
      const alias = TERMINAL_ALIASES[first];
      return alias && first !== "z" ? alias + rest : line;
    };

    const track = (line: string) => {
      const m = /^cd(?:\s+(\S.*))?$/.exec(line.trim());
      if (!m) return;
      const next = resolvePath(pane.cwd, m[1] ?? "/");
      if (!isDir(os, next)) return;
      pane.cwd = next;
      visit(next);
      tab.label.textContent = tab.panes[0] === pane ? next.split("/").pop() || "/" : tab.label.textContent;
    };

    const enter = () => {
      if (term.exited) {
        startShell();
        draw(true);
        wasExited = false;
        return;
      }
      const raw = currentLine()?.trim() ?? "";
      if (raw) {
        const line = expand(raw);
        if (line !== raw) replaceLine(line);
        remember(raw);
        track(line);
      }
      send("\r");
    };

    const complete = () => {
      const line = currentLine();
      if (line === null) return;
      const word = /\S*$/.exec(line)?.[0] ?? "";
      const atCommand = line.slice(0, line.length - word.length).trim() === "" && !word.includes("/");
      let found: { text: string; dir: boolean }[];
      if (atCommand) {
        found = commands.filter(c => c.startsWith(word)).map(c => ({ text: c, dir: false }));
        found.push(...Object.keys(TERMINAL_ALIASES).filter(a => a.startsWith(word) && a !== "z").map(a => ({ text: a, dir: false })));
      } else {
        const cut = word.lastIndexOf("/") + 1;
        const dirPart = word.slice(0, cut);
        const base = word.slice(cut);
        found = listDir(os, resolvePath(pane.cwd, dirPart || "."))
          .filter(e => e.name.startsWith(base))
          .map(e => ({ text: dirPart + e.name + (e.kind === "dir" ? "/" : ""), dir: e.kind === "dir" }));
      }
      const unique = [...new Map(found.map(f => [f.text, f])).values()];
      if (unique.length === 0) return;
      if (unique.length === 1) {
        const f = unique[0]!;
        send(f.text.slice(word.length) + (f.dir ? "" : " "));
        return;
      }
      let prefix = unique[0]!.text;
      for (const f of unique) while (!f.text.startsWith(prefix)) prefix = prefix.slice(0, -1);
      if (prefix.length > word.length) {
        send(prefix.slice(word.length));
        return;
      }
      openPicker(
        body,
        "Complete…",
        unique.map(f => ({ label: f.text, run: () => send(f.text.slice(word.length) + (f.dir ? "" : " ")) })),
        "",
        () => el.focus({ preventScroll: true }),
      );
    };

    const selectionText = () => {
      const sel = getSelection();
      if (!sel || sel.isCollapsed || !sel.anchorNode || !view.contains(sel.anchorNode)) return "";
      return sel
        .toString()
        .split("\n")
        .map(l => l.trimEnd())
        .join("\n");
    };

    const paste = (text: string) => send(text.replace(/\r\n|\n/g, "\r"));

    const pickHistory = () => {
      const seen = new Set<string>();
      const items: PickItem[] = [];
      for (const entry of history.toReversed()) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        items.push({ label: entry, run: () => replaceLine(entry) });
      }
      openPicker(body, "Search history…", items, "Enter puts the line at the prompt; Escape cancels.", () =>
        el.focus({ preventScroll: true }),
      );
    };

    const palette = () => {
      const items: PickItem[] = [
        { label: "New tab", detail: "Ctrl+Shift+Enter", run: () => addTab() },
        { label: "Split right", detail: "Ctrl+Shift+E · shares the same files", run: () => split(pane, "row") },
        { label: "Split down", detail: "Ctrl+Shift+Y", run: () => split(pane, "col") },
        { label: "Close pane", detail: "Ctrl+Shift+X", run: () => closePane(pane) },
        { label: "Search history", detail: "Ctrl+R", run: pickHistory },
        { label: "Copy selection", detail: "Ctrl+Shift+C · selecting also copies", run: () => void copyText(selectionText()) },
        { label: "Paste", detail: "Ctrl+Shift+V", run: () => void navigator.clipboard.readText().then(paste) },
        { label: "Next theme", detail: `now ${theme} (Material 3 roles)`, run: () => nextTheme() },
        { label: "Larger text", run: () => setSize(size + 1) },
        { label: "Smaller text", run: () => setSize(size - 1) },
        { label: "Clear scrollback", detail: "Ctrl+L redraws the prompt", run: () => send(`${ESC}[2J${ESC}[H`) },
      ];
      for (const [name, target] of Object.entries(TERMINAL_ALIASES))
        items.push({
          label: name,
          detail: name === "z" ? "z WORDS  jump to a visited directory (terminal alias)" : `alias for ${target}`,
          run: () => replaceLine(`${name} `),
        });
      for (const name of commands)
        items.push({ label: name, detail: DESCRIPTIONS[name] ?? "", run: () => replaceLine(`${name} `) });
      openPicker(
        body,
        "Command palette",
        items,
        "Commands are read from this shell's help. Not available here: rg, fd, bat, tldr, zoxide (z is an alias), grep, find.",
        () => el.focus({ preventScroll: true }),
      );
    };

    el.addEventListener("keydown", e => {
      if (e.isComposing || e.key === "Process" || e.key === "Dead" || e.key === "Unidentified") return;
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
      if (e.altKey || e.metaKey) return;
      if (ctrl && e.shiftKey) {
        const act: Record<string, () => void> = {
          c: () => void copyText(selectionText()),
          v: () => void navigator.clipboard.readText().then(paste),
          p: palette,
          e: () => split(pane, "row"),
          y: () => split(pane, "col"),
          x: () => closePane(pane),
          enter: () => addTab(),
          arrowleft: () => cycleTab(-1),
          arrowright: () => cycleTab(1),
          arrowup: () => cyclePane(pane, -1),
          arrowdown: () => cyclePane(pane, 1),
        };
        const fn = act[key];
        if (fn) {
          e.preventDefault();
          e.stopPropagation();
          fn();
        }
        return;
      }
      if (e.shiftKey && (key === "pageup" || key === "pagedown")) {
        e.preventDefault();
        view.scrollBy({ top: (key === "pageup" ? -1 : 1) * view.clientHeight * 0.9 });
        return;
      }
      if (key === "pageup" || key === "pagedown") {
        e.preventDefault();
        view.scrollBy({ top: (key === "pageup" ? -1 : 1) * view.clientHeight * 0.9 });
        return;
      }
      if (ctrl) {
        if (key === "c") {
          const text = selectionText();
          if (text) {
            e.preventDefault();
            void copyText(text);
            getSelection()?.removeAllRanges();
            return;
          }
          e.preventDefault();
          send("\x03");
          return;
        }
        if (key === "v") return; // the paste event delivers the text
        e.preventDefault();
        if (key === "r") return pickHistory();
        if (key === "u") return replaceLine("");
        if (key === "w") {
          const line = currentLine();
          if (line !== null) send(DEL.repeat(line.length - line.trimEnd().replace(/\S+$/, "").length));
          return;
        }
        if (e.key.length === 1) {
          const code = e.key.toUpperCase().charCodeAt(0) - 64;
          if (code > 0 && code < 32) send(String.fromCharCode(code));
        }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        enter();
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        complete();
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey) {
        e.preventDefault();
        send(e.key);
        return;
      }
      const data = KEYS[e.key];
      if (data) {
        e.preventDefault();
        send(data);
      }
    });
    // Input that never produces a usable keydown: IME composition, mobile keyboards.
    sink.addEventListener("input", () => {
      if (sink.value) send(sink.value);
      sink.value = "";
    });
    el.addEventListener("paste", e => {
      e.preventDefault();
      paste(e.clipboardData?.getData("text") ?? "");
    });
    el.addEventListener("copy", e => {
      const text = selectionText();
      if (!text) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", text);
    });
    // Selecting with the mouse copies, like a Linux terminal; a plain click focuses the input.
    view.addEventListener("mouseup", () => {
      const text = selectionText();
      if (text) {
        void copyText(text);
        el.focus({ preventScroll: true });
      } else sink.focus({ preventScroll: true });
    });
    el.addEventListener("focusin", () => focusPane(pane, false));

    const observer = new ResizeObserver(() => {
      const next = measure();
      if (next !== cols) {
        cols = next;
        term.resize(cols, ROWS);
        sig = "";
      }
      draw();
    });
    el.addEventListener("tm-relayout", () => {
      cols = 0; // force a resize and redraw with the new font metrics
      observer.disconnect();
      observer.observe(view);
    });
    cols = 80;
    startShell();
    panes.add(pane);
    tab.panes.push(pane);
    observer.observe(view);
    // The cursor row follows the shell's output even when it changes without a key (history recall already redraws).
    draw(true);
    return pane;
  }

  function focusPane(p: Pane, move = true) {
    focused = p;
    p.tab.active = p;
    for (const q of panes) q.el.classList.toggle("focus", q === p);
    if (move) (p.el.querySelector(".tm-sink") as HTMLElement | null)?.focus({ preventScroll: true });
  }

  function selectTab(tab: Tab) {
    current = tab;
    for (const t of tabs) {
      t.page.classList.toggle("on", t === tab);
      t.button.setAttribute("aria-selected", t === tab ? "true" : "false");
    }
    const pane = tab.active ?? tab.panes[0];
    if (pane) {
      requestAnimationFrame(() => {
        for (const q of tab.panes) q.el.dispatchEvent(new Event("tm-relayout"));
        focusPane(pane);
      });
    }
  }

  function addTab(cwd = focused?.cwd ?? HOME) {
    const label = h("span", {}, "shell");
    const close = h("span", { class: "tm-x", title: "Close tab" }, "×");
    const button = h("button", { class: "tm-tab", role: "tab", "aria-selected": "false" }, label, close);
    const page = h("div", { class: "tm-tabpage" });
    const tab: Tab = { page, button, label, panes: [], seq: ++counter };
    button.addEventListener("click", () => selectTab(tab));
    close.addEventListener("click", e => {
      e.stopPropagation();
      closeTab(tab);
    });
    tabs.push(tab);
    tabsEl.append(button);
    body.append(page);
    const pane = createPane(tab, cwd);
    page.append(pane.el);
    label.textContent = cwd.split("/").pop() || "/";
    selectTab(tab);
  }

  function closeTab(tab: Tab) {
    for (const p of tab.panes) p.dispose();
    tab.page.remove();
    tab.button.remove();
    tabs.splice(tabs.indexOf(tab), 1);
    if (tabs.length === 0) addTab(HOME);
    else if (current === tab) selectTab(tabs[Math.max(0, tabs.length - 1)]!);
  }

  function cycleTab(step: number) {
    if (!current || tabs.length < 2) return;
    selectTab(tabs[(tabs.indexOf(current) + step + tabs.length) % tabs.length]!);
  }

  function split(pane: Pane, dir: "row" | "col") {
    const next = createPane(pane.tab, pane.cwd);
    const box = h("div", { class: `tm-split${dir === "col" ? " col" : ""}` });
    pane.el.replaceWith(box);
    box.append(pane.el, next.el);
    focusPane(next);
  }

  function closePane(pane: Pane) {
    const tab = pane.tab;
    pane.dispose();
    tab.panes.splice(tab.panes.indexOf(pane), 1);
    const parent = pane.el.parentElement;
    pane.el.remove();
    if (tab.panes.length === 0) return closeTab(tab);
    if (parent?.classList.contains("tm-split") && parent.children.length === 1) parent.replaceWith(parent.children[0]!);
    tab.active = tab.panes[0];
    focusPane(tab.panes[0]!);
  }

  function cyclePane(pane: Pane, step: number) {
    const list = pane.tab.panes;
    if (list.length < 2) return;
    focusPane(list[(list.indexOf(pane) + step + list.length) % list.length]!);
  }

  function nextTheme() {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]!;
    applyLook();
  }

  function setSize(next: number) {
    size = Math.min(24, Math.max(10, next));
    applyLook();
  }

  const button = (title: string, name: string, onclick: () => void) => {
    const b = h("button", { class: "tm-btn", title, "aria-label": title }, sym(name));
    b.addEventListener("click", onclick);
    b.addEventListener("mousedown", e => e.preventDefault());
    return b;
  };
  app.append(
    h(
      "div",
      { class: "tm-bar" },
      tabsEl,
      button("New tab (Ctrl+Shift+Enter)", "add", () => addTab()),
      button("Split right (Ctrl+Shift+E)", "vertical_split", () => focused && split(focused, "row")),
      button("Split down (Ctrl+Shift+Y)", "horizontal_split", () => focused && split(focused, "col")),
      button("Smaller text", "text_decrease", () => setSize(size - 1)),
      button("Larger text", "text_increase", () => setSize(size + 1)),
      button("Theme", "palette", nextTheme),
      button("Command palette (Ctrl+Shift+P)", "terminal", () => {
        focused?.el.dispatchEvent(
          new KeyboardEvent("keydown", { key: "P", ctrlKey: true, shiftKey: true, bubbles: true }),
        );
      }),
    ),
    body,
  );
  root.append(app);
  applyLook();
  addTab(HOME);
  void document.fonts?.ready.then(() => {
    for (const p of panes) p.el.dispatchEvent(new Event("tm-relayout"));
  });
}

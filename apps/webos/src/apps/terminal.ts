// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { webos } from "../os";

const ESC = String.fromCharCode(27);
const KEYS: Record<string, string> = {
  Enter: "\r",
  Backspace: String.fromCharCode(127),
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

/** The Rust shell (aphrody-shell-session) running in WebAssembly on the same files as the explorer. */
export async function terminalApp(root: HTMLElement) {
  const os = await webos();
  const screen = h("pre", { class: "term-screen", "aria-live": "off" });
  const sink = h("textarea", {
    class: "term-sink",
    "aria-label": "Terminal input",
    autocapitalize: "off",
    spellcheck: "false",
  });
  const wrap = h("div", { class: "term", tabindex: -1 }, screen, sink);
  root.append(wrap);
  const measure = () => {
    const probe = h("span", { class: "term-probe" }, "M");
    screen.append(probe);
    const r = probe.getBoundingClientRect();
    probe.remove();
    return {
      cols: Math.max(20, Math.floor(wrap.clientWidth / (r.width || 8)) - 1),
      rows: Math.max(5, Math.floor(wrap.clientHeight / (r.height || 17))),
    };
  };
  let { cols, rows } = measure();
  const term = os.terminal(cols, rows);
  const draw = () => {
    const s = term.snapshot();
    const lines = s.lines.slice();
    if (s.cursor.visible && lines[s.cursor.row] !== undefined) {
      const l = lines[s.cursor.row]!.padEnd(s.cursor.col + 1);
      lines[s.cursor.row] = `${l.slice(0, s.cursor.col)}█${l.slice(s.cursor.col + 1)}`;
    }
    screen.textContent = lines.join("\n");
  };
  const send = (data: string) => {
    term.type(data);
    draw();
  };
  sink.addEventListener("keydown", e => {
    if (e.isComposing) return;
    let data = KEYS[e.key];
    if (!data && e.ctrlKey && e.key.length === 1) data = String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64);
    if (data) {
      e.preventDefault();
      send(data);
    }
  });
  sink.addEventListener("input", () => {
    if (sink.value) send(sink.value);
    sink.value = "";
  });
  // mousedown would move focus to the wrapper after pointerdown; keep it on the hidden input.
  wrap.addEventListener("mousedown", e => {
    e.preventDefault();
    sink.focus();
  });
  new ResizeObserver(() => {
    const m = measure();
    if (m.cols !== cols || m.rows !== rows) {
      ({ cols, rows } = m);
      term.resize(cols, rows);
      draw();
    }
  }).observe(wrap);
  draw();
  sink.focus();
}

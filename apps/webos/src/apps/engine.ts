// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { webos } from "../os";

const SAMPLE = `// Bun Engine playground: runs in an isolated worker, 5 s budget.
const fib = n => (n < 2 ? n : fib(n - 1) + fib(n - 2));
console.log("fib(24) =", fib(24));
console.log(await fetch("/api/health").then(r => r.json()));
`;

const WORKER_SRC = `
self.onmessage = async ({ data }) => {
  const out = (kind, args) => self.postMessage({ kind, text: args.map(a => typeof a === "string" ? a : JSON.stringify(a, null, 2)).join(" ") });
  console.log = (...a) => out("log", a);
  console.error = (...a) => out("err", a);
  console.warn = (...a) => out("err", a);
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const value = await new AsyncFunction(data)();
    if (value !== undefined) out("log", ["=>", value]);
  } catch (error) {
    out("err", [String(error && error.stack || error)]);
  }
  self.postMessage({ kind: "done" });
};`;

/** JavaScript/TypeScript playground in a worker, plus run-from-file on the shared Rust file system. */
export async function engineApp(root: HTMLElement) {
  const os = await webos();
  const code = h("textarea", { class: "editor", spellcheck: "false", "aria-label": "Code" });
  code.value = SAMPLE;
  const out = h("pre", { class: "engine-out", "aria-live": "polite" });
  const path = h("input", { class: "fld grow", placeholder: "/home/user/script.js", "aria-label": "File path" });
  const info = h("div", { class: "files-status" }, `webos-wasm ${os.version} · ${os.persistent ? "OPFS" : "memory"}`);

  let worker: Worker | undefined;
  const run = () => {
    worker?.terminate();
    out.textContent = "";
    const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" }));
    const w = (worker = new Worker(url));
    URL.revokeObjectURL(url);
    const timer = setTimeout(() => {
      w.terminate();
      out.append(h("span", { class: "err" }, "\nTimed out after 5 s\n"));
    }, 5000);
    w.onmessage = ({ data }) => {
      if (data.kind === "done") {
        clearTimeout(timer);
        w.terminate();
      } else out.append(h("span", { class: data.kind === "err" ? "err" : "" }, `${data.text}\n`));
    };
    w.postMessage(code.value);
  };
  const tbtn = (text: string, fn: () => void) => h("button", { class: "btn", onclick: fn }, text);
  const fileLoad = () => {
    try {
      code.value = new TextDecoder().decode(os.fs.read(path.value.trim()));
    } catch (error) {
      out.textContent = String(error);
    }
  };
  const fileSave = async () => {
    try {
      os.fs.write(path.value.trim(), new TextEncoder().encode(code.value));
      await os.flush();
      info.textContent = `saved ${path.value}`;
    } catch (error) {
      out.textContent = String(error);
    }
  };
  code.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  });
  root.append(
    h(
      "div",
      { class: "engine" },
      h(
        "div",
        { class: "files-bar" },
        tbtn("Run", run),
        path,
        tbtn("Open", fileLoad),
        tbtn("Save", () => void fileSave()),
      ),
      code,
      out,
      info,
    ),
  );
}

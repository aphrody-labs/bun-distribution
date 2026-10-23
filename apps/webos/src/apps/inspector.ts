// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { webos, HOME } from "../os";

function render(value: unknown, depth = 0): HTMLElement {
  if (Array.isArray(value)) {
    const box = h("div", { class: "ins-list" });
    for (const item of value.slice(0, 200)) {
      box.append(
        typeof item === "object" && item
          ? h("div", { class: "ins-card" }, render(item, depth + 1))
          : h("div", { class: "mono" }, String(item)),
      );
    }
    if (value.length > 200) box.append(h("div", { class: "muted" }, `… ${value.length - 200} more`));
    return box;
  }
  if (value && typeof value === "object") {
    const dl = h("dl", { class: "kv" });
    for (const [k, v] of Object.entries(value)) {
      dl.append(
        h("dt", {}, k),
        h("dd", {}, typeof v === "object" && v ? render(v, depth + 1) : h("span", { class: "mono" }, String(v))),
      );
    }
    return dl;
  }
  return h("span", { class: "mono" }, String(value));
}

/** Binary analysis (aphrody-re compiled to WebAssembly): format, sections, hashes and strings of any file. */
/** `start` analyses that file of the VFS right away (Files > open with Inspector). */
export async function inspectorApp(root: HTMLElement, start?: string) {
  const os = await webos();
  const out = h(
    "div",
    { class: "ins-out" },
    h("div", { class: "empty" }, "Choose a file to analyse. Nothing leaves your device."),
  );
  const file = h("input", { type: "file", "aria-label": "File to analyse" });
  const path = h("input", { class: "fld grow", value: `${HOME}/`, "aria-label": "Path in Files" });
  const run = (target: string) => {
    try {
      out.replaceChildren(render(JSON.parse(os.fs.triage(target))));
    } catch (error) {
      out.replaceChildren(h("div", { class: "empty err" }, `Could not analyse this file: ${String(error)}`));
    }
  };
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    const target = `${HOME}/.inspect/${f.name}`;
    os.fs.write(target, new Uint8Array(await f.arrayBuffer()));
    await os.flush();
    path.value = target;
    run(target);
  });
  root.append(
    h(
      "div",
      { class: "store" },
      h(
        "div",
        { class: "files-bar" },
        file,
        path,
        h("button", { class: "btn", onclick: () => run(path.value.trim()) }, "Analyse"),
      ),
      out,
    ),
  );
  if (start) {
    path.value = start;
    run(start);
  }
}

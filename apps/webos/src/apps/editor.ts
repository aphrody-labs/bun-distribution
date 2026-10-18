// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { webos } from "../os";

/** Plain text editor over the Rust file system; Ctrl+S saves to OPFS. */
export async function editorApp(root: HTMLElement, path: string, text: string) {
  const os = await webos();
  const area = h("textarea", { class: "editor", spellcheck: "false", "aria-label": path });
  area.value = text;
  const status = h("div", { class: "files-status" }, path);
  const save = async () => {
    try {
      os.fs.write(path, new TextEncoder().encode(area.value));
      await os.flush();
      status.textContent = `${path} · saved`;
    } catch (error) {
      status.textContent = String(error);
    }
  };
  area.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  });
  root.append(h("div", { class: "editor-wrap" }, area, status));
}

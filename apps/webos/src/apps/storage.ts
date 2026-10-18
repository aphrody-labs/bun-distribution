// SPDX-License-Identifier: Apache-2.0
import { h } from "../dom";
import { webos } from "../os";

interface Node {
  name: string;
  path: string;
  size: number;
  dir: boolean;
  children: Node[];
}
interface Cell {
  n: Node;
  x: number;
  y: number;
  w: number;
  h: number;
}
const fmt = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/** Disk usage of the Rust file system as a treemap (Disktree in Omarchy); click a folder to zoom in. */
export async function storageApp(root: HTMLElement) {
  const os = await webos();
  const scan = (path: string, name: string): Node => {
    const rows = JSON.parse(os.fs.list(path)) as { name: string; kind: string; size: number }[];
    const children: Node[] = [];
    let size = 0;
    for (const r of rows) {
      const p = path === "/" ? `/${r.name}` : `${path}/${r.name}`;
      const n: Node =
        r.kind === "dir" ? scan(p, r.name) : { name: r.name, path: p, size: r.size, dir: false, children: [] };
      children.push(n);
      size += n.size;
    }
    return { name, path, size, dir: true, children: children.sort((a, b) => b.size - a.size) };
  };
  const stage = h("div", { class: "treemap" });
  const crumb = h("div", { class: "files-bar" });
  const status = h("div", { class: "files-status" });
  const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);

  /** Slice and dice: split the longer side in proportion to size. */
  function layout(nodes: Node[], out: Cell[]) {
    const total = nodes.reduce((a, n) => a + Math.max(n.size, 1), 0);
    let pos = 0;
    for (const n of nodes) {
      const share = Math.max(n.size, 1) / total;
      out.push({ n, x: pos * 100, y: 0, w: share * 100, h: 100 });
      pos += share;
    }
  }
  function show(node: Node) {
    crumb.replaceChildren(
      h("button", { class: "btn tonal", onclick: () => show(tree) }, "Root"),
      h("span", { class: "mono" }, node.path),
    );
    stage.replaceChildren();
    const out: Cell[] = [];
    layout(node.children, out);
    for (const { n, x, y, w, h: hh } of out) {
      stage.append(
        h(
          "button",
          {
            class: "tm-cell",
            title: `${n.path} · ${fmt(n.size)}`,
            style: `left:${x}%;top:${y}%;width:${w}%;height:${hh}%;background:hsl(${hue(n.name)} 45% ${n.dir ? 32 : 24}%)`,
            onclick: () => n.dir && n.children.length && show(n),
          },
          h("span", {}, n.name),
          h("small", {}, fmt(n.size)),
        ),
      );
    }
    if (!out.length) stage.append(h("div", { class: "empty" }, "Empty folder"));
    status.textContent = `${fmt(node.size)} in ${node.children.length} item${node.children.length === 1 ? "" : "s"} · ${os.persistent ? "saved in this browser (OPFS)" : "memory only"}`;
  }
  const tree = scan("/", "/");
  root.append(h("div", { class: "store" }, crumb, stage, status));
  show(tree);
}

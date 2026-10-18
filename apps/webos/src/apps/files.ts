// SPDX-License-Identifier: Apache-2.0
import { ask, h, icon } from "../dom";
import { webos, HOME } from "../os";

interface Row {
  name: string;
  kind: "file" | "dir";
  size: number;
}

const fmt = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const join = (a: string, b: string) => (a === "/" ? `/${b}` : `${a}/${b}`);
const parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
const EXT_ICON: Record<string, string> = {
  png: "Image",
  jpg: "Image",
  jpeg: "Image",
  gif: "Image",
  webp: "Image",
  svg: "Image",
  bmp: "Image",
  ico: "Image",
  mp3: "Audio",
  wav: "Audio",
  ogg: "Audio",
  flac: "Audio",
  m4a: "Audio",
  opus: "Audio",
  mp4: "Movie",
  webm: "Movie",
  mkv: "Movie",
  mov: "Movie",
  ogv: "Movie",
  pdf: "Document_pdf",
  doc: "Document_doc",
  docx: "Document_doc",
  odt: "Document_doc",
  xls: "Document_xls",
  xlsx: "Document_xls",
  csv: "Document_xls",
  txt: "Text_txt",
  md: "Text",
  json: "Text",
  toml: "Text",
  yaml: "Text",
  yml: "Text",
  html: "Text",
  css: "Text",
  ts: "Text",
  js: "Text",
  rs: "Text",
  sh: "Terminal",
  zip: "Archive",
  tar: "Archive",
  gz: "Archive",
  "7z": "Archive",
  rar: "Archive",
  exe: "Application",
  bin: "Application",
  wasm: "Package",
  db: "Database",
  sqlite: "Database",
  nds: "Game",
  gba: "Game",
  iso: "Drive",
};
const kindIcon = (r: Row) =>
  r.kind === "dir" ? "Folder" : (EXT_ICON[r.name.split(".").pop()?.toLowerCase() ?? ""] ?? "Document");
const fileIcon = (name: string) =>
  h("img", { class: "ficon", src: `/icons/${name}.png`, alt: "", width: 28, height: 28, loading: "lazy" });

/** File explorer over the Rust VFS (aphrody-shell-vfs) persisted in OPFS; drop files to import. */
export async function filesApp(root: HTMLElement, openText: (path: string, text: string) => void) {
  const os = await webos();
  let cwd = HOME;
  const history: string[] = [];
  let selected: string | undefined;

  const path = h("input", { class: "fld grow", "aria-label": "Path", spellcheck: "false" });
  const list = h("div", { class: "files-list", role: "listbox", "aria-label": "Files" });
  const status = h("div", { class: "files-status" });
  const fileInput = h("input", { type: "file", multiple: true, hidden: true });

  const tool = (name: string, label: string, fn: () => void) =>
    h("button", { class: "tbtn", title: label, "aria-label": label, onclick: fn }, icon(name));

  async function go(to: string, push = true) {
    try {
      const rows = JSON.parse(os.fs.list(to)) as Row[];
      if (push) history.push(cwd);
      cwd = to;
      path.value = cwd;
      rows.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
      list.replaceChildren(
        ...rows.map(r => {
          const full = join(cwd, r.name);
          const row = h(
            "div",
            { class: "frow", role: "option", tabindex: 0 },
            fileIcon(kindIcon(r)),
            h("span", { class: "fname" }, r.name),
            h("span", { class: "fsize" }, r.kind === "dir" ? "" : fmt(r.size)),
          );
          row.addEventListener("click", () => {
            selected = full;
            for (const el of list.children) el.classList.remove("sel");
            row.classList.add("sel");
          });
          row.addEventListener("dblclick", () => void open(full, r));
          row.addEventListener("keydown", e => {
            if (e.key === "Enter") void open(full, r);
            if (e.key === "Delete") void remove(full);
          });
          return row;
        }),
      );
      if (!rows.length) list.append(h("div", { class: "empty" }, "This folder is empty"));
      status.textContent = `${rows.length} item${rows.length === 1 ? "" : "s"} · ${os.persistent ? "saved in this browser (OPFS)" : "memory only"}`;
    } catch (error) {
      status.textContent = String(error);
    }
  }
  async function open(full: string, r: Row) {
    if (r.kind === "dir") return go(full);
    const bytes = os.fs.read(full);
    if (bytes.byteLength > 2_000_000) {
      status.textContent = "File too large to preview";
      return;
    }
    openText(full, new TextDecoder().decode(bytes));
  }
  async function remove(full: string) {
    await mutate(() => os.fs.remove(full));
  }
  async function mutate(fn: () => void | Promise<void>) {
    try {
      await fn();
      await os.flush();
    } catch (error) {
      status.textContent = String(error);
    }
    await go(cwd, false);
  }
  const importFiles = (files: Iterable<File>) =>
    mutate(async () => {
      for (const f of files) os.fs.write(join(cwd, f.name), new Uint8Array(await f.arrayBuffer()));
    });

  path.addEventListener("keydown", e => {
    if (e.key === "Enter") void go(path.value.trim() || "/");
  });
  fileInput.addEventListener("change", async () => {
    await importFiles(Array.from(fileInput.files ?? []));
    fileInput.value = "";
  });
  list.addEventListener("dragover", e => e.preventDefault());
  list.addEventListener("drop", e => {
    e.preventDefault();
    void importFiles(Array.from(e.dataTransfer?.files ?? []));
  });

  const bar = h(
    "div",
    { class: "files-bar" },
    tool("back", "Back", () => {
      const p = history.pop();
      if (p) void go(p, false);
    }),
    tool("up", "Parent folder", () => void go(parent(cwd))),
    tool("reload", "Refresh", () => void go(cwd, false)),
    path,
    tool("plus", "New folder", async () => {
      const n = await ask("New folder", "Folder name");
      if (n) void mutate(() => os.fs.mkdir(join(cwd, n)));
    }),
    tool("file", "New file", async () => {
      const n = await ask("New file", "File name");
      if (n) void mutate(() => os.fs.write(join(cwd, n), new Uint8Array()));
    }),
    tool("upload", "Upload files", () => fileInput.click()),
    tool("trash", "Delete selected", () => {
      if (selected) void remove(selected);
    }),
  );

  const places = h(
    "nav",
    { class: "places", "aria-label": "Places" },
    h("button", { class: "place", onclick: () => void go(HOME) }, fileIcon("Home"), "Home"),
    h("button", { class: "place", onclick: () => void go("/") }, fileIcon("Drive"), "Root"),
  );
  root.append(h("div", { class: "files" }, bar, h("div", { class: "files-main" }, places, list), status, fileInput));
  await go(cwd, false);
}

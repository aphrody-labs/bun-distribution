#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Export the Material Symbols catalogue (vendor/material-design-icons) for every UI and OS surface:
//   names.json               sorted symbol names (UI pickers, wasm OS launcher)
//   sprite-<style>[-fill].svg  one <symbol id="name"> sprite per style (web, Tauri, wxwasm)
//   freedesktop/<Theme>/     freedesktop icon theme (index.theme + scalable/*) for GNOME, COSMIC, KDE
// Usage: bun export-theme.ts --out dist/icons [--theme Aphrody-M3] [--styles outlined,rounded,sharp]
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  readSymbolSvg,
  symbolNames,
  hasSymbol,
  type SymbolStyle,
} from "../src/index.ts";

const args = process.argv.slice(2);
const flag = (n: string, d: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? (args[i + 1] ?? d) : d;
};
const out = resolve(flag("out", "dist/icons"));
const theme = flag("theme", "Aphrody-M3");
const styles = flag("styles", "outlined,rounded,sharp").split(
  ",",
) as SymbolStyle[];

const pending: Promise<unknown>[] = [];
const write = (path: string, content: string): void =>
  void pending.push(Bun.write(path, content));

const names = symbolNames();
if (names.length === 0) {
  console.error("catalogue empty: run `bun scripts/sync-catalogue.ts` first");
  process.exit(1);
}
mkdirSync(out, { recursive: true });
await Bun.write(join(out, "names.json"), JSON.stringify(names));

const inner = (svg: string) =>
  svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const viewBox = (svg: string) =>
  /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 -960 960 960";

let sprites = 0;
for (const style of styles) {
  for (const filled of [false, true]) {
    const symbols: string[] = [];
    let box = "0 -960 960 960";
    for (const name of names) {
      if (!hasSymbol(name, style, 400, filled)) continue;
      const svg = readSymbolSvg(name, style, 400, filled);
      box = viewBox(svg);
      symbols.push(
        `<symbol id="${name}" viewBox="${box}">${inner(svg)}</symbol>`,
      );
    }
    write(
      join(out, `sprite-${style}${filled ? "-fill" : ""}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols.join("")}</svg>`,
    );
    sprites++;
  }
}

// freedesktop theme: full catalogue under scalable/material/, standard names mapped onto it.
const MAP: Record<string, [string, string]> = {
  "document-open": ["actions", "folder_open"],
  "document-save": ["actions", "save"],
  "document-new": ["actions", "note_add"],
  "document-print": ["actions", "print"],
  "edit-copy": ["actions", "content_copy"],
  "edit-cut": ["actions", "content_cut"],
  "edit-paste": ["actions", "content_paste"],
  "edit-delete": ["actions", "delete"],
  "edit-find": ["actions", "search"],
  "edit-undo": ["actions", "undo"],
  "edit-redo": ["actions", "redo"],
  "go-previous": ["actions", "arrow_back"],
  "go-next": ["actions", "arrow_forward"],
  "go-up": ["actions", "arrow_upward"],
  "go-down": ["actions", "arrow_downward"],
  "go-home": ["actions", "home"],
  "list-add": ["actions", "add"],
  "list-remove": ["actions", "remove"],
  "view-refresh": ["actions", "refresh"],
  "window-close": ["actions", "close"],
  "view-fullscreen": ["actions", "fullscreen"],
  "open-menu": ["actions", "menu"],
  "system-shutdown": ["actions", "power_settings_new"],
  "dialog-information": ["status", "info"],
  "dialog-warning": ["status", "warning"],
  "dialog-error": ["status", "error"],
  "dialog-question": ["status", "help"],
  "network-wireless": ["status", "wifi"],
  battery: ["status", "battery_full"],
  "audio-volume-high": ["status", "volume_up"],
  "audio-volume-muted": ["status", "volume_off"],
  folder: ["places", "folder"],
  "user-home": ["places", "home"],
  "user-trash": ["places", "delete"],
  "folder-documents": ["places", "description"],
  "folder-download": ["places", "download"],
  "folder-pictures": ["places", "image"],
  "folder-music": ["places", "library_music"],
  "folder-videos": ["places", "video_library"],
  "text-x-generic": ["mimetypes", "description"],
  "image-x-generic": ["mimetypes", "image"],
  "audio-x-generic": ["mimetypes", "music_note"],
  "video-x-generic": ["mimetypes", "movie"],
  "application-x-executable": ["mimetypes", "terminal"],
  "package-x-generic": ["mimetypes", "package_2"],
  "preferences-system": ["apps", "settings"],
  "utilities-terminal": ["apps", "terminal"],
  "system-file-manager": ["apps", "folder_open"],
  "web-browser": ["apps", "language"],
  "accessories-calculator": ["apps", "calculate"],
  "accessories-text-editor": ["apps", "edit_note"],
};
const root = join(out, "freedesktop", theme, "scalable");
const dirs = new Set<string>(["material"]);
mkdirSync(join(root, "material"), { recursive: true });
for (const name of names) {
  if (hasSymbol(name, "outlined"))
    write(
      join(root, "material", `${name}.svg`),
      readSymbolSvg(name, "outlined"),
    );
}
let mapped = 0;
for (const [icon, [context, symbol]] of Object.entries(MAP)) {
  if (!hasSymbol(symbol, "outlined")) continue;
  mkdirSync(join(root, context), { recursive: true });
  const svg = readSymbolSvg(symbol, "outlined");
  write(join(root, context, `${icon}.svg`), svg);
  write(join(root, context, `${icon}-symbolic.svg`), svg);
  dirs.add(context);
  mapped++;
}
const ctx: Record<string, string> = {
  actions: "Actions",
  status: "Status",
  places: "Places",
  mimetypes: "MimeTypes",
  apps: "Applications",
  material: "Applications",
};
const listed = [...dirs].map((d) => `scalable/${d}`);
const sections = [...dirs]
  .map(
    (d) =>
      `[scalable/${d}]\nContext=${ctx[d]}\nSize=24\nMinSize=16\nMaxSize=512\nType=Scalable\n`,
  )
  .join("\n");
await Bun.write(
  join(out, "freedesktop", theme, "index.theme"),
  `[Icon Theme]\nName=${theme}\nComment=Material Symbols (outlined, wght 400) for Aphrody M3\nInherits=hicolor\nDirectories=${listed.join(",")}\n\n${sections}`,
);
await Promise.all(pending);
console.log(
  `exported ${names.length} symbols: ${sprites} sprites, freedesktop theme "${theme}" (${mapped} mapped names) -> ${out}`,
);
if (!(await Bun.file(join(out, "names.json")).exists())) process.exit(1);

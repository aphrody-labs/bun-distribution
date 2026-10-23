// SPDX-License-Identifier: Apache-2.0
// Builds dist/: the bundled shell, the OPFS file-system wasm, the M3 tokens and the workspace catalog.
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { themeCss } from "./src/themes";
import { buildPackages } from "./packages";
import { buildSeo } from "./seo";
import { stageVm } from "./vm";
import { buildDocs } from "./docs";
import { stageWorkspace } from "./workspace";
import { stageGamesContent } from "./games-content";

const root = resolve(import.meta.dir, "../..");
const dist = join(import.meta.dir, "dist");

interface Entry {
  id: string;
  d: string;
  k?: string;
}

const tomlDesc = (text: string) => {
  const line = text.split("\n").find((l) => l.startsWith("description"));
  const start = line?.indexOf('"') ?? -1;
  const end = line?.lastIndexOf('"') ?? -1;
  return line && end > start
    ? line
        .slice(start + 1, end)
        .split(String.fromCharCode(92, 34))
        .join('"')
    : "";
};

async function scan(
  dir: string,
  read: (path: string) => Promise<{ d: string; k?: string } | undefined>,
) {
  const tracked = Bun.spawnSync(["git", "ls-files", "--", dir], { cwd: root });
  if (tracked.exitCode !== 0)
    throw new Error(
      `Could not list tracked ${dir} sources for the product catalog`,
    );
  const trackedChildren = new Set(
    new TextDecoder()
      .decode(tracked.stdout)
      .split("\n")
      .filter(Boolean)
      .map((path) => path.split("/")[1]),
  );
  const out: Entry[] = [];
  for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
    if (
      !e.isDirectory() ||
      e.name.startsWith(".") ||
      !trackedChildren.has(e.name)
    )
      continue;
    const meta = await read(join(root, dir, e.name));
    if (meta) out.push({ id: e.name, ...meta });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

const apps = await scan("apps", async (p) => {
  const pkg = Bun.file(join(p, "package.json"));
  const cargo = Bun.file(join(p, "Cargo.toml"));
  const html = Bun.file(join(p, "index.html"));
  const trunk = Bun.file(join(p, "Trunk.toml"));
  if (
    !(await pkg.exists()) &&
    !(await cargo.exists()) &&
    !(await html.exists()) &&
    !(await trunk.exists())
  )
    return undefined;
  let d = "";
  if (await pkg.exists()) d = (await pkg.json()).description ?? "";
  if (!d && (await cargo.exists())) d = tomlDesc(await cargo.text());
  const kind =
    (await html.exists()) || (await trunk.exists())
      ? "web"
      : (await pkg.exists())
        ? "js"
        : "native";
  return { d, k: kind };
});

const packages = await scan("packages", async (p) => {
  const pkg = Bun.file(join(p, "package.json"));
  if (!(await pkg.exists())) return undefined;
  const j = await pkg.json();
  return { d: j.description ?? "" };
});

const crates = await scan("crates", async (p) => {
  const cargo = Bun.file(join(p, "Cargo.toml"));
  if (!(await cargo.exists())) return undefined;
  return { d: tomlDesc(await cargo.text()) };
});

// Hostnames owned by Aphrody Infra (docs/APP-DOMAINS.md): canonical host and library alias per capability.
const hosts: Record<string, { name: string; host: string; alias: string }> = {
  filmcraft: { name: "Video", host: "app-video", alias: "filmcraft" },
  artcraft: { name: "Generation", host: "app-generation", alias: "artcraft" },
  photocraft: { name: "Images", host: "app-images", alias: "photocraft" },
  vectorcraft: { name: "Vectors", host: "app-vectors", alias: "vectorcraft" },
  effectcraft: {
    name: "Compositing",
    host: "app-compositing",
    alias: "effectcraft",
  },
  lightcraft: {
    name: "Photo processing",
    host: "app-photo-processing",
    alias: "lightcraft",
  },
  pdfcraft: { name: "PDF", host: "app-pdf", alias: "pdfcraft" },
  wordcraft: { name: "Documents", host: "app-documents", alias: "wordcraft" },
  soundcraft: { name: "Audio", host: "app-audio", alias: "soundcraft" },
  designcraft: { name: "Layout", host: "app-layout", alias: "designcraft" },
  cadcraft: { name: "CAD", host: "app-cad", alias: "cadcraft" },
  deckcraft: { name: "Slides", host: "app-slides", alias: "deckcraft" },
  gridcraft: { name: "Tables", host: "app-tables", alias: "gridcraft" },
  figcraft: {
    name: "Interface layouts",
    host: "app-interface-layouts",
    alias: "figcraft",
  },
};

const catalog = {
  generated: new Date().toISOString(),
  counts: {
    apps: apps.length,
    packages: packages.length,
    crates: crates.length,
  },
  apps,
  packages,
  crates,
  hosts,
};

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "wasm"), { recursive: true });

// The default desktop theme paints before the shell script runs; Settings swaps it at runtime.
const tokens = [
  await Bun.file(join(root, "packages/m3-tokens/src/m3-tokens.css")).text(),
  await Bun.file(join(root, "packages/m3-tokens/src/expressive.css")).text(),
  themeCss("aphrody"),
].join("\n");
await Bun.write(join(dist, "m3.css"), tokens);

const result = await Bun.build({
  entrypoints: [
    join(import.meta.dir, "src/main.ts"),
    join(import.meta.dir, "src/sw.ts"),
    join(import.meta.dir, "src/boot.ts"),
  ],
  outdir: dist,
  target: "browser",
  minify: true,
  // Lit and other packages ship a dev build unless NODE_ENV is production at bundle time
  define: { "process.env.NODE_ENV": '"production"' },
  sourcemap: "none",
  naming: "[name].js",
  splitting: false,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const wasmDir = join(root, "packages/webos-wasm/wasm");
await cp(
  join(wasmDir, "aphrody_webos_wasm_bg.wasm"),
  join(dist, "wasm/aphrody_webos_wasm_bg.wasm"),
);
await cp(join(root, "LICENSE-APACHE"), join(dist, "wasm/LICENSE-APACHE"));
// @aphrody/m3-fonts: Google Sans Flex / Code and Material Symbols, subset to the faces the shell uses.
const fontSrc = join(root, "packages/m3-fonts/fonts");
await mkdir(join(dist, "fonts"), { recursive: true });
for (const [from, to] of [
  ["web/GoogleSansFlex-latin.woff2", "GoogleSansFlex-latin.woff2"],
  ["web/GoogleSansCode-latin.woff2", "GoogleSansCode-latin.woff2"],
  [
    "upstream/material-symbols/material-symbols-rounded.woff2",
    "material-symbols-rounded.woff2",
  ],
])
  await cp(join(fontSrc, from!), join(dist, "fonts", to!));
const faces = (
  await Bun.file(join(root, "packages/m3-fonts/src/fonts.css")).text()
)
  .split("@font-face")
  .filter((f) => /Google Sans (Flex|Code)/.test(f.split("}")[0]!));
const symbols = (
  await Bun.file(join(root, "packages/m3-fonts/src/fonts-symbols.css")).text()
)
  .split("@font-face")
  .filter((f) => f.includes("Rounded"));
await Bun.write(
  join(dist, "fonts.css"),
  [...faces, ...symbols]
    .map((f) => "@font-face" + f.split("}")[0] + "}")
    .join(String.fromCharCode(10))
    .replaceAll("../fonts/web/", "/fonts/")
    .replaceAll("../fonts/upstream/material-symbols/", "/fonts/"),
);
// Brand: the Aphrody logo of apps/aphrody-app; file and device icons: packages/assets (SpaceUI/Spacedrive set).
await mkdir(join(dist, "brand"), { recursive: true });
await mkdir(join(dist, "icons"), { recursive: true });
for (const [from, to] of [
  ["apps/aphrody-app/icons/16x16.png", "16.png"],
  ["apps/aphrody-app/icons/32x32.png", "32.png"],
  ["apps/aphrody-app/icons/64x64.png", "64.png"],
  ["apps/aphrody-app/icons/128x128.png", "128.png"],
  ["apps/aphrody-app/icons/256x256.png", "256.png"],
  ["apps/aphrody-app/icons/icon.png", "1024.png"],
  ["apps/aphrody-app/icons/icon.ico", "favicon.ico"],
])
  await cp(join(root, from!), join(dist, "brand", to!));
const FILE_ICONS = [
  "Folder",
  "FolderGrey",
  "Document",
  "Document_pdf",
  "Document_doc",
  "Document_xls",
  "Text",
  "Text_txt",
  "Image",
  "Video",
  "Movie",
  "Audio",
  "Archive",
  "Application",
  "Terminal",
  "Database",
  "Package",
  "Game",
  "Home",
  "Drive",
  "HDD",
  "Trash",
  "Globe",
  "Server",
  "Link",
  "Key",
  "Lock",
  "Search",
  "Undefined",
  "Screenshot",
  "Book",
  "Collection",
  "Encrypted",
  "Devices",
  "Laptop",
  "Storage",
  "Widget",
  "Compute",
  "Node",
  "Mesh",
  "Album",
  "Scrapbook",
  "Tags",
  "Sync",
];
for (const name of FILE_ICONS)
  await cp(
    join(root, "packages/assets/icons", name + ".png"),
    join(dist, "icons", name + ".png"),
  );
const shortcut = (name: string, app: string, description: string) => ({
  name,
  short_name: name,
  description,
  url: `/?app=${app}`,
  icons: [{ src: "/brand/192.png", sizes: "192x192", type: "image/png" }],
});
await Bun.write(
  join(dist, "manifest.webmanifest"),
  JSON.stringify({
    id: "/",
    name: "Aphrody Bun OS",
    short_name: "Bun OS",
    description:
      "A tiling desktop in your browser: files, terminal, browser, games and creative apps that work offline.",
    lang: "en",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#11131d",
    theme_color: "#11131d",
    categories: ["productivity", "utilities", "developer"],
    icons: [
      {
        src: "/brand/192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      shortcut("Files", "files", "Your files, saved in this browser"),
      shortcut("Terminal", "terminal", "Command line in WebAssembly"),
      shortcut("Browser", "browser", "Browse the web in tabs"),
      shortcut("Apps", "apps", "Install games and creative apps"),
    ],
    screenshots: [
      {
        src: "/screens/wide.webp",
        sizes: "1475x812",
        type: "image/webp",
        form_factor: "wide",
        label: "Bun OS desktop with the welcome card, top bar and dock",
      },
      {
        src: "/screens/narrow.webp",
        sizes: "780x1688",
        type: "image/webp",
        form_factor: "narrow",
        label: "Bun OS home screen on a phone",
      },
    ],
  }),
);
// Shared sheet plus one sheet per app (src/apps/*.css), served as one file.
const sheets = [
  join(import.meta.dir, "src/styles.css"),
  ...(await readdir(join(import.meta.dir, "src/apps")))
    .filter((f) => f.endsWith(".css"))
    .sort()
    .map((f) => join(import.meta.dir, "src/apps", f)),
];
await Bun.write(
  join(dist, "styles.css"),
  (await Promise.all(sheets.map((s) => Bun.file(s).text()))).join(
    String.fromCharCode(10),
  ),
);
await cp(join(import.meta.dir, "src/index.html"), join(dist, "index.html"));
await cp(join(import.meta.dir, "public"), dist, { recursive: true });
await stageWorkspace(dist, root);
await Bun.write(join(dist, "catalog.json"), JSON.stringify(catalog));
await stageVm(dist);
const docs = await buildDocs(dist);
console.log(
  `docs: ${Object.entries(docs)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ")}`,
);
const built = await buildPackages(dist);
await stageGamesContent(dist);
await buildSeo(dist, catalog);
console.log(`packages: ${built.map((p) => p.id).join(", ") || "none"}`);
console.log(
  `webos: ${apps.length} apps, ${packages.length} packages, ${crates.length} crates`,
);

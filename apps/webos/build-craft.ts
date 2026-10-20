// SPDX-License-Identifier: Apache-2.0
// Compiles the Craft browser apps (egui/eframe, wasm32) and lays them out as installable packages in
// out/craft/<id>/. Cargo runs once for all apps so shared dependencies compile one time; the pinned
// wasm-bindgen and Binaryen of the web-emulation lock produce and shrink the modules.
//   bun build-craft.ts [id ...]
import { cp } from "node:fs/promises";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig, runNative } from "@aphrody/bun-workspace";

if (process.platform !== "linux")
  throw new Error("Build Craft WebAssembly apps on the Linux VPS factory.");

const root = resolve(import.meta.dir, "../..");
const out = join(import.meta.dir, "out/craft");
const work = join(root, "build/web-craft");
const lock = JSON.parse(await Bun.file(join(root, "packages/bun-engine/web-emulation/web-emulation.lock.json")).text());

interface Craft {
  id: string;
  crate: string;
  name: string;
  glyph: string;
  description: string;
  /** Library crates ship their own static page in apps/<crate>/web/ instead of a Trunk index.html. */
  web?: boolean;
}
const ALL: Craft[] = [
  {
    id: "pdf",
    crate: "pdfcraft-web",
    name: "PDF",
    glyph: "PDF",
    description: "Read, annotate and edit PDF documents.",
  },
  { id: "word", crate: "wordcraft-web", name: "Documents", glyph: "Doc", description: "Write and format documents." },
  { id: "grid", crate: "gridcraft-web", name: "Tables", glyph: "Tbl", description: "Spreadsheets with formulas." },
  { id: "deck", crate: "deckcraft-web", name: "Slides", glyph: "Sld", description: "Build presentations." },
  {
    id: "photo",
    crate: "photocraft-web",
    name: "Images",
    glyph: "Img",
    description: "Edit images with layers and filters.",
  },
  {
    id: "vector",
    crate: "vectorcraft-web",
    name: "Vectors",
    glyph: "Vec",
    description: "Draw and edit vector graphics.",
  },
  { id: "design", crate: "designcraft-web", name: "Layout", glyph: "Lay", description: "Page layout and design." },
  { id: "fig", crate: "figcraft-web", name: "Interface", glyph: "UI", description: "Design interface layouts." },
  { id: "sound", crate: "soundcraft-web", name: "Audio", glyph: "Aud", description: "Record and edit audio." },
  { id: "cad", crate: "cadcraft-web", name: "CAD", glyph: "CAD", description: "2D drafting and technical drawing." },
  {
    id: "film",
    crate: "filmcraft-web",
    name: "Video",
    glyph: "Vid",
    description: "Edit video with a timeline.",
    web: true,
  },
  {
    id: "light",
    crate: "lightcraft-web",
    name: "Photo processing",
    glyph: "Lgt",
    description: "Develop and organise photos.",
  },
];
const wanted = Bun.argv.slice(2);
const unknown = wanted.filter(id => !ALL.some(app => app.id === id));
if (unknown.length) throw new Error(`Unknown Craft app IDs: ${unknown.join(", ")}`);
const apps = wanted.length ? ALL.filter(a => wanted.includes(a.id)) : ALL;

async function run(cmd: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(cmd, { cwd: root, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.slice(0, 4).join(" ")} exited with ${code}`);
}

function findFile(dir: string, name: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const f = findFile(p, name);
      if (f) return f;
    } else if (e.name === name) return p;
  }
}

async function tool(name: "wasm-bindgen" | "binaryen", exe: string): Promise<string> {
  const pin = {
    version: lock.tools[name].version,
    ...lock.tools[name].platforms[`${process.platform}-${process.arch}`],
  };
  const dir = join(work, "tools", `${name}-${pin.version}`);
  const found = existsSync(dir) ? findFile(dir, exe) : undefined;
  if (found) return found;
  mkdirSync(dir, { recursive: true });
  const bytes = await (await fetch(pin.url)).bytes();
  if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== pin.sha256)
    throw new Error(`${name}: sha256 does not match the lock`);
  await new Bun.Archive(bytes).extract(dir);
  return findFile(dir, exe)!;
}

// Explicit feature list: --all-features also enables compact imports, which browsers cannot load.
const FEATURES = [
  "--enable-bulk-memory",
  "--enable-nontrapping-float-to-int",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--enable-reference-types",
  "--enable-multivalue",
  "--enable-simd",
];
const buildCode = await runNative(await loadConfig(),
  [
    "cargo",
    "build",
    "--locked",
    "--jobs", "4",
    "--target",
    "wasm32-unknown-unknown",
    "--profile",
    "web-craft",
    ...apps.flatMap(a => ["-p", a.crate]),
  ],
  {
    cwd: root,
    runtimePolicy: "development",
    timeoutMs: 1_800_000,
    env: { CARGO_BUILD_JOBS: "4" },
  },
);
if (buildCode !== 0) throw new Error(`Craft Cargo build exited with ${buildCode}`);

// runNative owns this shared Cargo target directory.
const targetDir = join(root, "target");
const bindgen = await tool("wasm-bindgen", "wasm-bindgen");
const wasmOpt = await tool("binaryen", "wasm-opt");
rmSync(out, { recursive: true, force: true });
const index: { id: string; name: string; glyph: string; description: string; version: string }[] = [];
for (const app of apps) {
  const bin = app.crate.replaceAll("-", "_");
  const release = join(targetDir, "wasm32-unknown-unknown/web-craft");
  // With a split build directory cargo writes the final artifact under release/build/<package>/<hash>/out.
  const raw =
    [`${bin}.wasm`, `${app.crate}.wasm`].map(n => join(release, n)).find(existsSync) ??
    findFile(join(release, "build"), `${bin}.wasm`) ??
    join(release, `${bin}.wasm`);
  if (!existsSync(raw)) throw new Error(`${app.crate}: ${raw} was not produced`);
  const dest = join(out, app.id);
  mkdirSync(dest, { recursive: true });
  await run([bindgen, "--target", "web", "--out-dir", dest, "--out-name", bin, "--no-typescript", raw]);
  const bound = join(dest, `${bin}_bg.wasm`);
  await run([wasmOpt, "-Oz", ...FEATURES, "--strip-debug", "--strip-producers", bound, "-o", bound]);
  if (app.web) {
    await cp(join(root, "apps", app.crate, "web"), dest, { recursive: true });
  } else if (!(await Bun.file(join(root, "apps", app.crate, "Trunk.toml")).exists()) && (await Bun.file(join(root, "apps", app.crate, "index.html")).text()).includes("from \"./" + bin + ".js\"")) {
    // Hand-written page: it imports ./<bin>.js itself, so ship the page unchanged.
    await Bun.write(join(dest, "index.html"), await Bun.file(join(root, "apps", app.crate, "index.html")).text());
    const web = join(root, "apps", app.crate, "web");
    if (existsSync(web)) await cp(web, dest, { recursive: true });
  } else {
    // Trunk's <link data-trunk rel="rust"> becomes the module loader.
    const src = await Bun.file(join(root, "apps", app.crate, "index.html")).text();
    const loader = `<script type="module">import init from "./${bin}.js"; await init({ module_or_path: "./${bin}_bg.wasm" });</script>`;
    const html = src.replace(
      /<link[^>]*data-trunk[^>]*rel="rust"[^>]*>|<link[^>]*rel="rust"[^>]*data-trunk[^>]*>/,
      loader,
    );
    if (html === src) throw new Error(`${app.crate}: no Trunk rust link found in index.html`);
    await Bun.write(join(dest, "index.html"), html);
  }
  const cargo = await Bun.file(join(root, "apps", app.crate, "Cargo.toml")).text();
  index.push({
    id: app.id,
    name: app.name,
    glyph: app.glyph,
    description: app.description,
    version: /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1] ?? "0.0.0",
  });
  console.log(`${app.id}: ${(Bun.file(bound).size / 1048576).toFixed(1)} MB`);
}
await Bun.write(join(out, "index.json"), JSON.stringify(index));

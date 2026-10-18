#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Builds the browser frontends of the Craft apps (apps/*craft-web, eframe/egui compiled to
 * wasm32-unknown-unknown) and deploys them as static files to https://craft.aphrody.app/<app>/.
 *
 * The workstation cannot link host build scripts (no MSVC runtime libraries), so the wasm32
 * compile and wasm-bindgen/wasm-opt run on the VPS checkout (~/src/bun-os) under the shared
 * ~/build/heavy.lock, niced, into a private target directory. The artifacts come back over ssh,
 * are content-addressed here (name-<8 hex>.js / .wasm: immutable cache), assembled with the
 * landing page, uploaded as one tarball and swapped in place at ~/apps/craft-web/current (no kept
 * releases). The nginx vhost infra/config/host/nginx/craft/craft.aphrody.app.conf is installed
 * with nginx -t before reload and reverted on failure.
 *
 * Usage: bun scripts/aphrody/tools/infra/deploy-craft-frontends.ts
 *          [--host vps] [--only cad,deck] [--skip-build] [--skip-vhost]
 * An app that fails to build is reported and left out; the others still deploy.
 */
import { $ } from "bun";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";

interface App {
  path: string;
  title: string;
  summary: string;
  pkg: string;
  /** "lib" builds the cdylib (LightCraft); otherwise the binary of the package. */
  kind?: "lib";
  features?: string;
}

const APPS: App[] = [
  { path: "cad", title: "CADCraft", summary: "2D drawing and CAD editor", pkg: "cadcraft-web" },
  { path: "deck", title: "DeckCraft", summary: "Presentation slides", pkg: "deckcraft-web" },
  { path: "design", title: "DesignCraft", summary: "Page layout and publishing", pkg: "designcraft-web" },
  { path: "fig", title: "FigCraft", summary: "Interface design", pkg: "figcraft-web" },
  { path: "grid", title: "GridCraft", summary: "Spreadsheets", pkg: "gridcraft-web" },
  {
    path: "light",
    title: "LightCraft",
    summary: "Photo library and RAW development",
    pkg: "lightcraft-web",
    kind: "lib",
  },
  { path: "pdf", title: "PDFCraft", summary: "PDF viewer and editor", pkg: "pdfcraft-web" },
  { path: "photo", title: "PhotoCraft", summary: "Image editing", pkg: "photocraft-web", features: "heif" },
  { path: "sound", title: "SoundCraft", summary: "Audio editor", pkg: "soundcraft-web" },
  { path: "vector", title: "VectorCraft", summary: "Vector graphics", pkg: "vectorcraft-web" },
  { path: "word", title: "WordCraft", summary: "Word processing", pkg: "wordcraft-web" },
];

const args = Bun.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string, fallback: string) => (flag(name) ? args[args.indexOf(name) + 1]! : fallback);
const host = value("--host", "vps");
const only = value("--only", "").split(",").filter(Boolean);
const repo = resolve(import.meta.dir, "..", "..", "..", "..");
const apps = APPS.filter(a => only.length === 0 || only.includes(a.path));

// Remote builder, piped to bash on the VPS: build-one.sh <pkg> <bin|--lib> <out-dir> [features].
const REMOTE_BUILDER = String.raw`set -eu
pkg=$1; bin=$2; out=$3; feat=\${4:-}
export CARGO_TARGET_DIR=$HOME/build/cargo-target/craft-web CARGO_BUILD_JOBS=4
export CARGO_PROFILE_RELEASE_OPT_LEVEL=s CARGO_PROFILE_RELEASE_STRIP=true CARGO_PROFILE_RELEASE_DEBUG=false CARGO_PROFILE_RELEASE_PANIC=abort
cd "$HOME/src/bun-os"
sel=(--bin "$bin"); file=$bin; name=\${bin//-/_}
if [ "$bin" = "--lib" ]; then sel=(--lib); name=\${pkg//-/_}; file=$name; fi
args=(build --release --locked --target wasm32-unknown-unknown -p "$pkg" "\${sel[@]}")
[ -n "$feat" ] && args+=(--features "$feat")
exec 9>"$HOME/build/heavy.lock"; flock 9
nice -n 19 cargo "\${args[@]}"
flock -u 9
rm -rf "$out"; mkdir -p "$out"
wasm-bindgen "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/$file.wasm" --target web --no-typescript --weak-refs --out-name "$name" --out-dir "$out"
if nice -n 19 wasm-opt -Oz --all-features "$out/\${name}_bg.wasm" -o "$out/opt.wasm"; then mv "$out/opt.wasm" "$out/\${name}_bg.wasm"; else rm -f "$out/opt.wasm"; fi
`.replaceAll("\\$", "$");

const REMOTE_OUT = "$HOME/build/craft-web/out";
const failures: { app: App; reason: string }[] = [];

async function sh(cmd: string, stdin?: string) {
  const proc = Bun.spawn(["ssh", host, cmd], {
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out, err, code };
}

async function buildRemote(app: App) {
  const bin = app.kind === "lib" ? "--lib" : app.pkg;
  const out = `${REMOTE_OUT}/${app.path}`;
  const cmd = `bash -s -- ${app.pkg} ${bin} ${out} ${app.features ?? ""}`;
  console.log(`build ${app.path} (${app.pkg}) on ${host}`);
  const r = await sh(cmd, REMOTE_BUILDER);
  if (r.code !== 0) {
    const lines = `${r.err}\n${r.out}`.split("\n");
    const tail =
      lines
        .filter(l => l.startsWith("error"))
        .slice(-6)
        .join("\n") || lines.slice(-8).join("\n");
    failures.push({ app, reason: tail });
    console.error(`SKIP ${app.path}: build failed\n${tail}`);
    return false;
  }
  return true;
}

if (!flag("--skip-build")) {
  for (const app of apps) await buildRemote(app);
}

const staging = await mkdtemp(join(tmpdir(), "craft-web-"));
try {
  // Fetch every artifact set that exists on the VPS.
  const fetched = join(staging, "fetched");
  await mkdir(fetched, { recursive: true });
  const names = apps.map(a => a.path).join(" ");
  await $`ssh ${host} ${`cd ${REMOTE_OUT} 2>/dev/null && for d in ${names}; do [ -d "$d" ] && printf '%s\n' "$d"; done | xargs -r tar -cf - `} > ${join(staging, "fetched.tar")}`.quiet();
  await $`tar -xf fetched.tar -C fetched`.cwd(staging);

  const site = join(staging, "site");
  await mkdir(site, { recursive: true });
  const built: App[] = [];
  for (const app of apps) {
    const src = join(fetched, app.path);
    let files: string[];
    try {
      files = await readdir(src);
    } catch {
      if (!failures.some(f => f.app === app)) failures.push({ app, reason: "no build output on the VPS" });
      continue;
    }
    const dest = join(site, app.path);
    await mkdir(dest, { recursive: true });
    const appDir = join(repo, "apps", app.pkg);
    let html = await Bun.file(join(appDir, "index.html")).text();
    if (app.kind === "lib") {
      for (const f of files) await copyFile(join(src, f), join(dest, f));
      await copyFile(join(appDir, "worker.js"), join(dest, "worker.js"));
    } else {
      const js = files.find(f => f.endsWith(".js") && !f.endsWith("_bg.js"));
      const wasm = files.find(f => f.endsWith("_bg.wasm"));
      if (!js || !wasm) {
        failures.push({ app, reason: "wasm-bindgen output is incomplete" });
        continue;
      }
      const hash = async (f: string) =>
        createHash("sha256")
          .update(new Uint8Array(await Bun.file(join(src, f)).arrayBuffer()))
          .digest("hex")
          .slice(0, 8);
      const jsName = js.replace(/\.js$/, `-${await hash(js)}.js`);
      const wasmName = wasm.replace(/\.wasm$/, `-${await hash(wasm)}.wasm`);
      await copyFile(join(src, js), join(dest, jsName));
      await copyFile(join(src, wasm), join(dest, wasmName));
      const links = [...html.matchAll(/<link\s+data-trunk\b[^>]*?\/>/gs)];
      for (const m of links) {
        const tag = m[0];
        const rel = /\brel="([^"]+)"/.exec(tag)?.[1];
        if (rel === "rust") {
          html = html.replace(
            tag,
            `<script type="module">\n      import init from "./${jsName}";\n      init({ module_or_path: "./${wasmName}" }).catch((e) => {\n        console.error(e);\n        const el = document.querySelector('[id$="_loading"]');\n        if (el) el.textContent = "Failed to load: " + e;\n      });\n    </script>`,
          );
        } else if (rel === "icon") {
          const href = /\bhref="([^"]+)"/.exec(tag)![1]!;
          const icon = `icon${extname(href)}`;
          await copyFile(resolve(appDir, href), join(dest, icon));
          html = html.replace(tag, `<link rel="icon" href="${icon}" />`);
        } else {
          throw new Error(`${app.path}: unsupported trunk asset ${tag}`);
        }
      }
    }
    await Bun.write(join(dest, "index.html"), html);
    built.push(app);
  }
  if (built.length === 0) throw new Error("nothing built; nothing to deploy");

  await Bun.write(join(site, "index.html"), landing(built));
  await Bun.write(join(site, "robots.txt"), "User-agent: *\nAllow: /\n");

  await $`tar --mode=u=rwX,go=rX -czf craft-web.tgz -C site .`.cwd(staging);
  await $`scp -q craft-web.tgz ${host}:/tmp/`.cwd(staging);
  await $`scp -q infra/config/host/nginx/craft/craft.aphrody.app.conf ${host}:/tmp/`.cwd(repo);

  const remote = String.raw`
set -eu
P="$HOME/apps/craft-web"
rm -rf "$P/next" && mkdir -p "$P/next" && tar -xzf /tmp/craft-web.tgz -C "$P/next" && rm -f /tmp/craft-web.tgz
rm -rf "$P/current" && mv "$P/next" "$P/current"
rm -rf "$HOME/build/craft-web/out"
`;
  const vhost = String.raw`
set -eu
LIVE=/etc/nginx/conf.d/craft.aphrody.app.conf
if ! sudo cmp -s /tmp/craft.aphrody.app.conf "$LIVE"; then
  PREVIOUS=$(mktemp)
  sudo cat "$LIVE" > "$PREVIOUS" 2>/dev/null || : > "$PREVIOUS"
  sudo install -m 644 /tmp/craft.aphrody.app.conf "$LIVE"
  if sudo nginx -t; then
    sudo systemctl reload nginx
  else
    if [ -s "$PREVIOUS" ]; then sudo install -m 644 "$PREVIOUS" "$LIVE"; else sudo rm -f "$LIVE"; fi
    rm -f "$PREVIOUS" /tmp/craft.aphrody.app.conf
    exit 1
  fi
  rm -f "$PREVIOUS"
fi
rm -f /tmp/craft.aphrody.app.conf
`;
  await $`ssh ${host} ${remote}`;
  if (!flag("--skip-vhost")) await $`ssh ${host} ${vhost}`;
  console.log(`deployed ${built.map(a => a.path).join(", ")} to https://craft.aphrody.app/`);
  for (const f of failures) console.log(`skipped ${f.app.path}: ${f.reason}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}

function landing(list: App[]): string {
  const cards = list
    .map(
      a => `      <a class="card" href="/${a.path}/">
        <span class="mark" aria-hidden="true">${a.title[0]}</span>
        <span class="name">${a.title}</span>
        <span class="desc">${a.summary}</span>
      </a>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="Craft apps running in the browser." />
    <meta name="color-scheme" content="light dark" />
    <title>Craft</title>
    <style>
      :root {
        --bg: #fef7ff;
        --surface: #f3edf7;
        --on-surface: #1d1b20;
        --muted: #49454f;
        --primary: #6750a4;
        --on-primary: #ffffff;
        --container: #eaddff;
        --on-container: #21005d;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #141218;
          --surface: #211f26;
          --on-surface: #e6e0e9;
          --muted: #cac4d0;
          --primary: #d0bcff;
          --on-primary: #381e72;
          --container: #4f378b;
          --on-container: #eaddff;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: var(--bg);
        color: var(--on-surface);
        font: 16px/1.5 Roboto, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      header, main, footer { max-width: 960px; margin: 0 auto; padding: 0 24px; }
      header { padding-top: 64px; padding-bottom: 32px; }
      h1 { margin: 0 0 8px; font-size: 3rem; font-weight: 400; letter-spacing: -0.01em; }
      header p { margin: 0; color: var(--muted); font-size: 1.125rem; }
      .grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        padding: 16px 0 48px;
      }
      .card {
        display: grid;
        grid-template-columns: 48px 1fr;
        grid-template-rows: auto auto;
        column-gap: 16px;
        align-items: center;
        padding: 16px;
        border-radius: 16px;
        background: var(--surface);
        color: inherit;
        text-decoration: none;
        transition: box-shadow 0.15s, transform 0.15s;
      }
      .card:hover, .card:focus-visible {
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 8px 3px rgba(0, 0, 0, 0.15);
        transform: translateY(-1px);
        outline: none;
      }
      .card:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
      .mark {
        grid-row: 1 / span 2;
        width: 48px;
        height: 48px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--container);
        color: var(--on-container);
        font-size: 1.25rem;
        font-weight: 500;
      }
      .name { font-size: 1.125rem; font-weight: 500; }
      .desc { color: var(--muted); font-size: 0.875rem; }
      footer { padding-bottom: 32px; color: var(--muted); font-size: 0.875rem; }
    </style>
  </head>
  <body>
    <header>
      <h1>Craft</h1>
      <p>Creative and productivity apps that run entirely in your browser.</p>
    </header>
    <main>
      <nav class="grid" aria-label="Apps">
${cards}
      </nav>
    </main>
    <footer>Apps use WebGPU where available and fall back to WebGL2.</footer>
  </body>
</html>
`;
}

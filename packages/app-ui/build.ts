// SPDX-License-Identifier: Apache-2.0
// Build the desktop webview with the same native M3 bundler used in development.
import { buildM3 } from "@aphrody/m3/build";
import { loadM3Config } from "@aphrody/m3/config";
import { m3Bun } from "@aphrody/m3-bun/plugin";
import { undeclaredDependencies } from "./undeclared-deps";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ProductSearchHome } from "./src/routes/product/ProductSearchHome";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { publicFontUrl, renderPublicStylesheet } from "@aphrody/m3-fonts";
import { prunePublicFontCopies } from "./public-assets-package";
import {
  canonicalBunInputs,
  productBuildContext,
} from "@aphrody/product/build-inputs";
const WEBOS_WASM_NAME = "aphrody_webos_wasm_bg.wasm";
const escape = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

if (import.meta.main) {
  const context = productBuildContext();
  const config = await loadM3Config(import.meta.dir);
  if (!config.tauri)
    throw new Error("app-ui: m3.config.ts must set tauri.uiDist");
  const dev = process.argv.includes("--dev");
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      out: { type: "string" },
      dev: { type: "boolean" },
      "public-assets": { type: "boolean" },
    },
  });
  const tauri = values.out
    ? { ...config.tauri, uiDist: resolve(values.out) }
    : config.tauri;
  if (values["public-assets"] && !values.out)
    throw new Error(
      "--public-assets requires an isolated --out artifact directory",
    );
  const assets = values["public-assets"]
    ? ((await Bun.file(context.publicAssets).json()) as {
        schemaVersion: number;
        baseUrl: string;
        localFontFallbacks: string[];
      })
    : undefined;
  if (
    assets &&
    (assets.schemaVersion !== 1 ||
      assets.baseUrl !== "https://assets.aphrody.app")
  )
    throw new Error("Unqualified public assets configuration");
  const bunCheckout = context.bunCheckout;
  const sourceRevision = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: bunCheckout,
  });
  if (sourceRevision.exitCode !== 0)
    throw new Error("Canonical Bun checkout must have a source revision");
  const bunRevision = sourceRevision.stdout.toString().trim();
  if (
    Bun.env.APP_UI_BUN_REVISION &&
    Bun.env.APP_UI_BUN_REVISION !== bunRevision
  )
    throw new Error(
      "Selected Bun revision must match the canonical checkout HEAD",
    );
  const docsFile = canonicalBunInputs(bunCheckout, bunRevision).docsFile;
  if (
    Bun.env.APP_UI_DOCS_CATALOG &&
    resolve(Bun.env.APP_UI_DOCS_CATALOG) !== resolve(docsFile)
  )
    throw new Error(
      "APP_UI_DOCS_CATALOG must match the canonical Bun transfer receipt",
    );
  const started = performance.now();
  const result = await buildM3({
    entry: config.entry,
    outdir: config.outdir,
    production: !dev,
    define: config.define,
    drop: config.drop,
    minify: config.minify,
    optimizeImports: config.optimizeImports,
    tauri,
    plugin: false,
    plugins: [
      m3Bun({ theme: config.theme, root: config.root, configDir: config.dir }),
      undeclaredDependencies,
    ],
    cwd: config.dir,
  });
  // The Rust WebAssembly backend of the browser OS (packages/web/webos-wasm) ships next to app.js.
  const webosWasm = fileURLToPath(
    import.meta.resolve(`@aphrody/webos-wasm/wasm/${WEBOS_WASM_NAME}`),
  );
  if (!(await Bun.file(webosWasm).exists()))
    throw new Error(
      "missing " +
        webosWasm +
        ": run `bun run build:wasm` in packages/web/webos-wasm",
    );
  await Bun.write(
    join(result.outdir, "wasm", WEBOS_WASM_NAME),
    Bun.file(webosWasm),
  );
  const bytes = result.outputs.reduce((sum, output) => sum + output.bytes, 0);
  let shell = await Bun.file(`${result.outdir}/index.html`).text();
  if (values.out) {
    // Web artifacts keep stable file names: version the entry URLs in the no-cache shell so a
    // deployment never pairs a cached app.js (wasm-bindgen glue) with a newer .wasm.
    const hasher = new Bun.CryptoHasher("sha256");
    const parts = await Promise.all(
      ["app.js", "app.css", join("wasm", WEBOS_WASM_NAME)].map((file) =>
        Bun.file(join(result.outdir, file)).bytes(),
      ),
    );
    for (const part of parts) hasher.update(part);
    const version = hasher.digest("hex").slice(0, 12);
    shell = shell.replace(/(\.\/app\.(?:js|css))"/g, `$1?v=${version}"`);
    await Bun.write(`${result.outdir}/index.html`, shell);
  }
  if (assets) {
    const cssFile = join(result.outdir, "app.css");
    const css = (await Bun.file(cssFile).text()).replace(
      /url\((?:["'])?\.\/fonts\/([^"'()]+\.woff2)(?:["'])?\)/g,
      (_match, file: string) =>
        `url("${assets.localFontFallbacks.includes(file) ? "./fonts/" + file : publicFontUrl(file, assets.baseUrl)}")`,
    );
    await Bun.write(cssFile, css);
    await Bun.write(
      join(result.outdir, "fonts.css"),
      ["core", "jp"]
        .map((sheet) =>
          renderPublicStylesheet(
            assets.baseUrl,
            sheet as "core" | "jp" | "symbols",
          ),
        )
        .join("\n"),
    );
    await Bun.write(
      join(result.outdir, "public-assets.json"),
      JSON.stringify({ schemaVersion: 1, baseUrl: assets.baseUrl }) + "\n",
    );
    const trimmed = prunePublicFontCopies(
      result.outdir,
      [css, await Bun.file(join(result.outdir, "fonts.css")).text()],
      assets.baseUrl,
    );
    console.log(
      `public fonts: removed ${trimmed.files} duplicate WOFF2 files, ${trimmed.bytes} B; retained declared local glyph fallback`,
    );
  }
  const home = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(ProductSearchHome, {
        publicPreview: true,
        assetBase: assets?.baseUrl,
      }),
    ),
  ).replaceAll(
    /(?<![:\w/\\])(?:[A-Za-z]:[\\/]|\/)[^"<>]*?([\\/])(?:icon-(?:64|128|192)\.png|spritesheet\.webp)/g,
    (path) => `./fonts/${path.split(/[\\/]/).pop()}`,
  );
  await Promise.all(
    ["icon-64.png", "icon-128.png", "icon-192.png", "spritesheet.webp"].map(
      async (name) => {
        const source = join(
          import.meta.dir,
          "../identity",
          name === "spritesheet.webp" ? "dist" : "assets",
          name,
        );
        await Bun.write(join(result.outdir, "fonts", name), Bun.file(source));
      },
    ),
  );
  const publicHome = shell
    .replace(
      "<title>Aphrody OS</title>",
      '<title>Aphrody — Search, workspace and native OS</title><meta name="description" content="Search the web with Aphrody and explore the shared browser and desktop workspace, documentation, templates and Material 3 components."><link rel="canonical" href="https://aphrody.com/">',
    )
    .replace('<div id="root"></div>', `<div id="root">${home}</div>`);
  await Bun.write(`${result.outdir}/public-home.html`, publicHome);
  const docsBytes = await Bun.file(docsFile).text();
  const docs: Array<{
    id: string;
    title: string;
    summary: string;
    content: string;
  }> = JSON.parse(docsBytes);
  await Bun.write(join(result.outdir, "public-docs.json"), docsBytes);
  await Promise.all(
    docs.map(async (article) => {
      const prose = Bun.markdown
        .html(article.content)
        .replace(/<h1([^>]*)>/g, '<h1$1 class="text-headline-large">')
        .replace(/<h2([^>]*)>/g, '<h2$1 class="text-headline-small">')
        .replace(/<h3([^>]*)>/g, '<h3$1 class="text-title-large">');
      const document = shell
        .replace(/<script[^>]*>[\s\S]*?<\/script>/g, "")
        .replace(
          "<title>Aphrody OS</title>",
          `<title>${escape(article.title)} — Aphrody</title><meta name="description" content="${escape(article.summary)}"><link rel="canonical" href="https://aphrody.com/docs/${article.id}">`,
        )
        .replace(
          '<div id="root"></div>',
          `<div id="root"><main class="min-h-screen bg-surface p-6 text-on-surface"><nav class="mx-auto mb-8 flex max-w-3xl flex-wrap gap-6"><a class="text-primary underline" href="/">Aphrody</a><a class="text-primary underline" href="/docs">Bun documentation</a><a class="text-primary underline" href="/os">Open Aphrody OS</a></nav><article class="mx-auto max-w-3xl space-y-6 text-body-large">${prose}</article></main></div>`,
        );
      await Bun.write(
        join(result.outdir, "public-docs", article.id + ".html"),
        document,
      );
    }),
  );
  console.log(
    `app-ui build: ${result.outputs.length} files, ${bytes} B into ${result.outdir} in ${Math.round(performance.now() - started)} ms`,
  );
}

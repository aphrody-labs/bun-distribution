#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Bundle-size report of the Base UI + Tailwind v4 + Next 16 layer (m3-baseui, m3-tailwind, m3-next).
//
//   bun scripts/bundle-report.ts [--json] [--out file.json] [--before file.json] [--write file.md]
//
// Every number is measured with Bun's bundler (browser target, minified, react external) or with
// @tailwindcss/node plus Bun's CSS minifier, so a re-run on another commit is comparable.
// `--before` embeds the numbers of an earlier run next to the current ones; `--write` renders the Markdown report.
/* oxlint-disable eslint/no-await-in-loop -- measurements run one after another so they never compete for the machine */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const PACKAGES = resolve(import.meta.dir, "../..");

/** `@tailwindcss/node` as m3-tailwind resolves it, so the report measures the preset against its own engine. */
const { compile } = (await import(
  Bun.resolveSync("@tailwindcss/node", join(PACKAGES, "m3-tailwind"))
)) as {
  compile(
    css: string,
    options: { base: string; onDependency(path: string): void },
  ): Promise<{ build(candidates: string[]): string }>;
};

export interface Measure {
  bytes: number;
  gzip: number;
}
export type Report = Record<string, Measure | number>;

const gz = (text: string | Uint8Array): number =>
  gzipSync(text, { level: 9 }).length;
const size = (text: string): Measure => ({
  bytes: Buffer.byteLength(text),
  gzip: gz(text),
});

/** Entry file of a workspace package: the `.` export, falling back to `main`. */
function entryOf(pkg: string): string {
  const dir = join(PACKAGES, pkg);
  const manifest = JSON.parse(
    readFileSync(join(dir, "package.json"), "utf8"),
  ) as {
    exports?: Record<string, unknown>;
    main?: string;
  };
  const root = manifest.exports?.["."];
  const file =
    typeof root === "string"
      ? root
      : typeof root === "object" && root !== null
        ? ((root as Record<string, string>)["import"] ??
          (root as Record<string, string>)["default"])
        : manifest.main;
  if (file === undefined) throw new Error(`${pkg}: no entry`);
  return resolve(dir, file);
}

/** Minified browser bundle of `code` (react and react-dom stay external, as in an app that dedupes them). */
async function bundle(
  code: string,
  external: string[] = ["react", "react-dom", "react/jsx-runtime"],
): Promise<Measure> {
  const entry = join(PACKAGES, "m3-next", "__bundle_entry__.ts");
  const result = await Bun.build({
    entrypoints: [entry],
    files: { [entry]: code },
    target: "browser",
    format: "esm",
    minify: true,
    external,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  const text = await result.outputs[0]!.text();
  return size(text);
}

/**
 * Like {@link bundle} with code splitting: the entry chunk (what a page downloads up front) and the dynamic-import
 * chunks together (what is fetched on demand).
 */
async function bundleSplit(
  code: string,
  external: string[],
): Promise<{ entry: Measure; lazy: Measure }> {
  const entry = join(PACKAGES, "m3-next", "__bundle_entry__.ts");
  const result = await Bun.build({
    entrypoints: [entry],
    files: { [entry]: code },
    target: "browser",
    format: "esm",
    minify: true,
    splitting: true,
    external,
    define: { "process.env.NODE_ENV": '"production"' },
  });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  let first = "";
  let lazy = "";
  for (const output of result.outputs) {
    if (output.kind === "entry-point") first = await output.text();
    else if (output.kind === "chunk") lazy += await output.text();
  }
  return { entry: size(first), lazy: size(lazy) };
}

/** Minified CSS through Bun's CSS pipeline. */
async function minifyCss(css: string): Promise<Measure> {
  const entry = join(PACKAGES, "m3-next", "__bundle_entry__.css");
  const result = await Bun.build({
    entrypoints: [entry],
    files: { [entry]: css },
    minify: true,
  });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  return size(await result.outputs[0]!.text());
}

/** The classes of a typical M3 screen: every family of the preset appears at least once. */
export const TYPICAL_CANDIDATES = [
  "bg-primary",
  "text-on-primary",
  "bg-surface-container",
  "text-on-surface",
  "text-on-surface-variant",
  "bg-secondary-container",
  "text-on-secondary-container",
  "bg-error",
  "border-outline-variant",
  "rounded-full",
  "rounded-large",
  "rounded-extra-large",
  "text-label-large",
  "text-title-medium",
  "text-body-large",
  "text-headline-small-emphasized",
  "font-brand",
  "shadow-elevation-2",
  "ease-emphasized",
  "duration-300",
  "p-4",
  "flex",
  "gap-2",
  "hover:bg-on-surface/8",
  "md:grid",
];

/** The classes only the extended preset has: shape, state layer, typescale, spring motion, adaptive and Base UI variants. */
export const M3_CANDIDATES = [
  "shape-large-top",
  "state-layer",
  "state-layer-primary",
  "typescale-label-large",
  "motion-expressive-default-spatial",
  "compact:hidden",
  "h-medium:flex",
  "m3-open:bg-primary",
  "m3-on:text-on-primary",
  "dark:bg-surface",
];

async function tailwindCss(): Promise<{
  preset: Measure;
  app: Measure;
  m3: Measure;
}> {
  const base = join(PACKAGES, "m3-tailwind");
  const input = [
    '@import "tailwindcss/theme.css" layer(theme);',
    '@import "tailwindcss/utilities.css" layer(utilities);',
    '@import "@aphrody/m3-tailwind/preset.css";',
  ].join("\n");
  const compiler = await compile(input, { base, onDependency() {} });
  const app = await minifyCss(compiler.build(TYPICAL_CANDIDATES));
  const m3 = await minifyCss(
    compiler.build([...TYPICAL_CANDIDATES, ...M3_CANDIDATES]),
  );
  const preset = await minifyCss(
    readFileSync(join(base, "preset.css"), "utf8"),
  );
  return { preset, app, m3 };
}

export async function measure(): Promise<Report> {
  const baseui = entryOf("m3-baseui");
  const nextClient = join(PACKAGES, "m3-next/src/client.tsx");
  const nextIndex = join(PACKAGES, "m3-next/src/index.ts");
  const report: Report = {};

  report["baseui.js.button"] = await bundle(
    `import { M3Button } from ${JSON.stringify(baseui)}; globalThis.x = M3Button;`,
  );
  report["baseui.js.button+switch+tabs"] = await bundle(
    `import { M3Button, M3Switch, M3Tabs } from ${JSON.stringify(baseui)}; globalThis.x = [M3Button, M3Switch, M3Tabs.Root];`,
  );
  report["baseui.js.everything"] = await bundle(
    `import * as all from ${JSON.stringify(baseui)}; globalThis.x = all;`,
  );

  report["baseui.js.dialog"] = await bundle(
    `import { M3Dialog } from ${JSON.stringify(baseui)}; globalThis.x = [M3Dialog.Root, M3Dialog.Popup, M3Dialog.Title];`,
  );
  report["baseui.js.select"] = await bundle(
    `import { M3Select } from ${JSON.stringify(baseui)}; globalThis.x = [M3Select.Root, M3Select.Popup, M3Select.Item];`,
  );

  const baseuiDir = join(PACKAGES, "m3-baseui");
  report["baseui.css.all"] = await minifyCss(
    `@import ${JSON.stringify(join(baseuiDir, "m3-baseui.css"))};`,
  );
  if (existsSync(join(baseuiDir, "css/button.css"))) {
    report["baseui.css.button"] = await minifyCss(
      `@import ${JSON.stringify(join(baseuiDir, "css/core.css"))};\n@import ${JSON.stringify(join(baseuiDir, "css/button.css"))};`,
    );
  }

  const tw = await tailwindCss();
  report["tailwind.preset.css"] = tw.preset;
  report["tailwind.app.css"] = tw.app;
  report["tailwind.app.m3.css"] = tw.m3;

  const clientExternal = [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "next",
    "next/*",
  ];
  const client = await bundleSplit(
    `import * as c from ${JSON.stringify(nextClient)}; globalThis.x = c;`,
    clientExternal,
  );
  report["next.client.js"] = client.entry;
  if (client.lazy.bytes > 0) report["next.client.lazy.js"] = client.lazy;
  report["next.index.js"] = await bundle(
    `import * as c from ${JSON.stringify(nextIndex)}; globalThis.x = c;`,
    ["react", "react-dom", "react/jsx-runtime", "next", "next/*"],
  );
  return report;
}

const LABELS: Record<string, string> = {
  "baseui.js.button": "m3-baseui JS, `M3Button` only",
  "baseui.js.button+switch+tabs": "m3-baseui JS, Button + Switch + Tabs",
  "baseui.js.everything": "m3-baseui JS, `import *` (whole package)",
  "baseui.js.dialog": "m3-baseui JS, Dialog (Root, Popup, Title)",
  "baseui.js.select": "m3-baseui JS, Select (Root, Popup, Item)",
  "baseui.css.all": "m3-baseui CSS, every component (minified)",
  "baseui.css.button": "m3-baseui CSS, core + Button only (minified)",
  "tailwind.preset.css": "m3-tailwind `preset.css` (minified)",
  "tailwind.app.css": "Tailwind app CSS, 25 typical classes (minified)",
  "tailwind.app.m3.css":
    "same 25 classes plus 10 of the new utilities and variants (minified)",
  "next.client.js":
    "m3-next client entry JS (theme provider; downloaded up front)",
  "next.client.lazy.js":
    "m3-next colour engine chunk (loaded only for a custom seed, variant or contrast)",
  "next.index.js":
    "m3-next config/scheme entry JS (server and build time only)",
};

const delta = (a: number, b: number): string =>
  a === 0 ? "n/a" : `${(((b - a) / a) * 100).toFixed(1)}%`;

export interface ExampleSize {
  js: Measure;
  css: Measure;
  files: number;
}

/** Client assets of a built example: `.next/static` (server app) or `out/_next/static` (static export). */
export function exampleSizes(dir: string): ExampleSize | undefined {
  const root = [join(dir, "out/_next/static"), join(dir, ".next/static")].find(
    (d) => existsSync(d),
  );
  if (!root) return undefined;
  let js = Buffer.alloc(0);
  let css = Buffer.alloc(0);
  let files = 0;
  const walkDir = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.name.endsWith(".js")) {
        js = Buffer.concat([js, readFileSync(full)]);
        files += 1;
      } else if (entry.name.endsWith(".css")) {
        css = Buffer.concat([css, readFileSync(full)]);
        files += 1;
      }
    }
  };
  walkDir(root);
  return {
    js: { bytes: js.length, gzip: gz(js) },
    css: { bytes: css.length, gzip: gz(css) },
    files,
  };
}

export function markdown(
  after: Report,
  before: Report | undefined,
  extra: string,
): string {
  const rows = Object.keys({ ...before, ...after }).map((key) => {
    const a = after[key] as Measure | undefined;
    const b = before?.[key] as Measure | undefined;
    const cell = (m: Measure | undefined): string =>
      m ? `${m.bytes} (${m.gzip} gz)` : "n/a";
    return `| ${LABELS[key] ?? key} | ${cell(b)} | ${cell(a)} | ${a && b ? delta(b.bytes, a.bytes) : "n/a"} |`;
  });
  return `<!-- SPDX-License-Identifier: Apache-2.0 -->
# M3 Next 16 stack: bundle and build numbers

Generated by \`bun packages/m3-next/scripts/bundle-report.ts --before <baseline.json> --write docs/reports/M3-NEXT-BUNDLE.md\`.
Bytes are minified output (gzip level 9 in parentheses), Bun ${Bun.version}, browser target, \`react\` and \`react-dom\`
external, Base UI bundled. "Before" is the tree at commit \`0c2cc62\` (the barrel with \`export * as BaseUI\`).

| Measure | Before (bytes) | After (bytes) | Delta |
| --- | --- | --- | --- |
${rows.join("\n")}

${extra}`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const after = await measure();
  const out = flag("--out");
  if (out) writeFileSync(out, JSON.stringify(after, null, 2) + "\n");
  const beforePath = flag("--before");
  const before = beforePath
    ? (JSON.parse(readFileSync(beforePath, "utf8")) as Report)
    : undefined;
  const mdPath = flag("--write");
  const extraPath = flag("--extra");
  let extra = extraPath ? readFileSync(extraPath, "utf8") : "";
  if (args.includes("--examples")) {
    const examples = join(PACKAGES, "m3-next/examples");
    const rows: string[] = [];
    for (const name of ["app", "tauri"]) {
      const sizes = exampleSizes(join(examples, name));
      if (!sizes) continue;
      const bench = flag(`--bench-${name}`);
      const times =
        bench && existsSync(bench)
          ? (JSON.parse(readFileSync(bench, "utf8")) as {
              coldMedian: number;
              warmMedian: number;
              cold: number[];
              warm: number[];
            })
          : undefined;
      rows.push(
        `| ${name === "app" ? "examples/app (server: Cache Components, proxy.ts, React Compiler)" : "examples/tauri (static export)"} | ${sizes.js.bytes} (${sizes.js.gzip} gz) | ${sizes.css.bytes} (${sizes.css.gzip} gz) | ${times ? `${times.coldMedian} ms (${times.cold.join(", ")})` : "n/a"} | ${times ? `${times.warmMedian} ms (${times.warm.join(", ")})` : "n/a"} |`,
      );
    }
    if (rows.length > 0)
      extra += `## Example apps, built and measured through yolo

\`yolo web build\` on Bun ${Bun.version}: Next 16.3.8 with Turbopack, Turbopack workers on Bun too (the \`m3-next\` runner puts a Bun \`node\` first on PATH). Client assets are the files under \`static/\` (JS and CSS, unminified sum of every chunk the build emits, all routes). Cold removes \`.next\` (and \`out\`); warm keeps the build cache. Times are the wall time of the yolo command, median of three (runs listed), on a shared WSL machine.

| App | Client JS | Client CSS | Cold build | Warm build |
| --- | --- | --- | --- | --- |
${rows.join("\n")}
`;
  }
  if (mdPath) {
    writeFileSync(mdPath, markdown(after, before, extra));
    console.log(`wrote ${mdPath}`);
  }
  if (args.includes("--json") || (!mdPath && !out))
    console.log(JSON.stringify(after, null, 2));
}

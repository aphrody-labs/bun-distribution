// SPDX-License-Identifier: Apache-2.0
//! Browser-bundle gate for `m3/packages`: every public entry must bundle for the browser target
//! (no Bun FFI, no Node builtins) unless it is listed as server/tooling-only below.
//!
//!   bun scripts/audit/ui-browser-bundles.ts [--json]

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Entries that are server, build or native by design, with the reason they may not bundle for the browser. */
export const SERVER_ONLY: Readonly<Record<string, string>> = {
  "canvas/index.ts": "native .node addon",
  "m3-config/test/dom.ts": "bun test preload",
  "m3-config/tsup.ts": "build tooling",
  "m3-config/bun-build.ts": "Bun build preset",
  "m3-config/cache-db.ts": "Bun SQLite cache (bun:sqlite)",
  "m3-icons/src/index.ts": "renders through the Bun FFI; browsers use ./browser and ./browser/lit",
  "m3-icons/src/codegen.ts": "build-time generator (Bun FFI)",
  "m3-icons/src/plugin.ts": "Bun build plugin (Bun FFI)",
  "m3-next/src/server.tsx": "server entry (node:url)",
  "m3/src/index.ts": "build tooling entry (node:module)",
  "m3/src/build.ts": "build tooling (node:module)",
  "m3/src/plugin.ts": "Bun build plugin (node:module)",
  "m3/src/server.ts": "dev server (node:url)",
};

const FFI_MARKERS = /bun_rs_|dlopen\(|aphrody-ffi native library/;
const NON_CODE = /\.(css|json|d\.ts|scss|woff2?|ttf)$/;

/** Collect string leaves of an `exports` map, ignoring `types` conditions. */
export function exportTargets(exportsField: unknown, out = new Set<string>()): Set<string> {
  if (typeof exportsField === "string") out.add(exportsField);
  else if (exportsField && typeof exportsField === "object") {
    for (const [key, value] of Object.entries(exportsField)) {
      if (key !== "types") exportTargets(value, out);
    }
  }
  return out;
}

/** Resolve a package export target to a source (preferred) or built file that exists. */
export function resolveEntry(packageDir: string, target: string): string | undefined {
  if (!target.startsWith(".") || NON_CODE.test(target)) return undefined;
  const clean = target.replace(/^\.\//, "");
  const stem = clean.replace(/^dist\//, "src/").replace(/\.[^./]+$/, "");
  for (const ext of [".ts", ".tsx", ".js", ".mjs"]) {
    if (existsSync(join(packageDir, stem + ext))) return stem + ext;
  }
  return existsSync(join(packageDir, clean)) ? clean : undefined;
}

export type Verdict = "ok" | "server-only" | "native-in-bundle" | "unexpected-failure" | "stale-allowlist";

export function classify(entry: string, bundled: boolean, nativeMarker: boolean): Verdict {
  if (bundled && nativeMarker) return "native-in-bundle";
  if (bundled) return entry in SERVER_ONLY ? "stale-allowlist" : "ok";
  return entry in SERVER_ONLY ? "server-only" : "unexpected-failure";
}

export function discoverEntries(uiRoot: string): string[] {
  const entries = new Set<string>();
  for (const name of readdirSync(uiRoot, { withFileTypes: true })) {
    const packageDir = join(uiRoot, name.name);
    const manifest = join(packageDir, "package.json");
    if (!name.isDirectory() || !existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as Record<string, unknown>;
    const targets = pkg.exports
      ? exportTargets(pkg.exports)
      : new Set([pkg.module, pkg.main].filter((v): v is string => typeof v === "string"));
    for (const target of targets) {
      const entry = resolveEntry(packageDir, target);
      if (entry) entries.add(`${name.name}/${entry}`);
    }
  }
  return [...entries].toSorted();
}

/** Resolve Vite-style `?url` asset imports to the file itself, as the consuming app bundlers do. */
const assetUrlPlugin: import("bun").BunPlugin = {
  name: "asset-url",
  setup(build) {
    build.onResolve({ filter: /\?url$/ }, args => {
      const path = resolve(dirname(args.importer), args.path.replace(/\?url$/, ""));
      if (!existsSync(path)) throw new Error(`missing asset: ${args.path}`);
      return { path, namespace: "asset-url" };
    });
    build.onLoad({ filter: /.*/, namespace: "asset-url" }, args => ({
      contents: `export default ${JSON.stringify(args.path)};`,
      loader: "js",
    }));
  },
};

if (import.meta.main) {
  const uiRoot = resolve(import.meta.dir, "../../m3/packages");
  const json = process.argv.includes("--json");
  const rows: { entry: string; verdict: Verdict; detail?: string }[] = [];
  for (const entry of discoverEntries(uiRoot)) {
    const result = await Bun.build({
      entrypoints: [join(uiRoot, entry)],
      target: "browser",
      external: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "lit",
        "lit/*",
        "next/*",
        "@tauri-apps/*",
      ],
      plugins: [assetUrlPlugin],
    }).catch((error: AggregateError) => ({
      success: false as const,
      logs: error.errors ?? [error],
      outputs: [],
    }));
    if (!result.success) {
      const detail = (result.logs as { message?: string }[]).map(l => l.message ?? String(l))[0]?.slice(0, 140);
      rows.push({ entry, verdict: classify(entry, false, false), detail });
      continue;
    }
    const text = (await Promise.all(result.outputs.map(o => o.text()))).join("\n");
    rows.push({
      entry,
      verdict: classify(entry, true, FFI_MARKERS.test(text)),
    });
  }
  const failed = rows.filter(r => r.verdict === "unexpected-failure" || r.verdict === "native-in-bundle");
  if (json) console.log(JSON.stringify({ rows, failed: failed.length }, null, 2));
  else {
    for (const r of rows) console.log(`${r.verdict.padEnd(19)} ${r.entry}${r.detail ? `  -> ${r.detail}` : ""}`);
    const count = (v: Verdict) => rows.filter(r => r.verdict === v).length;
    console.log(
      `\n${count("ok")} ok, ${count("server-only")} server-only, ${count("stale-allowlist")} stale allowlist, ${failed.length} failing`,
    );
  }
  process.exit(failed.length === 0 ? 0 : 1);
}

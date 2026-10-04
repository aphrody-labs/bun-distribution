// SPDX-License-Identifier: Apache-2.0
// Shared tsup preset for the first-party Material 3 packages (docs/design/M3-PLAN.md, phase 1).
//
//   import { m3Tsup } from "@aphrody/m3-config/tsup";
//   export default m3Tsup({ entry: ["src/index.ts", "src/react.tsx"] });
//
// `.d.ts` files come from `tsc -p tsconfig.build.json`: tsup's rollup dts pipeline trips over the
// `baseUrl` deprecation in TypeScript 6+, so `dts` stays off here.
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig, type Options } from "tsup";

const USE_CLIENT = "'use client';\n";

/** Everything the M3 packages never bundle: React, Lit, motion, Tailwind and the workspace scope. */
export const M3_EXTERNAL: (string | RegExp)[] = [
  /^react($|\/)/,
  /^react-dom($|\/)/,
  /^@aphrody\//,
  /^@lit\//,
  /^lit($|\/)/,
  /^motion($|\/)/,
  "tailwindcss",
];

/**
 * Prepend the React client directive to the emitted `.js` files. esbuild drops module-level
 * directives when bundling and ignores `banner` for them, so it is re-injected after the build.
 * With `only`, just the named top-level files of `dir` are marked.
 */
export async function prependUseClient(dir: string, only?: readonly string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!only) await prependUseClient(full);
        return;
      }
      if (!entry.name.endsWith(".js") || (only && !only.includes(entry.name))) return;
      const src = await readFile(full, "utf8");
      if (!src.startsWith(USE_CLIENT)) await writeFile(full, USE_CLIENT + src, "utf8");
    }),
  );
}

export interface M3TsupOptions extends Options {
  /**
   * `true` (default) marks every emitted file as a React client module, a list limits that to the
   * named `dist/` files, `false` skips it (packages without React code).
   */
  useClient?: boolean | readonly string[];
}

export function m3Tsup({ useClient = true, external = [], ...overrides }: M3TsupOptions = {}) {
  return defineConfig({
    entry: ["src/index.ts"],
    format: ["esm"],
    target: "es2022",
    platform: "browser",
    outDir: "dist",
    dts: false,
    sourcemap: true,
    clean: true,
    splitting: true,
    treeshake: true,
    external: [...M3_EXTERNAL, ...external],
    ...overrides,
    async onSuccess() {
      if (useClient === false) return;
      await prependUseClient(overrides.outDir ?? "dist", useClient === true ? undefined : useClient);
    },
  });
}

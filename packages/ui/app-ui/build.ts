// SPDX-License-Identifier: Apache-2.0
// Production build of the Tauri webview: `m3 build --tauri` (Bun.build through buildM3) plus one
// resolver for the undeclared dependencies of react-selecto.
//
// react-selecto@1.26 imports `react`, `framework-utils` and `@daybrush/utils` without declaring
// them (only `selecto` is a dependency). The workspace uses Bun's isolated linker without
// hoisting, so those bare imports do not resolve from its store directory. They are resolved
// here from the sibling `selecto` package (which declares the two utilities) and from this
// package (which declares React), so the bundle keeps a single React copy.
import { dirname, join } from "node:path";
import { buildM3 } from "@aphrody/m3/build";
import { loadM3Config } from "@aphrody/m3/config";
import type { BunPlugin } from "bun";

const here = import.meta.dir;

/** Resolve a bare import made by a package that forgot to declare it. */
export const undeclaredDependencies: BunPlugin = {
  name: "app-ui-undeclared-dependencies",
  setup(build) {
    build.onResolve({ filter: /^(react(\/.*)?|framework-utils|@daybrush\/utils)$/ }, (args) => {
      if (!args.importer.includes("/react-selecto/")) return undefined;
      const selectoDir = dirname(Bun.resolveSync("selecto/package.json", args.importer));
      for (const from of [selectoDir, here]) {
        try {
          return { path: Bun.resolveSync(args.path, from) };
        } catch {
          // try the next base directory
        }
      }
      return undefined;
    });
  },
};

if (import.meta.main) {
  const config = await loadM3Config(here);
  if (!config.tauri) throw new Error("app-ui: m3.config.ts must set tauri.uiDist");
  const dev = process.argv.includes("--dev");
  const started = performance.now();
  const result = await buildM3({
    entry: config.entry,
    outdir: config.outdir,
    production: !dev,
    define: config.define,
    drop: config.drop,
    minify: config.minify,
    optimizeImports: config.optimizeImports,
    tauri: config.tauri,
    plugin: { theme: config.theme, root: config.root, configDir: config.dir },
    plugins: [undeclaredDependencies],
    cwd: config.dir,
  });
  const bytes = result.outputs.reduce((sum, output) => sum + output.bytes, 0);
  console.log(
    `app-ui build: ${result.outputs.length} files, ${bytes} B into ${join(result.outdir)} in ${Math.round(performance.now() - started)} ms`,
  );
}

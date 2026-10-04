// SPDX-License-Identifier: Apache-2.0
// Build the desktop webview with the same native M3 bundler used in development.
import { buildM3 } from "@aphrody/m3/build";
import { loadM3Config } from "@aphrody/m3/config";
import { undeclaredDependencies } from "./undeclared-deps";

if (import.meta.main) {
  const config = await loadM3Config(import.meta.dir);
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
    `app-ui build: ${result.outputs.length} files, ${bytes} B into ${result.outdir} in ${Math.round(performance.now() - started)} ms`,
  );
}

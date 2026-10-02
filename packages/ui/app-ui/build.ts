// SPDX-License-Identifier: Apache-2.0
// Production build of the Tauri webview: `m3 build --tauri` (Bun.build through buildM3) plus the
// react-selecto resolver from `./undeclared-deps.ts` (also used by `m3 dev` through bunfig.toml).
import { copyFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildM3 } from "@aphrody/m3/build";
import { loadM3Config } from "@aphrody/m3/config";
import { undeclaredDependencies } from "./undeclared-deps";

const here = import.meta.dir;
const root = resolve(here, "../../..");

if (import.meta.main) {
  const isWindows = process.platform === "win32";
  const wasmBuild = Bun.spawnSync(
    isWindows
      ? [
          "pwsh",
          "-NoProfile",
          "-File",
          join(root, "scripts/build/rust/cargo-serial.ps1"),
          "build",
          "-p",
          "aphrody-shell-web",
          "--target",
          "wasm32-unknown-unknown",
          "--release",
        ]
      : ["bash", "scripts/build/shell/build-wasm.sh"],
    {
      cwd: root,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (wasmBuild.exitCode !== 0) throw new Error("shell WASM build failed");
  if (isWindows) {
    const bindgen = Bun.spawnSync(
      [
        "wasm-bindgen",
        "--target",
        "web",
        "--out-dir",
        join(root, "packages/shell/web/pkg"),
        join(
          resolve(root, Bun.env.CARGO_TARGET_DIR ?? "target"),
          "wasm32-unknown-unknown/release/aphrody_shell_web.wasm",
        ),
      ],
      { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
    );
    if (bindgen.exitCode !== 0) throw new Error("shell wasm-bindgen failed");
  }
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
  const workerDir = join(result.outdir, "shell");
  await mkdir(workerDir, { recursive: true });
  const worker = await Bun.build({
    entrypoints: [join(root, "packages/shell/web/src/worker.ts")],
    outdir: workerDir,
    target: "browser",
    naming: "worker.js",
  });
  if (!worker.success) throw new Error(`shell worker build failed: ${worker.logs.join("; ")}`);
  const pkgDir = join(result.outdir, "pkg");
  await mkdir(pkgDir, { recursive: true });
  await Promise.all(
    ["aphrody_shell_web.js", "aphrody_shell_web_bg.wasm"].map((file) =>
      copyFile(join(root, "packages/shell/web/pkg", file), join(pkgDir, file)),
    ),
  );
  const bytes = result.outputs.reduce((sum, output) => sum + output.bytes, 0);
  console.log(
    `app-ui build: ${result.outputs.length} files, ${bytes} B into ${join(result.outdir)} in ${Math.round(performance.now() - started)} ms`,
  );
}

#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// One builder for the JavaScript side of the Tauri fork packages: produces the files their `exports` declare,
// so each package installs from an archive or a registry like any npm package.
//   @aphrody/api                    src/**/*.ts      -> dist/**/*.{js,cjs,d.ts}
//   @aphrody/plugin-*               guest-js/index.ts -> dist-js/index.{js,cjs,d.ts}
// ESM and CommonJS come from Bun.build; declarations from tsgo. Run from the package directory: `bun ../build-js.ts`.
import { existsSync, rmSync } from "node:fs";
import { join, relative } from "node:path";

export interface Layout {
  entries: string[];
  root: string;
  outdir: string;
  external: string[];
}

/** Entry points and output directory of a package directory. */
export function layoutOf(dir: string, manifest: { name: string; dependencies?: Record<string, string> }): Layout {
  const external = Object.keys(manifest.dependencies ?? {});
  if (existsSync(join(dir, "guest-js/index.ts"))) {
    return { entries: [join(dir, "guest-js/index.ts")], root: join(dir, "guest-js"), outdir: join(dir, "dist-js"), external };
  }
  const entries = [...new Bun.Glob("**/*.ts").scanSync({ cwd: join(dir, "src") })]
    .filter((f) => !f.endsWith(".d.ts") && !f.endsWith(".test.ts"))
    .toSorted()
    .map((f) => join(dir, "src", f));
  return { entries, root: join(dir, "src"), outdir: join(dir, "dist"), external };
}

async function build(dir: string): Promise<void> {
  const manifest = await Bun.file(join(dir, "package.json")).json();
  const layout = layoutOf(dir, manifest);
  rmSync(layout.outdir, { recursive: true, force: true });
  for (const [format, naming] of [["esm", "[dir]/[name].js"], ["cjs", "[dir]/[name].cjs"]] as const) {
    const result = await Bun.build({
      entrypoints: layout.entries,
      root: layout.root,
      outdir: layout.outdir,
      format,
      target: "browser",
      naming,
      external: layout.external,
    });
    if (!result.success) {
      for (const log of result.logs) console.error(log);
      process.exit(1);
    }
  }
  const tsgo = Bun.which("tsgo") ?? Bun.which("tsc");
  if (!tsgo) throw new Error("tsgo or tsc is required for declarations");
  const tsconfig = existsSync(join(dir, "tsconfig.json")) ? ["-p", join(dir, "tsconfig.json")] : layout.entries;
  const types = Bun.spawnSync(
    [tsgo, ...tsconfig, "--noEmit", "false", "--declaration", "--emitDeclarationOnly", "--rootDir", layout.root, "--outDir", layout.outdir],
    { cwd: dir, stdout: "inherit", stderr: "inherit" },
  );
  if (types.exitCode !== 0) process.exit(types.exitCode ?? 1);
  console.log(`${manifest.name}: ${relative(dir, layout.outdir)}/ (${layout.entries.length} entries)`);
}

if (import.meta.main) await build(process.cwd());

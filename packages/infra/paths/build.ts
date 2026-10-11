// SPDX-License-Identifier: Apache-2.0
import { rename } from "node:fs/promises";
import { join } from "node:path";

// The implementation stays in Workspace; npm consumers receive a self-contained bundle.
const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "src/index.ts")],
  outdir: join(import.meta.dir, "dist"),
  target: "bun",
  packages: "external",
});
if (!result.success) throw new AggregateError(result.logs, "Path package build failed");
const compiler = Bun.spawn(
  [
    "bun",
    join(import.meta.dir, "../../../node_modules/typescript/bin/tsc"),
    "--declaration",
    "--emitDeclarationOnly",
    "--target",
    "esnext",
    "--module",
    "preserve",
    "--moduleResolution",
    "bundler",
    "--types",
    "bun",
    "--skipLibCheck",
    "--outDir",
    join(import.meta.dir, "dist"),
    join(import.meta.dir, "../workspace/src/paths.ts"),
  ],
  { stdout: "inherit", stderr: "inherit", windowsHide: true },
);
if ((await compiler.exited) !== 0) throw new Error("Path declaration build failed");
await rename(join(import.meta.dir, "dist/paths.d.ts"), join(import.meta.dir, "dist/index.d.ts"));

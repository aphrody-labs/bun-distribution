// SPDX-License-Identifier: Apache-2.0
import { join } from "node:path";

// npm consumers receive a self-contained bundle from the package's source owner.
const result = await Bun.build({
  entrypoints: [join(import.meta.dir, "src/index.ts")],
  outdir: join(import.meta.dir, "dist"),
  target: "bun",
  packages: "external",
});
if (!result.success) throw new AggregateError(result.logs, "Path package build failed");
const compiler = Bun.spawn(
  [
    Bun.which("tsgo") ?? "tsgo",
    "--ignoreConfig",
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
    join(import.meta.dir, "src/index.ts"),
  ],
  { stdout: "inherit", stderr: "inherit", windowsHide: true },
);
if ((await compiler.exited) !== 0) throw new Error("Path declaration build failed");

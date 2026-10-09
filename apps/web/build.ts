#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
// Web and desktop consume the same canonical app-ui artifact.
const build = Bun.spawn(
  [
    process.execPath,
    resolve(import.meta.dir, "../../m3/packages/app-ui/build.ts"),
    ...process.argv.slice(2),
  ],
  {
    cwd: resolve(import.meta.dir, "../.."),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.exit(await build.exited);

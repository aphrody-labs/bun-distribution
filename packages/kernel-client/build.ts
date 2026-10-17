// SPDX-License-Identifier: Apache-2.0
import { resolve } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";

const root = resolve(import.meta.dir, "../..");
const result = await runProcess(
  [process.execPath, resolve(root, "scripts/build-packages.ts"), "build", "--package", "kernel-client"],
  root,
  { timeoutMs: 30000 },
);
if (result.stdout) console.log(result.stdout.trimEnd());
if (result.stderr) console.error(result.stderr.trimEnd());
if (result.code !== 0) throw new Error("Root package build failed");

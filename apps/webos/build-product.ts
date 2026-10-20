// SPDX-License-Identifier: Apache-2.0
// One product assembly: the canonical App UI mounted in the WebOS site.
import { resolve } from "node:path";

if (process.platform !== "linux")
  throw new Error("Build the superapp on the Linux VPS factory.");

const root = resolve(import.meta.dir, "../..");
const appUiDist = resolve(root, Bun.env.BUN_OS_APP_UI_DIST ?? "build/app-ui");

for (const args of [
  ["packages/app-ui/build.ts", "--base", "/workspace/", "--out", appUiDist],
  ["apps/webos/build.ts"],
]) {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: root,
    env: { ...Bun.env, BUN_OS_APP_UI_DIST: appUiDist },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) process.exit(code);
}

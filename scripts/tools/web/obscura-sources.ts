// SPDX-License-Identifier: Apache-2.0
import { dirname, resolve } from "node:path";

/** Read the engine source selected by the product's locked dependency graph. */
export function obscuraSourceRoot(workspace: string): string {
  const result = Bun.spawnSync(
    ["cargo", "metadata", "--locked", "--offline", "--format-version", "1"],
    { cwd: workspace, stdout: "pipe", stderr: "pipe", windowsHide: true },
  );
  if (result.exitCode !== 0) {
    throw new Error(`Cannot resolve the locked Obscura provider: ${result.stderr.toString()}`);
  }
  const metadata = JSON.parse(result.stdout.toString()) as {
    packages: Array<{ name: string; manifest_path: string }>;
  };
  const engine = metadata.packages.find((entry) => entry.name === "obscura-js");
  if (!engine) throw new Error("The locked dependency graph contains no obscura-js package");
  return resolve(dirname(engine.manifest_path), "..");
}

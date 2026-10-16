#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- Registry requests run in bounded batches of six. */
import { resolve } from "node:path";

export type ReleasedPackage = { name: string; version: string; status: string; integrity?: string };
export function installSpecs(packages: ReleasedPackage[], only?: string[]): string[] {
  const released = packages.filter((entry) => entry.status === "published");
  if (only)
    for (const name of only)
      if (!released.some((entry) => entry.name === name))
        throw new Error(`Package is not qualified and published: ${name}`);
  const specs = released
    .filter((entry) => !only || only.includes(entry.name))
    .map((entry) => `${entry.name}@${entry.version}`);
  if (!specs.length) throw new Error("No published packages selected");
  return specs;
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  const value = (flag: string) => {
    if (!args.includes(flag)) return undefined;
    const result = args[args.indexOf(flag) + 1];
    if (!result || result.startsWith("--")) throw new Error(`${flag} requires a value`);
    return result;
  };
  if (args.includes("--help")) {
    console.log(
      "bun run packages:install --cwd PROJECT [--only @aphrody/name,@aphrody/name] [--list]",
    );
  } else {
    const catalog = (await Bun.file(
      resolve(import.meta.dir, "../../../tools/aphrody/config/npm-packages.json"),
    ).json()) as { packages: ReleasedPackage[] };
    const specs = installSpecs(catalog.packages, value("--only")?.split(","));
    if (args.includes("--list")) console.log(specs.join("\n"));
    else {
      const cwd = value("--cwd");
      if (!cwd)
        throw new Error(
          "--cwd PROJECT is required; the repository is never an implicit installation target",
        );
      if (!(await Bun.file(resolve(cwd, "package.json")).exists()))
        throw new Error("Create the consumer package.json first (bun init)");
      // Registry preflight completes before mutating the consumer.
      for (let start = 0; start < specs.length; start += 6) {
        await Promise.all(
          specs.slice(start, start + 6).map(async (specifier) => {
            const split = specifier.lastIndexOf("@");
            const name = specifier.slice(0, split);
            const version = specifier.slice(split + 1);
            const response = await fetch(
              `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
              { signal: AbortSignal.timeout(30000) },
            );
            if (!response.ok)
              throw new Error(`Registry preflight failed: ${specifier} (HTTP ${response.status})`);
            const metadata = (await response.json()) as { dist?: { integrity?: string } };
            const expected = catalog.packages.find((entry) => entry.name === name)?.integrity;
            if (expected && metadata.dist?.integrity !== expected)
              throw new Error(`Registry integrity mismatch: ${specifier}`);
          }),
        );
      }
      const child = Bun.spawn([Bun.which("bun") ?? process.execPath, "add", ...specs], {
        windowsHide: true,
        cwd: resolve(cwd),
        stdout: "inherit",
        stderr: "inherit",
      });
      process.exitCode = await child.exited;
    }
  }
}

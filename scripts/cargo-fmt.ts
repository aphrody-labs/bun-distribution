#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * rustfmt for the crates this repository owns. Crates that live in a Git submodule keep the formatting of their
 * own repository, so they are neither checked nor rewritten here.
 *
 *   bun scripts/cargo-fmt.ts           # check
 *   bun scripts/cargo-fmt.ts --write   # format in place
 */
import { dirname, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const write = Bun.argv.includes("--write");

async function capture(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd: root, stdout: "pipe", stderr: "inherit" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`${cmd.join(" ")} failed`);
  return out;
}

const submodules = (await capture(["git", "ls-files", "-s"]))
  .split("\n")
  .filter(line => line.startsWith("160000"))
  .map(line => line.split("\t")[1]!);
const inSubmodule = (dir: string) => {
  const path = relative(root, dir).replaceAll("\\", "/");
  return submodules.some(submodule => path === submodule || path.startsWith(`${submodule}/`));
};

const metadata = JSON.parse(await capture(["cargo", "metadata", "--format-version", "1", "--no-deps", "--locked"]));
const owned: string[] = metadata.packages
  .filter((pkg: { manifest_path: string }) => !inSubmodule(dirname(pkg.manifest_path)))
  .map((pkg: { name: string }) => pkg.name);

const args = ["cargo", "fmt", ...owned.flatMap(name => ["-p", name]), ...(write ? [] : ["--", "--check"])];
console.log(`rustfmt: ${owned.length} owned crates, ${metadata.packages.length - owned.length} in submodules skipped`);
process.exit(await Bun.spawn(args, { cwd: root, stdout: "inherit", stderr: "inherit" }).exited);

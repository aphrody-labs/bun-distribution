#!/usr/bin/env bun
/** Retire redundant workspace installs after proving the root package owner. */
import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runProcess } from "../packages/bun-workspace/src/process.ts";

const root = resolve(import.meta.dir, "..");
const product = await Bun.file(join(root, "package.json")).json();
const members: string[] = product.workspaces;
for (const member of members) {
  const directory = resolve(root, member, "node_modules");
  const within = relative(root, directory);
  if (
    isAbsolute(within) ||
    within.startsWith(".." + sep) ||
    within === ".." ||
    directory === join(root, "node_modules")
  )
    throw new Error("Workspace install target is outside the product root.");
  const info = await lstat(directory).catch(error => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!info || info.isSymbolicLink()) continue;
  const resolvedParent = relative(root, await realpath(dirname(directory)));
  if (isAbsolute(resolvedParent) || resolvedParent.startsWith(".." + sep) || resolvedParent === "..")
    throw new Error("Workspace install target resolves outside the product root.");
  const packageDirectories: { name: string; path: string }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".bin") continue;
    if (entry.name.startsWith("@")) {
      for (const scoped of await readdir(join(directory, entry.name)))
        packageDirectories.push({ name: `${entry.name}/${scoped}`, path: join(directory, entry.name, scoped) });
    } else packageDirectories.push({ name: entry.name, path: join(directory, entry.name) });
  }
  for (const installed of packageDirectories) {
    const canonical = join(root, "node_modules", installed.name);
    const [local, shared] = await Promise.all([
      Bun.file(join(installed.path, "package.json")).json(),
      Bun.file(join(canonical, "package.json")).json(),
    ]);
    if (local.name !== shared.name || local.version !== shared.version)
      throw new Error(`Root package does not replace ${installed.name}.`);
    if (!(await lstat(installed.path)).isSymbolicLink()) {
      for (const path of new Bun.Glob("**/*").scanSync({ cwd: installed.path, onlyFiles: true, dot: true })) {
        const source = Bun.file(join(installed.path, path));
        const target = Bun.file(join(canonical, path));
        if (
          !(await target.exists()) ||
          (await source.arrayBuffer()).byteLength !== target.size ||
          Bun.CryptoHasher.hash("sha256", await source.arrayBuffer(), "hex") !==
            Bun.CryptoHasher.hash("sha256", await target.arrayBuffer(), "hex")
        )
          throw new Error(`Root package differs from workspace package ${installed.name}.`);
      }
    }
  }
  if (process.platform === "win32") {
    const removed = await runProcess(
      [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "& { param([string]$target) Remove-Item -LiteralPath $target -Recurse -ErrorAction Stop }",
        directory,
      ],
      root,
      { timeoutMs: 30_000, maxOutputBytes: 1024 * 1024 },
    );
    if (removed.code !== 0) throw new Error("Workspace install cleanup failed.");
  } else await rm(directory, { recursive: true });
  console.log(`Root node_modules now owns ${member}`);
}

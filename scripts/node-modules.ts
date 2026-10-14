#!/usr/bin/env bun
/** Retire redundant installs only after proving the root package owner. */
import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";
const root = resolve(import.meta.dir, "..");
const deadline = performance.now() + 30_000;
const args = Bun.argv.slice(2);
if (args.some(arg => arg !== "--plan")) throw new Error("Usage: bun scripts/node-modules.ts [--plan]");
const planOnly = args.includes("--plan");
const product = await Bun.file(join(root, "package.json")).json();
if (!Array.isArray(product.workspaces) || product.workspaces.some((value: unknown) => typeof value !== "string"))
  throw new Error("Root workspaces must be string patterns.");
function assertWithin(path: string): void {
  const within = relative(root, resolve(path));
  if (isAbsolute(within) || within === ".." || within.startsWith(".." + sep))
    throw new Error("Workspace path is outside the product root.");
}
async function regularPath(path: string): Promise<boolean> {
  if (performance.now() > deadline) throw new Error("Nested install qualification exceeded its 30 second budget.");
  assertWithin(path);
  let current = root;
  for (const part of ["", ...relative(root, resolve(path)).split(sep).filter(Boolean)]) {
    if (part) current = join(current, part);
    const info = await lstat(current).catch(error => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (!info) return false;
    if (info.isSymbolicLink()) throw new Error("Workspace reparse or symbolic link path refused.");
    assertWithin(await realpath(current));
  }
  return true;
}
const members = new Set<string>();
for (const declared of product.workspaces as string[]) {
  const pattern = declared.replaceAll("\\", "/").replace(/\/$/, "");
  if (
    isAbsolute(pattern) ||
    pattern.includes("**") ||
    pattern
      .split("/")
      .some(
        part =>
          [
            "..",
            ".",
            ".git",
            ".local",
            "secrets",
            "external",
            "node_modules",
            "target",
            "build",
            "var",
            "install",
          ].includes(part) || !part,
      )
  )
    throw new Error("Unsafe root workspace pattern.");
  const pieces = pattern.split("/");
  const firstGlob = pieces.findIndex(part => ["*", "?", "[", "]", "{", "}"].some(char => part.includes(char)));
  const prefix = pieces.slice(0, firstGlob < 0 ? pieces.length : firstGlob).join("/");
  if (prefix) await regularPath(join(root, prefix));
  for await (const manifest of new Bun.Glob(`${pattern}/package.json`).scan({
    cwd: root,
    onlyFiles: true,
    followSymlinks: false,
  })) {
    const path = resolve(root, manifest);
    if (!(await regularPath(path))) throw new Error("Workspace manifest disappeared.");
    const source = await Bun.file(path).json();
    if (typeof source.name !== "string" || !source.name) throw new Error("Workspace identity missing.");
    members.add(dirname(path));
  }
}
async function compareTree(local: string, shared: string): Promise<number> {
  if (!(await regularPath(local)) || !(await regularPath(shared))) throw new Error("Package owner path missing.");
  let files = 0;
  for (const entry of await readdir(local, { withFileTypes: true })) {
    const sourcePath = join(local, entry.name),
      targetPath = join(shared, entry.name);
    if (!(await regularPath(sourcePath))) throw new Error("Installed file disappeared.");
    if (entry.isDirectory()) files += await compareTree(sourcePath, targetPath);
    else if (entry.isFile()) {
      if (!(await regularPath(targetPath))) throw new Error("Root package lacks an installed file.");
      const [source, target] = await Promise.all([
        Bun.file(sourcePath).arrayBuffer(),
        Bun.file(targetPath).arrayBuffer(),
      ]);
      if (
        source.byteLength !== target.byteLength ||
        Bun.CryptoHasher.hash("sha256", source, "hex") !== Bun.CryptoHasher.hash("sha256", target, "hex")
      )
        throw new Error("Root package differs from nested package bytes.");
      files++;
    } else throw new Error("Nonregular installed entry refused.");
  }
  return files;
}
async function qualify(directory: string): Promise<{ packages: number; files: number }> {
  assertWithin(directory);
  if (directory === join(root, "node_modules") || !(await regularPath(directory)))
    throw new Error("Nested owner path invalid.");
  const packages: { name: string; path: string }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (!(await regularPath(path))) throw new Error("Installed entry disappeared.");
    if (entry.name === ".bin") {
      await compareTree(path, join(root, "node_modules", ".bin"));
      continue;
    }
    if (!entry.isDirectory() || entry.name.startsWith(".")) throw new Error("Unknown nested install entry refused.");
    if (entry.name.startsWith("@")) {
      for (const scoped of await readdir(path, { withFileTypes: true })) {
        if (!scoped.isDirectory()) throw new Error("Nonregular scoped package refused.");
        packages.push({ name: `${entry.name}/${scoped.name}`, path: join(path, scoped.name) });
      }
    } else packages.push({ name: entry.name, path });
  }
  let files = 0;
  for (const installed of packages) {
    const canonical = join(root, "node_modules", installed.name);
    if (!(await regularPath(installed.path)) || !(await regularPath(canonical)))
      throw new Error("Root package owner missing.");
    const [local, shared] = await Promise.all([
      Bun.file(join(installed.path, "package.json")).json(),
      Bun.file(join(canonical, "package.json")).json(),
    ]);
    if (local.name !== installed.name || local.name !== shared.name || local.version !== shared.version)
      throw new Error(`Root package does not replace ${installed.name}.`);
    files += await compareTree(installed.path, canonical);
  }
  return { packages: packages.length, files };
}
interface InstallProof {
  member: string;
  eligible: boolean;
  packages?: number;
  files?: number;
  reason?: string;
}
const inventory: InstallProof[] = [];
for (const member of [...members].sort()) {
  const directory = join(member, "node_modules");
  const label = relative(root, member).replaceAll("\\", "/");
  try {
    if (!(await regularPath(directory))) continue;
    inventory.push({ member: label, eligible: true, ...(await qualify(directory)) });
  } catch (error) {
    inventory.push({
      member: label,
      eligible: false,
      reason: error instanceof Error ? error.message : "Qualification failed.",
    });
  }
}
if (planOnly) {
  console.log(
    JSON.stringify(
      {
        action: "plan",
        changed: false,
        members: members.size,
        nestedInstalls: inventory,
        ready: inventory.every(item => item.eligible),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
if (inventory.some(item => !item.eligible))
  throw new Error("Nested install proof failed; inspect --plan before cleanup.");
for (const item of inventory) {
  const directory = join(root, item.member, "node_modules");
  await qualify(directory);
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
  console.log(`Root node_modules now owns ${item.member}`);
}

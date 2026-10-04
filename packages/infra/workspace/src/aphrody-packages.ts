// SPDX-License-Identifier: Apache-2.0
// Packing stays sequential so the archive order and revision provenance are deterministic.
/* eslint-disable no-await-in-loop */
/** Revision-pinned archives of @aphrody/* packages for consumers outside this workspace (IECODE). */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { readTar } from "./canonical-tar.ts";
import { canonicalizePackageArchive, validateArchiveTypes } from "./iecode-packages.ts";
import { infraRoot } from "./runtime.ts";

export interface AphrodyArchive {
  name: string;
  version: string;
  archive: string;
  sha256: string;
}
export interface AphrodyPackagesManifest {
  schemaVersion: 1;
  producer: "aphrody";
  revision: string;
  dirty: boolean;
  packages: AphrodyArchive[];
  /** Workspace dependencies the consumer must supply itself (for example the Yolo runtime SDK). */
  external: string[];
}

type PackageJson = {
  version: string;
  exports?: unknown;
  main?: string;
  module?: string;
  scripts?: Record<string, string>;
};

/** Every file a consumer can import: exports targets (any condition), main and module. */
export function exportTargets(manifest: PackageJson): string[] {
  const targets = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") targets.add(value.replace(/^\.\//, ""));
    else if (value && typeof value === "object")
      for (const child of Object.values(value)) visit(child);
  };
  visit(manifest.exports);
  for (const field of [manifest.main, manifest.module])
    if (field) targets.add(field.replace(/^\.\//, ""));
  return [...targets].filter((target) => !target.includes("*"));
}

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0)
    throw new Error(`git ${args[0]} failed: ${result.stderr.toString().trim()}`);
  return result.stdout.toString().trim();
}

/** Package name to directory for every tracked @aphrody/* workspace member. */
export async function aphrodyPackageDirectories(root: string): Promise<Map<string, string>> {
  const directories = new Map<string, string>();
  for (const manifest of git(root, ["ls-files", "packages/*/*/package.json"]).split("\n")) {
    if (!manifest) continue;
    const { name } = JSON.parse(await readFile(join(root, manifest), "utf8")) as { name?: string };
    if (name?.startsWith("@aphrody/")) directories.set(name, join(root, dirname(manifest)));
  }
  return directories;
}

/** The requested packages plus every @aphrody/* package they depend on at runtime. */
export async function aphrodyClosure(root: string, names: string[]) {
  const directories = await aphrodyPackageDirectories(root);
  const members = new Set<string>();
  const external = new Set<string>();
  const queue = [...names];
  while (queue.length) {
    const name = queue.pop()!;
    if (members.has(name) || external.has(name)) continue;
    const directory = directories.get(name);
    if (!directory) {
      external.add(name);
      continue;
    }
    members.add(name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies,
    }))
      if (dependency.startsWith("@aphrody/")) queue.push(dependency);
  }
  return {
    members: [...members].toSorted().map((name) => ({ name, directory: directories.get(name)! })),
    external: [...external].toSorted(),
  };
}

export async function prepareAphrodyPackages(options: {
  root?: string;
  names: string[];
  destination: string;
  apply?: boolean;
  allowDirty?: boolean;
}): Promise<AphrodyPackagesManifest> {
  const root = resolve(options.root ?? infraRoot());
  const { members, external } = await aphrodyClosure(root, options.names);
  const revision = git(root, ["rev-parse", "HEAD"]);
  const dirty = Boolean(
    git(root, ["status", "--porcelain", "--", ...members.map((member) => member.directory)]),
  );
  if (dirty && !options.allowDirty)
    throw new Error("Packed @aphrody/* sources are dirty; commit them or pass --allow-dirty.");
  const stage = await mkdtemp(join(tmpdir(), "aphrody-packages-"));
  try {
    const packages: AphrodyArchive[] = [];
    for (const { name, directory } of members) {
      const manifest = JSON.parse(
        await readFile(join(directory, "package.json"), "utf8"),
      ) as PackageJson;
      // Packages that export build output are built first; lifecycle scripts never run implicitly.
      if (exportTargets(manifest).some((target) => !existsSync(join(directory, target)))) {
        if (!manifest.scripts?.build)
          throw new Error(`${name} exports files that do not exist and has no build script`);
        const built = Bun.spawnSync(["bun", "run", "build"], {
          cwd: directory,
          stdout: "pipe",
          stderr: "pipe",
        });
        if (built.exitCode !== 0)
          throw new Error(`bun run build failed for ${name}: ${built.stderr}`);
      }
      const out = join(stage, name.slice("@aphrody/".length));
      await mkdir(out, { recursive: true });
      const packed = Bun.spawnSync(
        ["bun", "pm", "pack", "--destination", out, "--quiet", "--ignore-scripts"],
        {
          cwd: directory,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      if (packed.exitCode !== 0)
        throw new Error(`bun pm pack failed for ${name}: ${packed.stderr}`);
      const [file] = await readdir(out);
      if (!file) throw new Error(`bun pm pack produced no archive for ${name}`);
      await validateArchiveTypes(file, out);
      await canonicalizePackageArchive(file, out);
      const entries = new Set(
        readTar(Bun.gunzipSync(await readFile(join(out, file)))).map((entry) =>
          entry.name.replace(/^package\//, ""),
        ),
      );
      const missing = exportTargets(manifest).filter((target) => !entries.has(target));
      if (missing.length)
        throw new Error(`${name} archive lacks exported files: ${missing.join(", ")}`);
      const { version } = manifest;
      const archive = `aphrody-${name.slice("@aphrody/".length)}-${revision}.tgz`;
      await rename(join(out, file), join(stage, archive));
      packages.push({
        name,
        version,
        archive,
        sha256: createHash("sha256")
          .update(await readFile(join(stage, archive)))
          .digest("hex"),
      });
    }
    const manifest: AphrodyPackagesManifest = {
      schemaVersion: 1,
      producer: "aphrody",
      revision,
      dirty,
      packages,
      external,
    };
    if (options.apply) {
      const destination = resolve(options.destination);
      await mkdir(destination, { recursive: true });
      for (const item of packages)
        await rename(join(stage, item.archive), join(destination, item.archive));
      await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    return manifest;
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function runAphrodyPackages(args: string[]): Promise<number> {
  const [action, ...rest] = args;
  if (action !== "prepare") {
    console.log(
      "Usage: aphrody-ops aphrody-packages prepare --package <@aphrody/name>... --destination <dir> [--apply] [--allow-dirty]",
    );
    return action === "--help" || action === "-h" ? 0 : 64;
  }
  const names: string[] = [];
  let destination = "";
  let apply = false;
  let allowDirty = false;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === "--package" || flag === "--destination") {
      const value = rest[++i];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      if (flag === "--package") names.push(value);
      else destination = value;
    } else if (flag === "--apply") apply = true;
    else if (flag === "--allow-dirty") allowDirty = true;
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!names.length || !destination) throw new Error("--package and --destination are required");
  console.log(
    JSON.stringify(
      await prepareAphrodyPackages({ names, destination, apply, allowDirty }),
      null,
      2,
    ),
  );
  return 0;
}

if (import.meta.main) process.exit(await runAphrodyPackages(process.argv.slice(2)));

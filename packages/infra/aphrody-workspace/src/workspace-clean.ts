// SPDX-License-Identifier: Apache-2.0
/** Safe, repository-local cleanup of generated workspace artifacts. */
import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const ROOT_ARTIFACTS = ["target", "dist", ".turbo", ".cache"];
const TEMPORARY_SUFFIXES = [".log", ".pdb", ".ilk", ".dmp", ".tmp", ".tsbuildinfo"];
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "fixtures"]);
type Candidate = { path: string; size: number };

async function directory(path: string): Promise<boolean> {
  return stat(path).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
}

async function temporaryFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await temporaryFiles(root, path)));
    else if (TEMPORARY_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) files.push(path);
  }
  return files;
}

async function hashCandidates(root: string, current = root): Promise<Candidate[]> {
  const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
  const files: Candidate[] = [];
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await hashCandidates(root, path)));
    else {
      const info = await stat(path).catch(() => undefined);
      if (info?.isFile() && info.size > 50 * 1024) files.push({ path, size: info.size });
    }
  }
  return files;
}

async function duplicates(root: string): Promise<string[][]> {
  const bySize = new Map<number, Candidate[]>();
  for (const file of await hashCandidates(root)) {
    const group = bySize.get(file.size) ?? [];
    group.push(file);
    bySize.set(file.size, group);
  }
  const output: string[][] = [];
  for (const sameSize of bySize.values()) {
    if (sameSize.length < 2) continue;
    const byHash = new Map<string, string[]>();
    for (const file of sameSize) {
      const hash = createHash("sha256")
        .update(await readFile(file.path))
        .digest("hex");
      const group = byHash.get(hash) ?? [];
      group.push(relative(root, file.path));
      byHash.set(hash, group);
    }
    for (const group of byHash.values()) if (group.length > 1) output.push(group);
  }
  return output;
}

export async function runWorkspaceClean(args: string[]): Promise<number> {
  let root = process.cwd();
  let dryRun = false;
  let skipHashes = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--dry-run" || arg === "-d") dryRun = true;
    else if (arg === "--skip-hashes" || arg === "-s") skipHashes = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: aphrody-ops workspace-clean [--root <repository>] [--dry-run] [--skip-hashes]",
      );
      return 0;
    } else throw new Error("Unknown argument: " + arg);
  }
  if (!root) throw new Error("--root requires a repository path");
  root = resolve(root);
  const artifactDirectories = (
    await Promise.all(
      ROOT_ARTIFACTS.map(async (name) => ((await directory(join(root, name))) ? name : undefined)),
    )
  ).filter((name): name is string => Boolean(name));
  const temporary = await temporaryFiles(root);
  console.log("workspace cleanup: " + root);
  console.log(
    "generated directories: " +
      artifactDirectories.length +
      "; temporary files: " +
      temporary.length,
  );
  if (dryRun) {
    for (const name of artifactDirectories) console.log("would remove " + name + "/");
    for (const path of temporary) console.log("would remove " + relative(root, path));
  } else {
    await Promise.all(
      artifactDirectories.map((name) => rm(join(root, name), { recursive: true, force: true })),
    );
    await Promise.all(temporary.map((path) => rm(path, { force: true })));
  }
  if (skipHashes) return 0;
  const groups = await duplicates(root);
  console.log("exact duplicate groups (>50 KiB): " + groups.length);
  for (const group of groups) console.log("duplicate: " + group.join(" | "));
  return 0;
}

if (import.meta.main) process.exit(await runWorkspaceClean(process.argv.slice(2)));

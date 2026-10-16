#!/usr/bin/env bun
/**
 * Generate/apply the package-by-package migration from Aphrody to the Bun fork.
 * M3 is always planned first. Apply is explicit because submodule registration
 * changes .gitmodules, the index and checkout state.
 */

import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

type Manifest = {
  name?: string;
  version?: string;
  repository?: string | { type?: string; url?: string };
};

type Candidate = {
  name: string;
  version: string;
  source: string;
  target: string;
  group: "m3" | "packages";
};

const root = resolve(import.meta.dir, "../../../docs/aphrody");
const forkRoot = resolve(process.env.APHRODY_BUN_CHECKOUT ?? join(root, "..", "bun"));
const submoduleRoot = resolve(
  process.env.APHRODY_BUN_SUBMODULE_ROOT ?? join(forkRoot, "packages", "aphrody-migrated"),
);
const apply = Bun.argv.includes("--apply");
const checkOnly = Bun.argv.includes("--check");
const forkOrg = process.env.APHRODY_BUN_GITHUB_ORG ?? "aphrody-labs";

async function command(
  args: string[],
  cwd = root,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

function isIgnorableWorktreeEntry(entry: string): boolean {
  return [
    " M scripts/migration/migrate-packages-to-bun.ts",
    "?? libsccache_rustc_router.rmeta",
    "?? tmp/",
    "?? var/",
    "?? tools/config/cloudflare-auth.json",
    "?? tools/config/host/apps/vps/google-us-egress/windows-catalog/var/",
  ].some(prefix => entry === prefix || entry.startsWith(prefix));
}

async function assertCleanForApply(repo: string, label: string) {
  const state = await command(["status", "--short"], repo);
  if (state.code !== 0) throw new Error(`invalid ${label} checkout: ${repo}`);
  const blocking = state.stdout
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .filter(entry => !(repo === root && isIgnorableWorktreeEntry(entry)));
  if (blocking.length)
    throw new Error(`${label} working tree is dirty:\n${blocking.join("\n")}`);
}

async function reportWorktree(repo: string, label: string) {
  const state = await command(["status", "--short"], repo);
  if (state.code !== 0) throw new Error(`invalid ${label} checkout: ${repo}`);
  if (state.stdout.trim()) console.error(`${label} has pre-existing changes; preserving them`);
}

function repoUrl(manifest: Manifest, name: string): string {
  const repository =
    typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  if (repository?.startsWith("https://github.com/"))
    return repository.replace(/\.git$/, "") + ".git";
  const slug = name.replace(/^@/, "").replace(/\//g, "-");
  return `https://github.com/${forkOrg}/${slug}.git`;
}

async function packageDirs(parent: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) result.push(dir);
    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "target"
      )
        continue;
      await walk(join(dir, entry.name));
    }
  }
  await walk(join(root, parent));
  return result;
}

async function load(parent: string, group: Candidate["group"]): Promise<Candidate[]> {
  const result: Candidate[] = [];
  for (const dir of await packageDirs(parent)) {
    const manifestPath = join(dir, "package.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
      if (!manifest.name) continue;
      result.push({
        name: manifest.name,
        version: manifest.version ?? "0.0.0",
        source: repoUrl(manifest, manifest.name),
        target: join(submoduleRoot, group, manifest.name.replace(/^@/, "").replace(/\//g, "-")),
        group,
      });
    } catch {
      // Non-package directories are intentionally ignored.
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  const packages = [...(await load("m3/packages", "m3")), ...(await load("packages", "packages"))];
  const seen = new Set<string>();
  const duplicates = packages.filter((pkg) => {
    const duplicate = seen.has(pkg.name);
    seen.add(pkg.name);
    return duplicate;
  });
  if (duplicates.length)
    throw new Error(`duplicate package names: ${duplicates.map((pkg) => pkg.name).join(", ")}`);

  if (apply) {
    await assertCleanForApply(root, "Aphrody");
    await reportWorktree(forkRoot, "Bun fork");
  }
  if (checkOnly) {
    const fork = await command(["rev-parse", "--show-toplevel"], forkRoot);
    if (fork.code !== 0) throw new Error(`invalid Bun fork checkout: ${forkRoot}`);
  }

  console.log(
    JSON.stringify(
      {
        apply,
        forkRoot,
        submoduleRoot,
        total: packages.length,
        m3: packages.filter((p) => p.group === "m3").length,
        packages: packages.filter((p) => p.group === "packages").length,
        entries: packages,
      },
      null,
      2,
    ),
  );
  if (!apply) return;

  await mkdir(submoduleRoot, { recursive: true });
  for (const pkg of packages) {
    const target = relative(forkRoot, pkg.target).replaceAll("\\", "/");
    const existing = await stat(pkg.target).catch(() => undefined);
    if (existing) {
      const tracked = await command(["ls-files", "--stage", "--", target], forkRoot);
      if (tracked.stdout.split(/\r?\n/).some(line => line.startsWith("160000 "))) {
        console.error(`already migrated: ${pkg.name}`);
        continue;
      }
      const nestedGit = await command(["-C", pkg.target, "rev-parse", "--is-inside-work-tree"], forkRoot);
      const origin = await command(["-C", pkg.target, "remote", "get-url", "origin"], forkRoot);
      if (nestedGit.stdout.trim() === "true" && origin.stdout.trim().replace(/\/$/, "") === pkg.source) {
        await command(["config", "-f", ".gitmodules", `submodule.${pkg.name}.path`, target], forkRoot);
        await command(["config", "-f", ".gitmodules", `submodule.${pkg.name}.url`, pkg.source], forkRoot);
        const staged = await command(["add", "--", ".gitmodules", target], forkRoot);
        if (staged.code !== 0) throw new Error(`could not stage existing submodule ${pkg.name}`);
        console.error(`adopted existing clone: ${pkg.name}`);
        continue;
      }
      throw new Error(`target already exists and is not a submodule: ${target}`);
    }
    const result = await command(["submodule", "add", "--name", pkg.name, pkg.source, target], forkRoot);
    if (result.code !== 0) throw new Error(`submodule ${pkg.name} failed: ${result.stderr.trim()}`);
    console.error(`migrated ${pkg.group}: ${pkg.name}@${pkg.version}`);
  }
}

await main();

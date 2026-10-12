#!/usr/bin/env bun
/**
 * yolo2bun — inventory and migrate Aphrody-owned packages to the canonical Bun fork.
 *
 * Dry-run is the default. `--apply` only registers reviewed package repositories as
 * git submodules in the selected Bun checkout; it never deletes sources or edits the
 * Aphrody working tree. The workspace root is discovered from this script or
 * `APHRODY_WORKSPACE_ROOT`, and the fork from `APHRODY_BUN_CHECKOUT`.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

type PackageManifest = {
  name?: string;
  version?: string;
  private?: boolean;
  repository?: string | { url?: string };
};

type PackagePlan = {
  name: string;
  version: string;
  source: string;
  sourcePath: string;
  forkPath: string;
  group: "m3" | "packages";
  legacyRefs: number;
  status: "planned" | "already-submodule" | "conflict";
};

const workspaceRoot = resolve(Bun.env.APHRODY_WORKSPACE_ROOT ?? resolve(import.meta.dir, "../.."));
const forkRoot = resolve(Bun.env.APHRODY_BUN_CHECKOUT ?? join(workspaceRoot, "..", "bun"));
const migratedRoot = resolve(
  Bun.env.APHRODY_BUN_SUBMODULE_ROOT ?? join(forkRoot, "packages", "aphrody-migrated"),
);
const apply = Bun.argv.includes("--apply");
const json = Bun.argv.includes("--json");
const forkOrg = Bun.env.APHRODY_BUN_GITHUB_ORG ?? "aphrody-labs";

async function git(args: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", windowsHide: true });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

function sourceUrl(manifest: PackageManifest, name: string): string {
  const repository = typeof manifest.repository === "string" ? manifest.repository : manifest.repository?.url;
  if (repository?.startsWith("https://github.com/")) return repository.replace(/\.git$/, "") + ".git";
  return `https://github.com/${forkOrg}/${name.replace(/^@/, "").replaceAll("/", "-")}.git`;
}

async function packageDirs(parent: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.isFile() && entry.name === "package.json")) result.push(dir);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || ["node_modules", "dist", "target"].includes(entry.name)) continue;
      await walk(join(dir, entry.name));
    }
  }
  await walk(join(workspaceRoot, parent));
  return result;
}

async function countLegacyRefs(dir: string): Promise<number> {
  let count = 0;
  for await (const file of new Bun.Glob("**/*.{ts,tsx,js,json,toml,md}").scan({ cwd: dir, onlyFiles: true })) {
    if (file.includes("node_modules") || file.includes("dist")) continue;
    const text = await readFile(join(dir, file), "utf8").catch(() => "");
    count += (text.match(/\b(?:yolo|YOLO_ROOT|YOLO_HOME|packages\/engine\/yolo)\b/g) ?? []).length;
  }
  return count;
}

async function buildPlan(): Promise<PackagePlan[]> {
  const candidates = [
    ...(await packageDirs("m3/packages")).map((sourcePath) => ({ sourcePath, group: "m3" as const })),
    ...(await packageDirs("packages")).map((sourcePath) => ({ sourcePath, group: "packages" as const })),
  ];
  const plans: PackagePlan[] = [];
  for (const { sourcePath, group } of candidates) {
    const manifest = JSON.parse(await readFile(join(sourcePath, "package.json"), "utf8")) as PackageManifest;
    if (!manifest.name || manifest.private) continue;
    const slug = manifest.name.replace(/^@/, "").replaceAll("/", "-");
    const forkPath = join(migratedRoot, group, slug);
    const tracked = await git(["ls-files", "--stage", "--", relative(forkRoot, forkPath)], forkRoot);
    const status = tracked.out.split(/\r?\n/).some((line) => line.startsWith("160000 "))
      ? "already-submodule"
      : existsSync(forkPath)
        ? "conflict"
        : "planned";
    plans.push({
      name: manifest.name,
      version: manifest.version ?? "0.0.0",
      source: sourceUrl(manifest, manifest.name),
      sourcePath,
      forkPath,
      group,
      legacyRefs: await countLegacyRefs(sourcePath),
      status,
    });
  }
  return plans.sort((a, b) => a.name.localeCompare(b.name));
}

async function applyPlan(plans: PackagePlan[]): Promise<void> {
  const state = await git(["status", "--short"], forkRoot);
  if (state.code !== 0) throw new Error(`Fork Bun invalide: ${forkRoot}`);
  if (state.out.trim()) throw new Error("Fork Bun modifié : --apply refuse de mélanger les travaux existants");
  for (const plan of plans.filter((item) => item.status === "planned")) {
    const target = relative(forkRoot, plan.forkPath).replaceAll("\\", "/");
    const result = await git(["submodule", "add", "--name", plan.name, plan.source, target], forkRoot);
    if (result.code !== 0) throw new Error(`submodule ${plan.name}: ${result.err.trim()}`);
  }
}

const plans = await buildPlan();
const report = {
  schema: "aphrody.yolo2bun/1",
  apply,
  workspaceRoot,
  forkRoot,
  migratedRoot,
  total: plans.length,
  m3: plans.filter((plan) => plan.group === "m3").length,
  legacyPackages: plans.filter((plan) => plan.legacyRefs > 0).length,
  conflicts: plans.filter((plan) => plan.status === "conflict").length,
  entries: plans,
};
if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`yolo2bun: ${report.total} packages, ${report.legacyPackages} with legacy refs, ${report.conflicts} conflicts`);
  for (const plan of plans) console.log(`${plan.status.padEnd(18)} ${plan.group.padEnd(8)} ${plan.name} (${plan.legacyRefs} refs)`);
}
if (apply) await applyPlan(plans);

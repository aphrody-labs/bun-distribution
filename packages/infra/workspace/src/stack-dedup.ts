// SPDX-License-Identifier: Apache-2.0
/**
 * Measures how much of the stack is duplicated or dead, from the three graphs the repository already
 * has: `cargo metadata` (crates and third-party packages), the AST import inventory
 * (`scanImportsExports`, Bun packages) and the tracked files (exact duplicates).
 *
 *   yolo ops stack-dedup [--root <repo>] [--scope ui,web] [--metadata <cargo-metadata.json>] [--json] [--out <file>]
 *
 * Read-only. It never edits a manifest: the report names each cut and what it frees, the cut is made
 * (and verified) by hand or by the owning tool.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { scanImportsExports } from "./imports-exports.ts";

export interface CargoNodeDep {
  pkg: string;
}

export interface CargoMetadataLite {
  packages: {
    id: string;
    name: string;
    version: string;
    manifest_path: string;
    publish?: string[] | null;
    targets: { kind: string[] }[];
  }[];
  workspace_members: string[];
  resolve: { nodes: { id: string; deps: CargoNodeDep[] }[] } | null;
}

export interface CrateRow {
  name: string;
  path: string;
  kinds: string[];
  /** `false` when the manifest says `publish = false`. */
  publishable: boolean;
  /** Workspace crates that depend on it directly. */
  dependents: string[];
  /** Third-party packages that disappear if this crate and everything that depends on it were removed. */
  freesPackages: number;
}

export interface OlderVersion {
  name: string;
  version: string;
  latest: string;
  /** Workspace crates that depend on this exact older version directly. */
  pulledBy: string[];
}

export interface DuplicateFiles {
  bytes: number;
  copies: string[];
}

export interface JsFindings {
  /** Declared, never imported (types, peers and optional dependencies excluded). */
  unusedDependencies: { package: string; path: string; dependencies: string[] }[];
  versionSpecDifferences: Record<string, Record<string, string>>;
  /** Packages that nothing in the workspace imports or declares. */
  withoutDependents: { package: string; path: string; files: number }[];
}

export interface StackReport {
  schema: "aphrody-stack-dedup/1";
  root: string;
  scope: string[];
  rust: {
    workspaceCrates: number;
    thirdPartyPackages: number;
    namesWithSeveralVersions: number;
    crates: CrateRow[];
    olderVersionsPulledDirectly: OlderVersion[];
    /** Library crates nothing in the workspace depends on. */
    withoutDependents: string[];
  };
  js: JsFindings;
  assets: { groups: number; wastedBytes: number; duplicates: DuplicateFiles[] };
}

const parseVersion = (version: string) => {
  const [core = "", pre] = version.split("+")[0]!.split("-", 2);
  return {
    nums: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    pre: pre ?? null,
  };
};

/** Compares dotted versions numerically; a pre-release or build suffix sorts below the release. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < Math.max(left.nums.length, right.nums.length); index += 1) {
    const diff = (left.nums[index] ?? 0) - (right.nums[index] ?? 0);
    if (diff !== 0) return diff;
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre < right.pre ? -1 : 1;
}

function graph(meta: CargoMetadataLite) {
  const packages = new Map(meta.packages.map((entry) => [entry.id, entry]));
  const edges = new Map<string, string[]>();
  for (const node of meta.resolve?.nodes ?? [])
    edges.set(
      node.id,
      node.deps.map((dep) => dep.pkg),
    );
  return { packages, edges, workspace: new Set(meta.workspace_members) };
}

function reach(starts: Iterable<string>, edges: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of edges.get(id) ?? []) stack.push(next);
  }
  return seen;
}

/** One row per workspace crate: who depends on it and how many third-party packages only it keeps alive. */
export function crateTable(meta: CargoMetadataLite, root: string): CrateRow[] {
  const { packages, edges, workspace } = graph(meta);
  const dependents = new Map<string, Set<string>>();
  for (const id of workspace) {
    for (const next of edges.get(id) ?? []) {
      if (!workspace.has(next)) continue;
      (dependents.get(next) ?? dependents.set(next, new Set()).get(next)!).add(id);
    }
  }
  const everything = reach(workspace, edges);
  const rows: CrateRow[] = [];
  for (const id of workspace) {
    const entry = packages.get(id);
    if (!entry) continue;
    const closure = new Set<string>([id]);
    const stack = [id];
    while (stack.length > 0) {
      for (const dependent of dependents.get(stack.pop()!) ?? []) {
        if (!closure.has(dependent)) {
          closure.add(dependent);
          stack.push(dependent);
        }
      }
    }
    const remaining = [...workspace].filter((other) => !closure.has(other));
    const kept = reach(remaining, edges);
    let frees = 0;
    for (const other of everything) if (!workspace.has(other) && !kept.has(other)) frees += 1;
    rows.push({
      name: entry.name,
      path: relative(root, dirname(entry.manifest_path)).replaceAll("\\", "/"),
      kinds: [...new Set(entry.targets.flatMap((target) => target.kind))].toSorted(),
      publishable:
        entry.publish === undefined || entry.publish === null || entry.publish.length > 0,
      dependents: [...(dependents.get(id) ?? [])]
        .map((dependent) => packages.get(dependent)?.name ?? dependent)
        .toSorted(),
      freesPackages: frees,
    });
  }
  return rows.toSorted((a, b) => b.freesPackages - a.freesPackages || a.name.localeCompare(b.name));
}

/** Older versions of a package that one of our own crates asks for directly: fixable by bumping our manifest. */
export function olderVersionsPulledDirectly(meta: CargoMetadataLite): OlderVersion[] {
  const { packages, edges, workspace } = graph(meta);
  const byName = new Map<string, string[]>();
  for (const id of edges.keys()) {
    const entry = packages.get(id);
    if (!entry || workspace.has(id)) continue;
    (byName.get(entry.name) ?? byName.set(entry.name, []).get(entry.name)!).push(id);
  }
  const out: OlderVersion[] = [];
  for (const [name, ids] of byName) {
    if (ids.length < 2) continue;
    const latest = ids
      .map((id) => packages.get(id)!.version)
      .reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));
    for (const id of ids) {
      const version = packages.get(id)!.version;
      if (version === latest) continue;
      const pulledBy = [...workspace]
        .filter((member) => (edges.get(member) ?? []).includes(id))
        .map((member) => packages.get(member)!.name)
        .toSorted();
      if (pulledBy.length > 0) out.push({ name, version, latest, pulledBy });
    }
  }
  return out.toSorted(
    (a, b) => a.name.localeCompare(b.name) || compareVersions(a.version, b.version),
  );
}

/** Groups files with the same content; `minBytes` skips the small ones. */
export function groupDuplicates(
  files: { path: string; size: number; hash: string }[],
  minBytes: number,
): DuplicateFiles[] {
  const groups = new Map<string, { size: number; paths: string[] }>();
  for (const file of files) {
    if (file.size < minBytes) continue;
    const key = `${file.hash}:${file.size}`;
    const group = groups.get(key) ?? { size: file.size, paths: [] };
    group.paths.push(file.path);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.paths.length > 1)
    .map((group) => ({
      bytes: group.size * (group.paths.length - 1),
      copies: group.paths.toSorted(),
    }))
    .toSorted((a, b) => b.bytes - a.bytes);
}

const SKIPPED_TOP = new Set(["docs", "upstream"]);

/** Tracked files (git ls-files) outside `docs/` and `upstream/`, hashed. */
export async function trackedFiles(
  root: string,
  minBytes: number,
): Promise<{ path: string; size: number; hash: string }[]> {
  const child = Bun.spawn(["git", "-C", root, "ls-files", "-z"], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  const listing = await new Response(child.stdout).text();
  await child.exited;
  const out: { path: string; size: number; hash: string }[] = [];
  for (const path of listing.split("\0")) {
    if (!path || SKIPPED_TOP.has(path.split("/")[0]!)) continue;
    const full = join(root, path);
    let size: number;
    try {
      const stats = statSync(full);
      if (!stats.isFile()) continue;
      size = stats.size;
    } catch {
      continue;
    }
    if (size < minBytes) continue;
    out.push({ path, size, hash: createHash("sha1").update(readFileSync(full)).digest("hex") });
  }
  return out;
}

interface ImportsSummary {
  packages: {
    path: string;
    name: string;
    sourceFiles: number;
    imports: { packageName: string | null }[];
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    peerDependencies: Record<string, string>;
    sourceUnmatchedDependencies: string[];
  }[];
  versionSpecDifferences: Record<string, Record<string, string>>;
}

/** Declared-but-unimported dependencies, version drift and packages nobody uses, from the AST inventory. */
export function jsFindings(summary: ImportsSummary): JsFindings {
  const names = new Set(summary.packages.map((entry) => entry.name));
  const used = new Set<string>();
  for (const entry of summary.packages) {
    for (const reference of entry.imports)
      if (reference.packageName && reference.packageName !== entry.name)
        used.add(reference.packageName);
    for (const key of [
      ...Object.keys(entry.dependencies),
      ...Object.keys(entry.devDependencies),
      ...Object.keys(entry.peerDependencies),
    ]) {
      if (names.has(key) && key !== entry.name) used.add(key);
    }
  }
  const unused = summary.packages
    .map((entry) => ({
      package: entry.name,
      path: entry.path,
      dependencies: entry.sourceUnmatchedDependencies.filter(
        (dependency) =>
          !dependency.startsWith("@types/") && !(dependency in entry.peerDependencies),
      ),
    }))
    .filter((entry) => entry.dependencies.length > 0)
    .toSorted((a, b) => b.dependencies.length - a.dependencies.length);
  return {
    unusedDependencies: unused,
    versionSpecDifferences: summary.versionSpecDifferences,
    withoutDependents: summary.packages
      .filter((entry) => !used.has(entry.name) && entry.sourceFiles > 0)
      .map((entry) => ({ package: entry.name, path: entry.path, files: entry.sourceFiles }))
      .toSorted((a, b) => a.path.localeCompare(b.path)),
  };
}

/** Library crates (no binary, no cdylib) that nothing in the workspace depends on. */
export function librariesWithoutDependents(rows: CrateRow[]): string[] {
  return rows
    .filter(
      (row) =>
        row.dependents.length === 0 && !row.kinds.includes("bin") && !row.kinds.includes("cdylib"),
    )
    .map((row) => row.name)
    .toSorted();
}

function inScope(path: string, scope: string[]): boolean {
  if (scope.length === 0) return true;
  return scope.some(
    (area) =>
      path.startsWith(`crates/${area}/`) ||
      path.startsWith(`packages/${area}/`) ||
      path.startsWith(`apps/${area}/`) ||
      path.startsWith(`${area}/`),
  );
}

export async function buildReport(options: {
  root: string;
  scope: string[];
  metadata: CargoMetadataLite;
  imports: ImportsSummary;
  files: { path: string; size: number; hash: string }[];
  minBytes: number;
}): Promise<StackReport> {
  const { root, scope, metadata, imports, files, minBytes } = options;
  const all = crateTable(metadata, root);
  const crates = all.filter((row) => inScope(row.path, scope));
  const everything = reach(metadata.workspace_members, graph(metadata).edges);
  const names = new Map<string, number>();
  const { packages } = graph(metadata);
  for (const id of everything) {
    const entry = packages.get(id);
    if (entry && !metadata.workspace_members.includes(id))
      names.set(entry.name, (names.get(entry.name) ?? 0) + 1);
  }
  const js = jsFindings(imports);
  const duplicates = groupDuplicates(files, minBytes).filter((group) =>
    group.copies.some((copy) => inScope(copy, scope)),
  );
  const pathOf = new Map(all.map((row) => [row.name, row.path]));
  return {
    schema: "aphrody-stack-dedup/1",
    root,
    scope,
    rust: {
      workspaceCrates: all.length,
      thirdPartyPackages: [...everything].filter((id) => !metadata.workspace_members.includes(id))
        .length,
      namesWithSeveralVersions: [...names.values()].filter((count) => count > 1).length,
      crates,
      olderVersionsPulledDirectly: olderVersionsPulledDirectly(metadata).filter((entry) =>
        entry.pulledBy.some((crate) => inScope(pathOf.get(crate) ?? "", scope)),
      ),
      withoutDependents: librariesWithoutDependents(crates),
    },
    js: {
      unusedDependencies: js.unusedDependencies.filter((entry) => inScope(entry.path, scope)),
      versionSpecDifferences: js.versionSpecDifferences,
      withoutDependents: js.withoutDependents.filter((entry) => inScope(entry.path, scope)),
    },
    assets: {
      groups: duplicates.length,
      wastedBytes: duplicates.reduce((total, group) => total + group.bytes, 0),
      duplicates,
    },
  };
}

export function renderReport(report: StackReport, top = 15): string {
  const lines: string[] = [];
  const scope = report.scope.length > 0 ? report.scope.join(",") : "all";
  lines.push(
    `stack-dedup (${scope}): ${report.rust.workspaceCrates} workspace crates, ${report.rust.thirdPartyPackages} third-party packages, ${report.rust.namesWithSeveralVersions} names built in several versions`,
  );
  lines.push(
    "",
    "heaviest crates (third-party packages freed if the crate and its dependents went away):",
  );
  for (const row of report.rust.crates.slice(0, top)) {
    lines.push(
      `  ${String(row.freesPackages).padStart(4)}  ${row.name.padEnd(30)} ${row.path} (${row.dependents.length} dependents${row.publishable ? "" : ", publish=false"})`,
    );
  }
  lines.push(
    "",
    `library crates nothing depends on: ${report.rust.withoutDependents.join(", ") || "none"}`,
  );
  lines.push(
    "",
    `older versions that our crates request directly (${report.rust.olderVersionsPulledDirectly.length}):`,
  );
  for (const entry of report.rust.olderVersionsPulledDirectly)
    lines.push(
      `  ${entry.name} ${entry.version} (latest ${entry.latest}) <- ${entry.pulledBy.join(", ")}`,
    );
  lines.push(
    "",
    `Bun packages: ${report.js.unusedDependencies.length} with declared dependencies that no source imports`,
  );
  for (const entry of report.js.unusedDependencies)
    lines.push(`  ${entry.package}: ${entry.dependencies.join(", ")}`);
  lines.push(
    "",
    `Bun packages nothing depends on: ${report.js.withoutDependents.map((entry) => entry.package).join(", ") || "none"}`,
  );
  lines.push(
    "",
    `tracked exact duplicates: ${report.assets.groups} groups, ${(report.assets.wastedBytes / 1e6).toFixed(1)} MB`,
  );
  for (const group of report.assets.duplicates.slice(0, top))
    lines.push(`  ${(group.bytes / 1e6).toFixed(2)} MB  ${group.copies.join(" | ")}`);
  return lines.join("\n");
}

async function cargoMetadata(root: string): Promise<CargoMetadataLite> {
  const child = Bun.spawn(
    [
      "cargo",
      "metadata",
      "--offline",
      "--format-version",
      "1",
      "--filter-platform",
      "x86_64-unknown-linux-gnu",
    ],
    { windowsHide: true, cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`cargo metadata failed: ${stderr.trim().split("\n").at(-1)}`);
  return JSON.parse(stdout) as CargoMetadataLite;
}

export async function runStackDedup(args: string[]): Promise<number> {
  let root = process.cwd();
  let scope: string[] = [];
  let metadataPath: string | undefined;
  let out: string | undefined;
  let json = false;
  let minBytes = 2000;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") root = args[(index += 1)] ?? "";
    else if (arg === "--scope") scope = (args[(index += 1)] ?? "").split(",").filter(Boolean);
    else if (arg === "--metadata") metadataPath = args[(index += 1)];
    else if (arg === "--out") out = args[(index += 1)];
    else if (arg === "--min-bytes") minBytes = Number(args[(index += 1)]);
    else if (arg === "--json") json = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops stack-dedup [--root <repo>] [--scope ui,web] [--metadata <cargo-metadata.json>] [--min-bytes <n>] [--json] [--out <file>]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root || !Number.isFinite(minBytes)) throw new Error("invalid --root or --min-bytes");
  root = resolve(root);
  const metadata =
    metadataPath && existsSync(metadataPath)
      ? (JSON.parse(readFileSync(metadataPath, "utf8")) as CargoMetadataLite)
      : await cargoMetadata(root);
  const [imports, files] = await Promise.all([
    scanImportsExports(root),
    trackedFiles(root, minBytes),
  ]);
  const report = await buildReport({
    root,
    scope,
    metadata,
    imports: imports as unknown as ImportsSummary,
    files,
    minBytes,
  });
  const text = json ? JSON.stringify(report, null, 2) : renderReport(report);
  if (out) {
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(resolve(out), `${text}\n`);
  }
  console.log(text);
  return 0;
}

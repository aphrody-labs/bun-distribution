// SPDX-License-Identifier: Apache-2.0
// Workspace discovery shared by the root scripts: the packages and apps of the root manifest globs,
// their dependency edges and a topological order.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const REPO = resolve(dirname(import.meta.path), "../..");

export interface WorkspacePackage {
  name: string;
  /** Path relative to the repository, `/`-separated. */
  rel: string;
  dir: string;
  manifest: {
    name: string;
    version?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    exports?: unknown;
    main?: string;
    module?: string;
  };
}

/** Workspace members: the root `workspaces` globs minus its `!` exclusions. */
export function workspacePackages(root: string = REPO): WorkspacePackage[] {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    workspaces?: { packages?: string[] } | string[];
  };
  const globs = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : (manifest.workspaces?.packages ?? []);
  const excluded = new Set(globs.filter((g) => g.startsWith("!")).map((g) => g.slice(1)));
  const result: WorkspacePackage[] = [];
  for (const glob of globs.filter((g) => !g.startsWith("!"))) {
    const base = glob.replace(/\/\*$/, "");
    if (!existsSync(join(root, base))) continue;
    for (const entry of readdirSync(join(root, base)).toSorted()) {
      const rel = `${base}/${entry}`;
      const file = join(root, rel, "package.json");
      if (excluded.has(rel) || !existsSync(file)) continue;
      const parsed = JSON.parse(readFileSync(file, "utf8")) as WorkspacePackage["manifest"];
      result.push({ name: parsed.name, rel, dir: join(root, rel), manifest: parsed });
    }
  }
  return result;
}

/** Workspace dependencies of `pkg` (all dependency kinds), by name. */
export function workspaceDeps(pkg: WorkspacePackage, known: ReadonlySet<string>): string[] {
  const { dependencies, devDependencies, peerDependencies } = pkg.manifest;
  return [
    ...new Set([
      ...Object.keys(dependencies ?? {}),
      ...Object.keys(devDependencies ?? {}),
      ...Object.keys(peerDependencies ?? {}),
    ]),
  ]
    .filter((name) => known.has(name) && name !== pkg.name)
    .toSorted();
}

/** Packages grouped in dependency levels: every package comes after the packages it depends on. */
export function levels(packages: readonly WorkspacePackage[]): WorkspacePackage[][] {
  const known = new Set(packages.map((p) => p.name));
  const remaining = new Map(packages.map((p) => [p.name, p]));
  const done = new Set<string>();
  const out: WorkspacePackage[][] = [];
  while (remaining.size > 0) {
    const level = [...remaining.values()].filter((p) =>
      workspaceDeps(p, known).every((d) => done.has(d) || !remaining.has(d)),
    );
    // A cycle among the remaining packages: emit them together rather than looping forever.
    const batch = level.length > 0 ? level : [...remaining.values()];
    for (const p of batch) remaining.delete(p.name);
    for (const p of batch) done.add(p.name);
    out.push(batch);
  }
  return out;
}

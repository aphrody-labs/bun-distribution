// SPDX-License-Identifier: Apache-2.0
/**
 * Prove that the sibling category repositories form a DAG in the documented layer order
 * (docs/REPO-LAYERING.md).
 *
 * For every sibling repository with a root `Cargo.toml`, `cargo metadata --no-deps` lists the
 * dependencies that workspace members really use; a dependency whose `path` resolves into a
 * sibling checkout is a repository edge. `[patch.*]` path entries of the root manifest are edges
 * too (cargo metadata does not report them, but they are resolved on every build). Workspace
 * dependencies that point into a sibling but that no member uses are reported as "declared only"
 * and fail the check as well: they still force the sibling checkout and hide intent.
 *
 * Usage: bun scripts/repo-layering.ts [--root <workspace>] [--json]
 * Exit status: 0 when the graph is acyclic and every edge points to a strictly lower layer.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/** Layer of each repository; an edge must go from a higher to a strictly lower layer. */
export const LAYERS: Readonly<Record<string, number>> = {
  "aphrody-contracts": 0,
  "aphrody-native": 0,
  "aphrody-shell": 1,
  "aphrody-compat": 1,
  "aphrody-os": 2,
  "aphrody-web": 3,
  "aphrody-koharu": 3,
  "aphrody-ui": 4,
  "aphrody-infra": 4,
  "aphrody-ai": 5,
};

export type EdgeKind = "dependency" | "patch" | "declared-only";

export interface Edge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** `member -> dependency` (or the patched crate) that creates the edge. */
  evidence: string;
}

interface CargoDependency {
  name: string;
  path?: string;
  kind?: string | null;
}

interface CargoPackage {
  name: string;
  manifest_path: string;
  dependencies: CargoDependency[];
}

/**
 * `cargo metadata --no-deps --offline` of the workspace rooted at `dir` (workspace members only).
 * Shared with `ecosystem.ts`, which reads more package fields than the layering check does.
 */
export function loadCargoMetadata<P = CargoPackage>(dir: string): { packages: P[] } | { error: string } {
  const result = spawnSync(
    "cargo",
    ["metadata", "--format-version", "1", "--no-deps", "--offline"],
    { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, env: process.env },
  );
  if (result.status !== 0) {
    return { error: `cargo metadata failed: ${(result.stderr ?? "").trim().split("\n").slice(-3).join(" | ")}` };
  }
  return JSON.parse(result.stdout) as { packages: P[] };
}

/** Map an absolute path to the sibling repository that contains it, if any. */
export function repoOf(root: string, path: string, repos: readonly string[]): string | undefined {
  const rel = relative(root, resolve(path));
  if (rel.startsWith("..")) return undefined;
  const head = rel.split(sep)[0]?.split("/")[0];
  return head !== undefined && repos.includes(head) ? head : undefined;
}

/** Path entries of a TOML section family (`[patch.crates-io]`, `[workspace.dependencies]`). */
export function sectionPaths(manifest: string, section: RegExp): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  let inside = false;
  for (const raw of manifest.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line.startsWith("[")) {
      inside = section.test(line);
      continue;
    }
    if (!inside) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*=\s*\{.*\bpath\s*=\s*"([^"]+)"/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      out.push({ name: match[1], path: match[2] });
    }
  }
  return out;
}

export function collectEdges(root: string): { repos: string[]; edges: Edge[]; errors: string[] } {
  const repos = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "Cargo.toml")))
    .map((entry) => entry.name)
    .filter((name) => name in LAYERS)
    .sort();
  const edges: Edge[] = [];
  const errors: string[] = [];
  for (const repo of repos) {
    const dir = join(root, repo);
    const metadata = loadCargoMetadata<CargoPackage>(dir);
    if ("error" in metadata) {
      errors.push(`${repo}: ${metadata.error}`);
      continue;
    }
    const used = new Set<string>();
    for (const pkg of metadata.packages) {
      for (const dep of pkg.dependencies) {
        if (dep.path === undefined) continue;
        const target = repoOf(root, dep.path, repos);
        if (target === undefined || target === repo) continue;
        used.add(dep.name);
        edges.push({ from: repo, to: target, kind: "dependency", evidence: `${pkg.name} -> ${dep.name}` });
      }
    }
    const manifest = readFileSync(join(dir, "Cargo.toml"), "utf8");
    for (const entry of sectionPaths(manifest, /^\[patch\./)) {
      const target = repoOf(root, join(dir, entry.path), repos);
      if (target !== undefined && target !== repo) {
        edges.push({ from: repo, to: target, kind: "patch", evidence: `[patch] ${entry.name}` });
      }
    }
    for (const entry of sectionPaths(manifest, /^\[workspace\.dependencies\]$/)) {
      const target = repoOf(root, join(dir, entry.path), repos);
      if (target !== undefined && target !== repo && !used.has(entry.name)) {
        edges.push({ from: repo, to: target, kind: "declared-only", evidence: `[workspace.dependencies] ${entry.name}` });
      }
    }
  }
  return { repos, edges, errors };
}

/** Strongly connected components with more than one repository (Tarjan). */
export function cycles(repos: readonly string[], edges: readonly Edge[]): string[][] {
  const next = new Map<string, Set<string>>(repos.map((repo) => [repo, new Set<string>()]));
  for (const edge of edges) next.get(edge.from)?.add(edge.to);
  let index = 0;
  const order = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  const visit = (node: string): void => {
    order.set(node, index);
    low.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);
    for (const to of next.get(node) ?? []) {
      if (!order.has(to)) {
        visit(to);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(to) ?? 0));
      } else if (onStack.has(to)) {
        low.set(node, Math.min(low.get(node) ?? 0, order.get(to) ?? 0));
      }
    }
    if (low.get(node) === order.get(node)) {
      const component: string[] = [];
      let member: string | undefined;
      do {
        member = stack.pop();
        if (member === undefined) break;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1 || (next.get(node)?.has(node) ?? false)) found.push(component.sort());
    }
  };
  for (const repo of repos) if (!order.has(repo)) visit(repo);
  return found;
}

/** Edges that do not go to a strictly lower layer. */
export function violations(edges: readonly Edge[]): Edge[] {
  return edges.filter(
    (edge) => edge.kind === "declared-only" || (LAYERS[edge.from] ?? 0) <= (LAYERS[edge.to] ?? 0),
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const root = resolve(rootIndex >= 0 && args[rootIndex + 1] ? args[rootIndex + 1] : join(import.meta.dir, "..", ".."));
  const { repos, edges, errors } = collectEdges(root);
  const loops = cycles(repos, edges.filter((edge) => edge.kind !== "declared-only"));
  const bad = violations(edges);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ root, repos, edges, cycles: loops, violations: bad, errors }, null, 2));
  } else {
    const summary = new Map<string, Edge[]>();
    for (const edge of edges) {
      const key = `${edge.from} -> ${edge.to}`;
      summary.set(key, [...(summary.get(key) ?? []), edge]);
    }
    for (const [key, list] of [...summary].sort()) {
      console.log(`${key}  (${list.length}: ${list.slice(0, 3).map((edge) => edge.evidence).join("; ")}${list.length > 3 ? "; ..." : ""})`);
    }
    for (const error of errors) console.error(`error: ${error}`);
    for (const loop of loops) console.error(`cycle: ${loop.join(" <-> ")}`);
    for (const edge of bad) console.error(`layer violation (${edge.kind}): ${edge.from} -> ${edge.to} via ${edge.evidence}`);
    console.log(`repos=${repos.length} edges=${edges.length} cycles=${loops.length} violations=${bad.length} errors=${errors.length}`);
  }
  process.exit(loops.length === 0 && bad.length === 0 && errors.length === 0 ? 0 : 1);
}

// SPDX-License-Identifier: Apache-2.0
/** Validate the active Cargo workspace dependency graph, using crate paths as nodes. */
import { dirname, relative, resolve, sep } from "node:path";

interface CargoDependency {
  name: string;
  path?: string;
  /** `null` (normal), `"build"` or `"dev"`. */
  kind?: string | null;
}

interface CargoPackage {
  name: string;
  manifest_path: string;
  dependencies: CargoDependency[];
}

export interface Edge {
  from: string;
  to: string;
  kind: "dependency";
  evidence: string;
}

export interface WorkspaceGraph {
  nodes: string[];
  edges: Edge[];
  externalPaths: string[];
  errors: string[];
}

/** Read metadata only. This does not build or modify the Cargo workspace. */
export function loadCargoMetadata<P = CargoPackage>(
  dir: string,
): { packages: P[]; workspace_members: string[] } | { error: string } {
  const result = Bun.spawnSync(
    ["cargo", "metadata", "--format-version", "1", "--no-deps", "--offline"],
    {
      windowsHide: true,
      cwd: dir,
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (result.exitCode !== 0) {
    return {
      error: `cargo metadata failed: ${result.stderr.toString().trim().split("\n").slice(-3).join(" | ")}`,
    };
  }
  return JSON.parse(result.stdout.toString()) as {
    packages: P[];
    workspace_members: string[];
  };
}

/** A path is inside root only when it resolves to root or a descendant. */
export function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

/** Construct edges between workspace crates, keeping upstream path dependencies separate. */
export function graphFromMetadata(
  root: string,
  metadata: {
    packages: (CargoPackage & { id?: string })[];
    workspace_members: string[];
  },
): WorkspaceGraph {
  root = resolve(root);
  const errors: string[] = [];
  const members = new Set(metadata.workspace_members);
  const byDirectory = new Map<string, string>();
  const packages = metadata.packages.filter((pkg) =>
    pkg.id === undefined
      ? inside(root, pkg.manifest_path)
      : members.has(pkg.id),
  );
  for (const pkg of packages) {
    if (!inside(root, pkg.manifest_path)) {
      errors.push(`workspace member outside repository: ${pkg.name}`);
      continue;
    }
    const dir = resolve(dirname(pkg.manifest_path));
    const node = relative(root, dir).split(sep).join("/");
    if (byDirectory.has(dir))
      errors.push(`duplicate workspace directory: ${node}`);
    byDirectory.set(dir, node);
  }
  const edges: Edge[] = [];
  const externalPaths = new Set<string>();
  for (const pkg of packages) {
    const from = byDirectory.get(resolve(dirname(pkg.manifest_path)));
    if (!from) continue;
    for (const dep of pkg.dependencies) {
      // Cargo allows dev-dependency cycles (upstream Tauri tests its crates through `tauri`).
      if (!dep.path || dep.kind === "dev") continue;
      const directory = resolve(dep.path);
      const to = byDirectory.get(directory);
      if (to && to !== from) {
        edges.push({
          from,
          to,
          kind: "dependency",
          evidence: `${pkg.name} -> ${dep.name}`,
        });
      } else if (inside(root, directory) && !to) {
        errors.push(
          `workspace path dependency not indexed: ${from} -> ${dep.name} (${directory})`,
        );
      } else if (!inside(root, directory)) {
        externalPaths.add(relative(root, directory).split(sep).join("/"));
      }
    }
  }
  return {
    nodes: [...byDirectory.values()].toSorted(),
    edges: edges.toSorted(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to) ||
        a.evidence.localeCompare(b.evidence),
    ),
    externalPaths: [...externalPaths].toSorted(),
    errors: errors.toSorted(),
  };
}

export function collectEdges(root: string): WorkspaceGraph {
  const metadata = loadCargoMetadata<CargoPackage & { id: string }>(root);
  if ("error" in metadata) {
    return {
      nodes: [],
      edges: [],
      externalPaths: [],
      errors: [metadata.error],
    };
  }
  return graphFromMetadata(root, metadata);
}

/** Strongly connected components with more than one crate (Tarjan). */
export function cycles(
  nodes: readonly string[],
  edges: readonly Edge[],
): string[][] {
  const next = new Map<string, Set<string>>(
    nodes.map((node) => [node, new Set<string>()]),
  );
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
      if (component.length > 1 || (next.get(node)?.has(node) ?? false))
        found.push(component.toSorted());
    }
  };
  for (const node of nodes) if (!order.has(node)) visit(node);
  return found;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const rootArg = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
  const root = resolve(rootArg || resolve(import.meta.dir, "..", "..", ".."));
  const graph = collectEdges(root);
  const loops = cycles(graph.nodes, graph.edges);
  const result = { root, ...graph, cycles: loops };
  if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
  else {
    for (const error of graph.errors) console.error(`error: ${error}`);
    for (const loop of loops) console.error(`cycle: ${loop.join(" <-> ")}`);
    console.log(
      `crates=${graph.nodes.length} edges=${graph.edges.length} externalPaths=${graph.externalPaths.length} cycles=${loops.length} errors=${graph.errors.length}`,
    );
  }
  process.exit(loops.length === 0 && graph.errors.length === 0 ? 0 : 1);
}

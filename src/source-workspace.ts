import { existsSync } from "node:fs";
import { readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";
import { packageRoot, readLock, type Config } from "./distribution.ts";

type Component = {
  id: string;
  checkout: string;
  repository: string;
  owner: string;
  integration: "root" | "pinned-source" | "merged-history" | "absorbed-source";
  integratedRevision?: string;
};

async function git(checkout: string, args: string[]) {
  return runProcess(["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=", ...args], checkout, {
    timeoutMs: 15_000,
    maxOutputBytes: 4 * 1024 * 1024,
    env: {
      ...Bun.env,
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0",
      GIT_NO_LAZY_FETCH: "1",
    },
  });
}

async function inventory() {
  const catalog = (await Bun.file(join(packageRoot, "infra/source-workspace.json")).json()) as {
    schemaVersion: number;
    sourceRoot: string;
    integrationScope: string[];
    excludedRepositories: string[];
    components: Component[];
  };
  if (
    catalog.schemaVersion !== 1 ||
    !Array.isArray(catalog.components) ||
    !Array.isArray(catalog.integrationScope) ||
    !Array.isArray(catalog.excludedRepositories) ||
    [...catalog.integrationScope, ...catalog.excludedRepositories].some(id => !/^[\w.-]+$/.test(id))
  )
    throw new Error("Invalid source workspace");
  const ids = new Set<string>();
  for (const component of catalog.components) {
    if (
      !/^[\w.-]+$/.test(component.id) ||
      ids.has(component.id) ||
      !/^[\w.-]+\/[\w.-]+$/.test(component.repository) ||
      !component.checkout ||
      isAbsolute(component.checkout) ||
      !["root", "pinned-source", "merged-history", "absorbed-source"].includes(component.integration) ||
      (["merged-history", "absorbed-source"].includes(component.integration) &&
        !/^[a-f0-9]{40}$/.test(component.integratedRevision ?? ""))
    )
      throw new Error("Invalid source workspace component");
    ids.add(component.id);
  }
  return catalog;
}

/** Explicit catalog locations, resolved from this checkout; no source tree is copied or rewritten. */
export async function sourceWorkspaceLocations(config: Config = {}) {
  const catalog = await inventory();
  return {
    ...Object.fromEntries(
      catalog.components
        .filter(component => component.integration === "pinned-source")
        .map(component => [component.id, resolve(packageRoot, component.checkout)]),
    ),
    ...config.checkouts,
  };
}

/** Inspect committed source ownership separately from local modifications and product qualification. */
export async function inspectSourceWorkspace(config: Config = {}) {
  const catalog = await inventory();
  const lock = await readLock();
  const bun = (await Bun.file(join(packageRoot, "package.json")).json()) as { workspaces: string[] };
  const cargo = Bun.TOML.parse(await Bun.file(join(packageRoot, "Cargo.toml")).text()) as {
    workspace: { members: string[] };
  };
  const nestedBunMembers = bun.workspaces.filter(member => !/^(?:packages|apps)\/[^/*]+$/.test(member));
  const nestedCargoMembers = cargo.workspace.members.filter(member => !/^(?:crates|apps)\/[^/*]+$/.test(member));
  const common = await git(packageRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common.code !== 0) throw new Error("Cannot inspect the distribution Git owner");
  const components = [];
  for (const component of catalog.components) {
    const checkout = resolve(config.checkouts?.[component.id] ?? resolve(packageRoot, component.checkout));
    const source = lock.repositories.find(item => item.id === component.id && !item.parent);
    const present = existsSync(join(checkout, ".git"));
    const [head, status] = present
      ? await Promise.all([
          git(checkout, ["rev-parse", "HEAD"]),
          git(checkout, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
        ])
      : [];
    const inspected = head?.code === 0 && status?.code === 0;
    const revision = inspected ? head.stdout.trim() : null;
    const clean = inspected ? status.stdout.length === 0 : null;
    const imported = component.integration === "merged-history" || component.integration === "absorbed-source";
    const inherited = imported
      ? (await git(packageRoot, ["merge-base", "--is-ancestor", component.integratedRevision!, "HEAD"])).code === 0
      : null;
    const pinned = source?.repository === component.repository;
    components.push({
      ...component,
      path: checkout,
      physicalPath: present ? await realpath(checkout) : null,
      type: component.integration === "root" ? "distribution" : "source-repository",
      present,
      inspected,
      revision,
      clean,
      sourceRevision: source?.revision ?? null,
      sourceMount: source?.mount ?? null,
      submodule: false,
      upstream: null,
      sourceCovered: component.integration === "root" || (imported ? inherited : pinned),
      matchesSourcePin: source ? revision === source.revision : null,
      cargoOwner: component.integration === "root" || imported ? "." : component.id,
      bunOwner: component.integration === "root" || imported ? "." : component.id,
      buildOwner: imported ? "bun-os" : component.id,
      releaseOwner: imported ? "bun-os" : component.id,
      targets: "owner-defined",
      qualification: "source-inventory-only",
      migrationState: component.integration,
    });
  }
  const sourceRoot = resolve(packageRoot, catalog.sourceRoot);
  const knownPaths = new Set(components.map(component => component.path.toLowerCase()));
  const excludedPaths = new Set(catalog.excludedRepositories.map(name => resolve(sourceRoot, name).toLowerCase()));
  const additional = [];
  for (const entry of await readdir(sourceRoot, { withFileTypes: true })) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || entry.name.startsWith(".")) continue;
    const path = join(sourceRoot, entry.name);
    if (knownPaths.has(path.toLowerCase())) continue;
    if (excludedPaths.has(path.toLowerCase())) {
      additional.push({ path, type: "external-repository", state: "outside-integration" });
      continue;
    }
    if (!existsSync(join(path, ".git"))) {
      additional.push({ path, type: "non-repository", state: "retained" });
      continue;
    }
    const owner = await git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const sameOwner = owner.code === 0 && owner.stdout.trim().toLowerCase() === common.stdout.trim().toLowerCase();
    additional.push({
      path,
      type: sameOwner ? "linked-worktree" : "unclassified-repository",
      state: "retained",
    });
  }
  const allSelectedSourceOwnersCovered =
    components.every(component => component.sourceCovered === true) &&
    additional.every(entry => entry.type !== "unclassified-repository");
  return {
    schemaVersion: 1,
    root: packageRoot,
    sourceRoot,
    integrationScope: catalog.integrationScope,
    aphrodyLayers: {
      ai: ["models", "agents", "memory", "A2A", "MCP"],
      infrastructure: ["hosts", "deployment", "services", "pipelines", "cloud"],
    },
    productLayout: {
      roots: ["crates", "packages", "apps"],
      bunMembers: bun.workspaces.length,
      cargoMembers: cargo.workspace.members.length,
      nestedBunMembers,
      nestedCargoMembers,
      declaredMembersAreFlat: nestedBunMembers.length === 0 && nestedCargoMembers.length === 0,
      integrationState: "migration-in-progress",
    },
    allSelectedSourceOwnersCovered,
    components,
    additional,
    pinnedMounts: lock.repositories.length,
    physicalConsolidationComplete: components.every(component => {
      if (component.integration === "merged-history" || component.integration === "absorbed-source") return false;
      if (!component.physicalPath) return false;
      const local = relative(packageRoot, component.physicalPath);
      return !isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`);
    }),
    qualification:
      "Source graph only; nested Cargo/Bun workspaces, active checkouts and protected stores retain their owners.",
  };
}

import { basename, dirname, join } from "node:path";
import { infraRoot } from "./runtime.ts";

const OFFICIAL_NPM_REGISTRY = "https://registry.npmjs.org";
const REGISTRY_LINE = /^\s*registry\s*=\s*(\S+)/m;
const BUNFIG_REGISTRY_LINE = /^\s*registry\s*=\s*["']?([^"'\s#]+)["']?\s*$/m;

type PackageManifest = {
  name?: string;
  version?: string;
  private?: boolean;
  packageManager?: string;
  engines?: { bun?: string };
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

export type BunPackageWorkspace = {
  id: string;
  name: string;
  version: string | undefined;
  root: string;
  packageManager: string;
  lockfile: string;
  registry: string;
  registrySource: "npmrc" | "bunfig" | "bun-default";
  workspaces: string[];
};

async function exists(path: string): Promise<boolean> {
  return (await Bun.file(path).exists()) && (await Bun.file(path).size) >= 0;
}

async function configuredRegistry(
  root: string,
): Promise<Pick<BunPackageWorkspace, "registry" | "registrySource">> {
  const npmrc = Bun.file(join(root, ".npmrc"));
  if (await npmrc.exists()) {
    const value = REGISTRY_LINE.exec(await npmrc.text())?.[1];
    if (value) return { registry: value, registrySource: "npmrc" };
  }
  const bunfig = Bun.file(join(root, "bunfig.toml"));
  if (await bunfig.exists()) {
    const value = BUNFIG_REGISTRY_LINE.exec(await bunfig.text())?.[1];
    if (value) return { registry: value, registrySource: "bunfig" };
  }
  return { registry: OFFICIAL_NPM_REGISTRY, registrySource: "bun-default" };
}

/** Discover the supplied monorepo Bun root without inspecting sibling checkouts. */
export async function discoverBunPackageWorkspaces(
  root = infraRoot(),
): Promise<BunPackageWorkspace[]> {
  const rootManifestPath = join(root, "package.json");
  if (!(await Bun.file(rootManifestPath).exists())) return [];
  const manifestPaths = [rootManifestPath];
  const candidates = await Promise.all(
    manifestPaths.map(async (manifestPath) => {
      const workspaceRoot = dirname(manifestPath);
      const id = basename(workspaceRoot);
      if (!(await exists(join(workspaceRoot, "bun.lock")))) return undefined;
      const manifest = (await Bun.file(manifestPath).json()) as PackageManifest;
      const declaresBun =
        manifest.packageManager?.startsWith("bun@") ||
        Boolean(manifest.engines?.bun) ||
        Boolean(manifest.devDependencies?.["@types/bun"]);
      if (!declaresBun) return undefined;
      const config = await configuredRegistry(workspaceRoot);
      const workspaces = Array.isArray(manifest.workspaces)
        ? manifest.workspaces
        : (manifest.workspaces?.packages ?? []);
      return {
        id,
        name: manifest.name ?? id,
        version: manifest.version,
        root: workspaceRoot,
        packageManager: manifest.packageManager ?? "bun (manifest inferred)",
        lockfile: join(workspaceRoot, "bun.lock"),
        workspaces,
        ...config,
      } satisfies BunPackageWorkspace;
    }),
  );
  return candidates
    .flatMap((candidate) => (candidate ? [candidate] : []))
    .toSorted((a, b) => a.id.localeCompare(b.id));
}

function selectedWorkspaces(
  workspaces: BunPackageWorkspace[],
  repository: string | undefined,
): BunPackageWorkspace[] {
  if (!repository) return workspaces;
  const selected = workspaces.filter(
    (workspace) => workspace.id === repository || workspace.name === repository,
  );
  if (selected.length === 0) throw new Error(`unknown Bun workspace: ${repository}`);
  return selected;
}

export type PackageOperation = "status" | "install" | "outdated" | "audit";

/** Run Bun's package manager only against verified first-party Bun workspaces. */
export async function runPackageOperation(
  operation: PackageOperation,
  options: { root?: string; repository?: string } = {},
): Promise<number> {
  const workspaces = selectedWorkspaces(
    await discoverBunPackageWorkspaces(options.root),
    options.repository,
  );
  if (operation === "status") {
    console.log(JSON.stringify({ registry: OFFICIAL_NPM_REGISTRY, workspaces }, null, 2));
    return 0;
  }
  let exitCode = 0;
  for (const workspace of workspaces) {
    const args =
      operation === "install"
        ? ["install", "--frozen-lockfile"]
        : operation === "outdated"
          ? ["outdated", "--frozen-lockfile"]
          : ["audit", "--json"];
    console.error(`@aphrody/workspace ${operation}: ${workspace.id}`);
    const child = Bun.spawn([process.execPath, ...args], {
      cwd: workspace.root,
      stdout: "inherit",
      stderr: "inherit",
    });
    const result = await child.exited;
    if (result !== 0) exitCode = result;
  }
  return exitCode;
}

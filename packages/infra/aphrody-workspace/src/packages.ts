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

type Ecosystem = { repos?: Array<{ name?: string }> };

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

async function hasFirstPartyRemote(root: string): Promise<boolean> {
  const child = Bun.spawn(["git", "-C", root, "remote", "get-url", "origin"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if ((await child.exited) !== 0) return false;
  const remote = (await new Response(child.stdout).text()).trim();
  return /github\.com[/:]aphrody-(?:code|labs)\//.test(remote);
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

/** Discover only first-party Bun roots; upstream checkouts are excluded. */
export async function discoverBunPackageWorkspaces(
  root = infraRoot(),
): Promise<BunPackageWorkspace[]> {
  const sourceRoot = dirname(root);
  const ecosystem = (await Bun.file(
    join(root, "docs", "ecosystem", "ecosystem.json"),
  ).json()) as Ecosystem;
  const owned = new Set((ecosystem.repos ?? []).flatMap((repo) => (repo.name ? [repo.name] : [])));
  owned.add(basename(root));
  const manifestPaths = await Array.fromAsync(
    new Bun.Glob("*/package.json").scan({ cwd: sourceRoot, absolute: true }),
  );
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
      if (!declaresBun || (!owned.has(id) && !(await hasFirstPartyRemote(workspaceRoot))))
        return undefined;
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
    .sort((a, b) => a.id.localeCompare(b.id));
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

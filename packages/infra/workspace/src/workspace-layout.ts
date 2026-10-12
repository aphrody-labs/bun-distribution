import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const INTERNAL_ROOTS = [
  "apps/",
  "examples/",
  "packages/",
  "drive/apps/",
  "drive/packages/",
  "m3/apps/",
  "m3/packages/",
  "crates/tauri/",
];
/** Canonical sources transferred to the Bun fork, linked from its sibling checkout (C:/bun next to C:/aphrody). */
const BUN_FORK_PACKAGES = "../bun/packages/";

/** In-repository roots, or the Bun fork packages without any further escape. */
export function allowedWorkspace(root: string, workspacePath: string): boolean {
  const segments = workspacePath.split("/");
  if (segments.some((segment) => segment === "" || segment === ".")) return false;
  if (workspacePath.startsWith(BUN_FORK_PACKAGES)) {
    const rest = workspacePath.slice(BUN_FORK_PACKAGES.length);
    const forkPackages = resolve(root, BUN_FORK_PACKAGES);
    const target = relative(forkPackages, resolve(root, workspacePath));
    return (
      rest.length > 0 && !rest.split("/").includes("..") && !!target && !target.startsWith("..")
    );
  }
  return (
    !segments.includes("..") &&
    INTERNAL_ROOTS.some((prefix) => workspacePath.startsWith(prefix)) &&
    !relative(root, resolve(root, workspacePath)).startsWith("..")
  );
}

type RootManifest = {
  workspaces?: string[] | { packages?: string[] };
};

export async function runWorkspaceLayout(args: string[]): Promise<number> {
  let root = process.cwd();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: yolo ops workspace-layout [--root <repository>]");
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires a repository path");
  root = resolve(root);
  const packagesRoot = join(root, "packages");
  const manifestPath = join(root, "package.json");
  const rootManifest = (await Bun.file(manifestPath).json()) as RootManifest;
  const declaredWorkspaces = Array.isArray(rootManifest.workspaces)
    ? rootManifest.workspaces
    : rootManifest.workspaces?.packages;
  if (!Array.isArray(declaredWorkspaces))
    throw new Error("package.json must declare workspaces or workspaces.packages as an array");

  const workspacePatterns = declaredWorkspaces.filter(
    (entry): entry is string => typeof entry === "string",
  );
  const workspacePaths = (
    await Promise.all(
      workspacePatterns.map(async (pattern) => {
        const glob = new Bun.Glob(`${pattern}/package.json`);
        const manifests = await Array.fromAsync(glob.scan({ cwd: root, onlyFiles: true }));
        return manifests.map((manifest) => dirname(manifest).replaceAll("\\", "/"));
      }),
    )
  ).flat();
  const errors: string[] = [];
  const declaredSubmodules = new Set<string>();

  const gitmodulesPath = join(root, ".gitmodules");
  if (existsSync(gitmodulesPath)) {
    const gitmodules = readFileSync(gitmodulesPath, "utf8");
    const submodulePaths = [...gitmodules.matchAll(/^\s*path\s*=\s*(.+)$/gm)].map(
      (match) => match[1]?.trim() ?? "",
    );
    for (const submodulePath of submodulePaths) {
      const normalized = submodulePath.replaceAll("\\", "/");
      if (!normalized || normalized.includes("..")) {
        errors.push(`invalid submodule path: ${submodulePath}`);
        continue;
      }
      declaredSubmodules.add(normalized);
    }
  }

  for (const workspacePath of workspacePaths) {
    const absolutePath = resolve(root, workspacePath);
    const packageManifest = join(absolutePath, "package.json");
    const gitMetadata = join(absolutePath, ".git");

    if (!allowedWorkspace(root, workspacePath)) {
      errors.push(
        `workspace must live below ${INTERNAL_ROOTS.join(", ")} or the sibling Bun fork checkout ${BUN_FORK_PACKAGES}: ${workspacePath}`,
      );
    }
    if (!existsSync(packageManifest)) {
      errors.push(`workspace has no package.json: ${workspacePath}`);
    }
    if (existsSync(gitMetadata) && !declaredSubmodules.has(workspacePath)) {
      errors.push(`nested Git metadata is not allowed: ${workspacePath}/.git`);
    }
  }

  if (existsSync(packagesRoot)) {
    for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const workspacePath = `packages/${entry.name}`;
      const packageManifest = join(packagesRoot, entry.name, "package.json");
      if (existsSync(packageManifest) && !workspacePaths.includes(workspacePath)) {
        errors.push(`package manifest is not declared as a workspace: ${workspacePath}`);
      }
      if (
        existsSync(join(packagesRoot, entry.name, ".git")) &&
        !declaredSubmodules.has(workspacePath)
      ) {
        errors.push(`nested Git metadata is not allowed: ${workspacePath}/.git`);
      }
    }
  }

  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    return 1;
  }

  console.log(
    `Workspace layout OK (${workspacePaths.length} packages; external sources isolated).`,
  );
  return 0;
}

if (import.meta.main) process.exit(await runWorkspaceLayout(process.argv.slice(2)));

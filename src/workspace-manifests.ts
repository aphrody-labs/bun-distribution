import { dirname, join } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";

type CargoManifest = {
  package?: { name?: string; version?: unknown };
  workspace?: { members?: string[]; exclude?: string[] };
};
type PackageManifest = { name?: string; version?: string; private?: boolean; workspaces?: string[] | { packages?: string[] } };

/** Read source manifests, including initialized pinned sources, without scanning caches or running builds. */
export async function inspectWorkspaceManifests(root: string) {
  async function git(args: string[]) {
    const result = await runProcess(["git", "-c", "core.fsmonitor=false", ...args], root, {
      timeoutMs: 30_000,
      maxOutputBytes: 32 * 1024 * 1024,
      env: { ...Bun.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" },
    });
    if (result.code !== 0) throw new Error(`Cannot inventory Git sources: ${result.stderr}`);
    return result.stdout;
  }
  const [tracked, untracked, staged, modules, rootCargo, rootBun] = await Promise.all([
    git(["ls-files", "--cached", "--recurse-submodules", "-z", "--", "Cargo.toml", "package.json", ":(glob)**/Cargo.toml", ":(glob)**/package.json"]),
    git(["ls-files", "--others", "--exclude-standard", "-z", "--", "Cargo.toml", "package.json", ":(glob)**/Cargo.toml", ":(glob)**/package.json"]),
    git(["ls-files", "--stage", "-z"]),
    Bun.file(join(root, ".gitmodules")).text(),
    Bun.file(join(root, "Cargo.toml")).text(),
    Bun.file(join(root, "package.json")).json() as Promise<PackageManifest>,
  ]);
  const cargoWorkspace = (Bun.TOML.parse(rootCargo) as CargoManifest).workspace ?? {};
  const bunMembers = Array.isArray(rootBun.workspaces) ? rootBun.workspaces : rootBun.workspaces?.packages ?? [];
  const matches = (path: string, patterns: string[]) => patterns.some(pattern => new Bun.Glob(pattern.replace(/\/$/, "")).match(path));
  const declarations = [...modules.matchAll(/\[submodule "([^"]+)"\]([^\[]*)/g)].map(match => ({
    name: match[1],
    path: /^\s*path\s*=\s*(.+)$/m.exec(match[2])?.[1].trim() ?? "",
    repository: /^\s*url\s*=\s*(.+)$/m.exec(match[2])?.[1].trim() ?? null,
  }));
  const pins = staged.split("\0").filter(line => line.startsWith("160000 ")).map(line => {
    const tab = line.indexOf("\t");
    return { path: line.slice(tab + 1), revision: line.slice(7, 47) };
  });
  const submodules = await Promise.all(declarations.map(async declaration => ({
    ...declaration,
    revision: pins.find(pin => pin.path === declaration.path)?.revision ?? null,
    initialized: await Bun.file(join(root, declaration.path, ".git")).exists() || await Bun.file(join(root, declaration.path, ".git/HEAD")).exists(),
  })));
  const paths = [...new Set([...tracked.split("\0"), ...untracked.split("\0")])].filter(Boolean).sort();
  const manifests: Record<string, unknown>[] = [];
  const failures: { path: string; error: string }[] = [];
  for (let offset = 0; offset < paths.length; offset += 16) {
    await Promise.all(paths.slice(offset, offset + 16).map(async path => {
      try {
        const directory = dirname(path).replaceAll("\\", "/");
        const rust = path.endsWith("Cargo.toml");
        const content = await Bun.file(join(root, path)).text();
        const parsed = rust ? Bun.TOML.parse(content) as CargoManifest : JSON.parse(content) as PackageManifest;
        const name = rust ? (parsed as CargoManifest).package?.name : (parsed as PackageManifest).name;
        const submodule = submodules.filter(item => directory === item.path || directory.startsWith(`${item.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
        manifests.push({ path, directory, type: rust ? "cargo" : "bun-package", name: name ?? null,
          version: rust ? (parsed as CargoManifest).package?.version ?? null : (parsed as PackageManifest).version ?? null,
          workspaceBoundary: Boolean(rust ? (parsed as CargoManifest).workspace : (parsed as PackageManifest).workspaces),
          rootWorkspaceMember: directory !== "." && matches(directory, rust ? cargoWorkspace.members ?? [] : bunMembers) && (!rust || !matches(directory, cargoWorkspace.exclude ?? [])),
          sourceOwner: submodule?.path ?? ".", repository: submodule?.repository ?? null, pinnedRevision: submodule?.revision ?? null,
          qualification: "source-inventory-only" });
      } catch (error) { failures.push({ path, error: String(error) }); }
    }));
  }
  manifests.sort((a, b) => String(a.path).localeCompare(String(b.path)));
  const missingMembers = [
    ...(cargoWorkspace.members ?? []).filter(pattern => !manifests.some(item => item.type === "cargo" && matches(String(item.directory), [pattern]))).map(path => ({ type: "cargo", path })),
    ...bunMembers.filter(pattern => !manifests.some(item => item.type === "bun-package" && matches(String(item.directory), [pattern]))).map(path => ({ type: "bun-package", path })),
  ];
  const vendorRoots = [...new Set([...paths, ...submodules.map(item => item.path)].filter(path => path.startsWith("vendor/")).map(path => path.split("/").slice(0, 2).join("/")))].sort();
  return {
    schemaVersion: 1,
    coverage: "Current tracked manifests in root and initialized submodules, plus nonignored untracked root manifests. Uninitialized sources are reported without inventing their manifests.",
    counts: { manifests: manifests.length, crates: manifests.filter(item => item.type === "cargo" && item.name).length, packages: manifests.filter(item => item.type === "bun-package").length, submodules: submodules.length, unavailableSubmodules: submodules.filter(item => !item.initialized).length, vendorRoots: vendorRoots.length, missingMembers: missingMembers.length, parseFailures: failures.length },
    manifests, submodules, missingMembers, failures,
    undeclaredGitlinks: pins.filter(pin => !declarations.some(item => item.path === pin.path)),
    vendorRoots: vendorRoots.map(path => ({ path, submodule: submodules.some(item => item.path === path), disposition: "retained-pending-consumer-and-provenance-review" })),
  };
}

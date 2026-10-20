import { dirname, join, posix } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";

type CargoManifest = {
  package?: { name?: string; version?: unknown; workspace?: string };
  workspace?: { members?: string[]; exclude?: string[] };
};
type PackageManifest = { name?: string; version?: string; private?: boolean; workspaces?: string[] | { packages?: string[] } };

async function inventoryGit(root: string, args: string[]) {
  const result = await runProcess(["git", "-c", "core.fsmonitor=false", ...args], root, {
    timeoutMs: 30_000,
    maxOutputBytes: 32 * 1024 * 1024,
    env: { ...Bun.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.code !== 0) throw new Error(`Cannot inventory Git sources: ${result.stderr}`);
  return result.stdout;
}

/** Recursive Git source pins and declarations available in initialized owners; no build or checkout mutation. */
export async function inspectGitSourceOwners(root: string, preloaded: { staged?: string; modules?: string } = {}) {
  const submodules: {
    name: string;
    path: string;
    repository: string | null;
    revision: string | null;
    initialized: boolean;
    depth: number;
  }[] = [];
  const pins: { path: string; revision: string }[] = [];
  const visited = new Set<string>();
  const statusOutput = await inventoryGit(root, ["submodule", "status", "--recursive"]);
  const statusByPath = new Map(statusOutput.split("\n").flatMap(line => {
    const match = /^([-+ U])([0-9a-f]{40})\s+(.+)$/.exec(line);
    return match ? [[match[3]!.replace(/\s+\([^)]*\)$/, ""), match[1]!] as const] : [];
  }));

  async function visit(repositoryRoot: string, prefix: string, depth: number) {
    const identity = prefix || ".";
    if (visited.has(identity)) return;
    visited.add(identity);
    const modulesPath = join(repositoryRoot, ".gitmodules");
    const modulesFile = Bun.file(modulesPath);
    if (!(await modulesFile.exists())) return;
    const [modules, staged] = await Promise.all([
      depth === 0 && preloaded.modules !== undefined ? preloaded.modules : modulesFile.text(),
      depth === 0 && preloaded.staged !== undefined
        ? preloaded.staged
        : inventoryGit(root, ["-C", repositoryRoot, "ls-files", "--stage", "-z"]),
    ]);
    const declarations = [...modules.matchAll(/\[submodule "([^"]+)"\]([^\[]*)/g)].map(match => ({
      name: match[1]!,
      path: /^\s*path\s*=\s*(.+)$/m.exec(match[2]!)?.[1].trim() ?? "",
      repository: /^\s*url\s*=\s*(.+)$/m.exec(match[2]!)?.[1].trim() ?? null,
    })).map(declaration => ({ ...declaration, path: declaration.path.replaceAll("\\", "/") }))
      .filter(declaration => declaration.path && !posix.isAbsolute(declaration.path) &&
        !/^[a-z]:\//i.test(declaration.path) &&
        !declaration.path.split("/").some(part => part === ".." || part === "." || part === ""));
    const localPins = staged.split("\0").filter(line => line.startsWith("160000 ")).map(line => {
      const tab = line.indexOf("\t");
      return { path: line.slice(tab + 1), revision: line.slice(7, 47) };
    });
    pins.push(...localPins.map(pin => ({ path: prefix ? `${prefix}/${pin.path}` : pin.path, revision: pin.revision })));
    for (const declaration of declarations) {
      const path = prefix ? `${prefix}/${declaration.path.replaceAll("\\", "/")}` : declaration.path.replaceAll("\\", "/");
      const revision = localPins.find(pin => pin.path === declaration.path)?.revision ?? null;
      const childRoot = join(repositoryRoot, declaration.path);
      const initialized = statusByPath.has(path) && statusByPath.get(path) !== "-";
      submodules.push({ name: declaration.name, path, repository: declaration.repository, revision, initialized, depth: depth + 1 });
      if (initialized) await visit(childRoot, path, depth + 1);
    }
  }

  await visit(root, "", 0);
  return { submodules, pins };
}

/** Read source manifests, including initialized pinned sources, without scanning caches or running builds. */
export async function inspectWorkspaceManifests(root: string) {
  const git = (args: string[]) => inventoryGit(root, args);
  const [tracked, untracked, staged, modules, rootCargo, rootBun, rootRevision] = await Promise.all([
    git(["ls-files", "--cached", "--recurse-submodules", "-z", "--", "Cargo.toml", "package.json", ":(glob)**/Cargo.toml", ":(glob)**/package.json"]),
    git(["ls-files", "--others", "--exclude-standard", "-z", "--", "Cargo.toml", "package.json", ":(glob)**/Cargo.toml", ":(glob)**/package.json"]),
    git(["ls-files", "--stage", "-z"]),
    Bun.file(join(root, ".gitmodules")).text(),
    Bun.file(join(root, "Cargo.toml")).text(),
    Bun.file(join(root, "package.json")).json() as Promise<PackageManifest>,
    git(["rev-parse", "HEAD"]),
  ]);
  const cargoWorkspace = (Bun.TOML.parse(rootCargo) as CargoManifest).workspace ?? {};
  const bunMembers = Array.isArray(rootBun.workspaces) ? rootBun.workspaces : rootBun.workspaces?.packages ?? [];
  const matches = (path: string, patterns: string[]) => patterns.some(pattern => new Bun.Glob(pattern.replace(/\/$/, "")).match(path));
  const { submodules, pins } = await inspectGitSourceOwners(root, { staged, modules });
  const indexedPaths = staged.split("\0").filter(Boolean).map(line => line.slice(line.indexOf("\t") + 1));
  const paths = [...new Set([...tracked.split("\0"), ...untracked.split("\0")])].filter(Boolean).sort();
  const manifests: Record<string, unknown>[] = [];
  const parsedManifests = new Map<string, CargoManifest | PackageManifest>();
  const failures: { path: string; error: string }[] = [];
  for (let offset = 0; offset < paths.length; offset += 16) {
    await Promise.all(paths.slice(offset, offset + 16).map(async path => {
      try {
        const directory = dirname(path).replaceAll("\\", "/");
        const rust = path.endsWith("Cargo.toml");
        const content = await Bun.file(join(root, path)).text();
        const parsed = rust ? Bun.TOML.parse(content) as CargoManifest : JSON.parse(content) as PackageManifest;
        parsedManifests.set(path, parsed);
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
  // Workspace membership and the closest source boundary are different facts.
  // Keep declarations visible even when a nested owner conflicts with them.
  const ownershipConflicts: { path: string; declaredOwner: string; discoveredOwner: string | null }[] = [];
  for (const manifest of manifests) {
    const directory = String(manifest.directory);
    const rust = manifest.type === "cargo";
    const filename = rust ? "Cargo.toml" : "package.json";
    const parsed = parsedManifests.get(String(manifest.path))!;
    const explicitOwner = rust ? (parsed as CargoManifest).package?.workspace : undefined;
    let owner: string | null = null;
    let ownerParsed: CargoManifest | PackageManifest | undefined;
    if (explicitOwner !== undefined) {
      owner = posix.normalize(posix.join(directory, explicitOwner));
      ownerParsed = parsedManifests.get(posix.join(owner, filename));
    } else {
      let candidate = directory;
      while (true) {
        const candidateParsed = parsedManifests.get(posix.join(candidate, filename));
        if (rust ? Boolean((candidateParsed as CargoManifest | undefined)?.workspace) : Boolean((candidateParsed as PackageManifest | undefined)?.workspaces)) {
          owner = candidate;
          ownerParsed = candidateParsed;
          break;
        }
        // Independent Git owners cannot inherit the distribution's workspace.
        if (candidate === manifest.sourceOwner || candidate === ".") break;
        candidate = posix.dirname(candidate);
      }
    }
    if (owner === null && matches(directory, rust ? cargoWorkspace.members ?? [] : bunMembers)) {
      owner = ".";
      ownerParsed = parsedManifests.get(filename);
    }
    const relativePath = owner === null ? null : posix.relative(owner, directory) || ".";
    const workspace = rust ? (ownerParsed as CargoManifest | undefined)?.workspace : undefined;
    const packageWorkspace = (ownerParsed as PackageManifest | undefined)?.workspaces;
    const members = rust ? workspace?.members ?? [] : Array.isArray(packageWorkspace) ? packageWorkspace : packageWorkspace?.packages ?? [];
    const exclusions = rust ? workspace?.exclude ?? [] : [];
    const excluded = relativePath !== null && exclusions.some(pattern => matches(relativePath, [pattern]) || matches(relativePath, [`${pattern.replace(/\/$/, "")}/**`]));
    const declared = relativePath !== null && matches(relativePath, members);
    const rootDeclared = directory !== "." && matches(directory, rust ? cargoWorkspace.members ?? [] : bunMembers);
    const rootExcluded = rust && (cargoWorkspace.exclude ?? []).some(pattern => matches(directory, [pattern]) || matches(directory, [`${pattern.replace(/\/$/, "")}/**`]));
    manifest.rootWorkspaceDeclared = rootDeclared;
    manifest.rootWorkspaceExcluded = rootExcluded;
    manifest.rootWorkspaceMember = rootDeclared && !rootExcluded && owner === ".";
    manifest.workspaceOwner = excluded ? null : owner;
    manifest.workspaceOwnerManifest = owner === null ? null : posix.join(owner, filename);
    manifest.workspaceMembership = owner === null ? "standalone" : !(rust ? workspace : packageWorkspace) ? "missing-explicit-owner" : excluded ? "excluded" : relativePath === "." ? "workspace-root" : declared ? "declared-member" : rust ? "ancestor-workspace-membership-unverified" : "outside-declared-members";
    manifest.workspaceOwnerEvidence = explicitOwner !== undefined ? "package.workspace" : owner === "." && rootDeclared ? "root-workspace-members" : owner !== null ? "nearest-ancestor-workspace-manifest" : "no-ancestor-workspace-in-source-owner";
    manifest.sourceRole = /(?:^|\/)(?:fixtures?|__fixtures__)(?:\/|$)/.test(directory) ? "fixture" : /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(directory) ? "test" : /(?:^|\/)(?:examples?|bench(?:marks?)?)(?:\/|$)/.test(directory) ? "example-or-benchmark" : "source";
    if (rootDeclared && !rootExcluded && owner !== ".") ownershipConflicts.push({ path: String(manifest.path), declaredOwner: ".", discoveredOwner: owner });
  }
  const missingMembers = [
    ...(cargoWorkspace.members ?? []).filter(pattern => !manifests.some(item => item.type === "cargo" && matches(String(item.directory), [pattern]))).map(path => ({ type: "cargo", path })),
    ...bunMembers.filter(pattern => !manifests.some(item => item.type === "bun-package" && matches(String(item.directory), [pattern]))).map(path => ({ type: "bun-package", path })),
  ];
  // Vendor payloads need not contain a Cargo or package manifest (archives, fonts,
  // SDK headers). Include every root-index path rather than only parsed manifests.
  const vendorRoots = [...new Set([...indexedPaths, ...paths, ...submodules.map(item => item.path)].filter(path => path.startsWith("vendor/")).map(path => path.split("/").slice(0, 2).join("/")))].sort();
  const consumerSearch = await runProcess([
    "git", "-c", "core.fsmonitor=false", "grep", "-n", "-I", "-F", "-e", "vendor/", "--", ".",
    ":(exclude)vendor", ":(exclude)toolchains", ":(exclude)docs", ":(exclude)Cargo.lock", ":(exclude)bun.lock",
  ], root, {
    timeoutMs: 30_000,
    maxOutputBytes: 32 * 1024 * 1024,
    env: { ...Bun.env, GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" },
  });
  if (consumerSearch.code !== 0 && consumerSearch.code !== 1)
    throw new Error(`Cannot inspect vendor consumers: ${consumerSearch.stderr}`);
  const references = consumerSearch.stdout.split("\n").flatMap(line => {
    const match = /^(.+?):(\d+):(.*)$/.exec(line);
    if (!match) return [];
    return [{ file: match[1], line: Number(match[2]), text: match[3] }];
  });
  const vendorInventory = vendorRoots.map(path => {
    const consumers = references.filter(reference => {
      let offset = reference.text.indexOf(path);
      while (offset >= 0) {
        const next = reference.text[offset + path.length];
        if (!next || !/[\w.-]/.test(next)) return true;
        offset = reference.text.indexOf(path, offset + path.length);
      }
      return false;
    }).map(({ file, line }) => ({ file, line, kind: file === ".gitmodules" || file === "sources.lock.json" ? "source-declaration" : "potential-consumer" }));
    return {
      path,
      submodule: submodules.some(item => item.path === path || item.path.startsWith(`${path}/`)),
      references: consumers,
      potentialConsumerReferences: consumers.filter(reference => reference.kind === "potential-consumer").length,
      disposition: "retained-pending-consumer-and-provenance-review",
    };
  });
  const componentInventory = [
    ...manifests.map(manifest => {
      const rust = manifest.type === "cargo";
      const directory = String(manifest.directory);
      const sourceOwner = String(manifest.sourceOwner);
      const workspaceOwner = typeof manifest.workspaceOwner === "string" ? manifest.workspaceOwner : null;
      const owner = workspaceOwner ?? sourceOwner;
      const directApp = directory.startsWith("apps/") && directory.split("/").length === 2;
      const parsed = parsedManifests.get(String(manifest.path))!;
      const targets = rust
        ? null
        : {
          os: (parsed as PackageManifest & { os?: string[] }).os ?? null,
          cpu: (parsed as PackageManifest & { cpu?: string[] }).cpu ?? null,
        };
      return {
        component: String(manifest.name ?? directory),
        path: directory,
        type: rust ? (directApp ? "cargo-app" : "crate") : directApp ? "bun-app" : "package",
        sourceRepository: manifest.repository ?? (sourceOwner === "." ? "aphrody-labs/bun-distribution" : null),
        submodule: sourceOwner === "." ? null : sourceOwner,
        revision: manifest.pinnedRevision,
        upstream: manifest.repository,
        cargoOwner: rust ? owner : null,
        bunOwner: rust ? null : owner,
        buildOwner: owner,
        releaseOwner: owner,
        targets,
        qualificationState: manifest.qualification,
        migrationState: manifest.workspaceMembership,
        ownerEvidence: manifest.workspaceOwnerEvidence,
      };
    }),
    ...submodules.map(submodule => ({
      component: submodule.name,
      path: submodule.path,
      type: "submodule",
      sourceRepository: submodule.repository,
      submodule: submodule.path,
      revision: submodule.revision,
      upstream: submodule.repository,
      cargoOwner: null,
      bunOwner: null,
      buildOwner: submodule.path,
      releaseOwner: submodule.path,
      targets: null,
      qualificationState: submodule.initialized ? "source-available-unqualified" : "unavailable-unqualified",
      migrationState: "pinned-source-boundary",
      ownerEvidence: "gitmodules-and-index-gitlink",
    })),
    ...vendorInventory.map(vendor => {
      const submodule = submodules.find(item => item.path === vendor.path);
      return {
        component: String(vendor.path).split("/").at(-1),
        path: vendor.path,
        type: "vendor",
        sourceRepository: submodule?.repository ?? null,
        submodule: submodule?.path ?? null,
        revision: submodule?.revision ?? null,
        upstream: submodule?.repository ?? null,
        cargoOwner: null,
        bunOwner: null,
        buildOwner: submodule?.path ?? "unresolved",
        releaseOwner: submodule?.path ?? "unresolved",
        targets: null,
        qualificationState: "consumer-review-only",
        migrationState: String(vendor.disposition),
        ownerEvidence: submodule ? "gitmodules-and-index-gitlink" : "root-index-path",
      };
    }),
  ];
  return {
    schemaVersion: 1,
    rootRevision: rootRevision.trim(),
    coverage: "Tracked root and initialized recursive submodule manifests, plus nonignored untracked root manifests. Git source declarations are recursive through initialized owners; unavailable owners are recorded from their parent contract without inventing nested manifests.",
    counts: { manifests: manifests.length, crates: manifests.filter(item => item.type === "cargo" && item.name).length, packages: manifests.filter(item => item.type === "bun-package").length, rootCargoMembers: manifests.filter(item => item.type === "cargo" && item.rootWorkspaceMember).length, rootBunMembers: manifests.filter(item => item.type === "bun-package" && item.rootWorkspaceMember).length, fixtureManifests: manifests.filter(item => item.sourceRole === "fixture").length, ownershipConflicts: ownershipConflicts.length, submodules: submodules.length, rootSubmodules: submodules.filter(item => item.depth === 1).length, unavailableSubmodules: submodules.filter(item => !item.initialized).length, unavailableRootSubmodules: submodules.filter(item => item.depth === 1 && !item.initialized).length, unpinnedSubmodules: submodules.filter(item => item.revision === null).length, vendorRoots: vendorRoots.length, missingMembers: missingMembers.length, parseFailures: failures.length },
    ownershipCoverage: "Owners follow explicit package.workspace or nearest ancestor workspace within the Git source boundary. Cargo implicit path-dependency membership is unverified without Cargo metadata. Source roles are path-based labels; all parsed manifests remain listed.",
    ownershipConflicts,
    componentInventory, manifests, submodules, missingMembers, failures,
    unpinnedSubmodules: submodules.filter(item => item.revision === null).map(item => ({ path: item.path, repository: item.repository, state: "declaration-without-index-gitlink", disposition: "review-active-source-contracts-before-removal" })),
    undeclaredGitlinks: pins.filter(pin => !submodules.some(item => item.path === pin.path)),
    vendorConsumerCoverage: "Literal forward-slash paths in tracked root text files, excluding vendor, toolchains, docs and lockfiles. References are candidates, not proven runtime consumers; absent references do not prove a vendor removable.",
    vendorRoots: vendorInventory,
  };
}

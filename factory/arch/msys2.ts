import { lstat, readdir, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hashFile, isObject } from "../../packages/bun-workspace/src/index.ts";
import { runProcess } from "../../packages/bun-workspace/src/process.ts";

export interface Msys2SourceOptions {
  sourceRoot?: string;
  /** Explicit user context; only immediate names/types and guidance metadata are inspected. */
  home?: string;
}

interface RootSource {
  id: string;
  repository: string;
  revision: string;
  upstream?: string;
  forkSource?: string;
}

function repositoryId(value: string): string {
  return value
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/^[^/@]+@/, "")
    .replace(/^github\.com[:/]/i, "")
    .replace(/\.git\/?$/i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function publicRemote(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return value.replace(/\/\/[^/]*@/, "//");
  }
}

async function document(path: string) {
  const file = Bun.file(path);
  if (!(await file.exists())) return { path, exists: false };
  return { path, exists: true, bytes: file.size, sha256: await hashFile(path, { maxBytes: 1024 * 1024 }) };
}

async function entries(path: string) {
  const children = await readdir(path, { withFileTypes: true });
  return Promise.all(
    children.map(async entry => {
      const fullPath = join(path, entry.name);
      const type = entry.isSymbolicLink() ? "link" : entry.isDirectory() ? "directory" : "file";
      return {
        name: entry.name,
        path: fullPath,
        type,
        ...(type === "link"
          ? { linkTarget: await readlink(fullPath), resolvedPath: await realpath(fullPath).catch(() => null) }
          : {}),
      };
    }),
  );
}

async function readObject(path: string): Promise<Record<string, unknown>> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  if (file.size > 4 * 1024 * 1024) throw new Error("MSYS2 metadata exceeds its read limit.");
  const value: unknown = await file.json();
  if (!isObject(value)) throw new Error("Expected an MSYS2 metadata object.");
  return value;
}

async function inspectRepository(path: string, rootSources: RootSource[]) {
  if (!(await lstat(join(path, ".git")).catch(() => null))) return { path, git: false, sourceOnly: true };
  const git = (args: string[]) =>
    runProcess(["git", "-c", "core.fsmonitor=false", ...args], path, {
      timeoutMs: 15_000,
      maxOutputBytes: 512 * 1024,
      env: { ...Bun.env, GIT_OPTIONAL_LOCKS: "0" },
    });
  try {
    const [identity, remoteResult, status, tree] = await Promise.all([
      git(["rev-parse", "--show-toplevel", "--git-common-dir", "HEAD"]),
      git(["config", "--get-regexp", "^remote\\..*\\.url$"]),
      git(["status", "--porcelain=v1", "--untracked-files=no", "--ignore-submodules=all"]),
      git(["ls-tree", "--name-only", "HEAD", "--", "Makefile", "include/linux/kernel.h", "linux-cachyos/PKGBUILD"]),
    ]);
    if (identity.code !== 0 || status.code !== 0 || remoteResult.code > 1)
      throw new Error("Read-only Git metadata query failed.");
    const [top, common, head] = identity.stdout.trim().split(/\r?\n/);
    const resolvedPath = await realpath(path);
    if (
      !top ||
      !common ||
      !head ||
      !/^[a-f0-9]{40}$/.test(head) ||
      resolve(top).toLowerCase() !== resolvedPath.toLowerCase()
    )
      throw new Error("Git identity does not belong to this source view.");
    const commonDirectory = await realpath(resolve(path, common));
    const remotes = remoteResult.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => {
        const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line);
        return { name: match?.[1] ?? "unknown", url: publicRemote(match?.[2] ?? "") };
      });
    const headPaths = tree.code === 0 ? tree.stdout.trim().split(/\r?\n/).filter(Boolean) : [];
    const kernelSource = headPaths.includes("Makefile") && headPaths.includes("include/linux/kernel.h");
    const kernelRecipes = headPaths.includes("linux-cachyos/PKGBUILD");
    const role = kernelSource ? "linux-kernel-source" : kernelRecipes ? "kernel-package-recipes" : "external-source";
    const rootMatches = rootSources.flatMap(source => {
      const exact = remotes.some(remote =>
        [source.repository, source.upstream].some(repo => repo && repositoryId(repo) === repositoryId(remote.url)),
      );
      const network = remotes.some(
        remote => source.forkSource && repositoryId(source.forkSource) === repositoryId(remote.url),
      );
      if (!exact && !network) return [];
      const roleConflict = kernelSource && /recipe/.test(source.id);
      const observedUpstream = remotes.find(remote => remote.name === "upstream")?.url;
      return [
        {
          id: source.id,
          repository: source.repository,
          revision: source.revision,
          match: exact ? "repository-or-upstream" : "fork-lineage-only",
          pinMatches: source.revision === head,
          roleConflict,
          observedUpstream: observedUpstream ?? null,
          selectedUpstream: source.upstream ?? null,
          upstreamMatches:
            observedUpstream && source.upstream
              ? repositoryId(observedUpstream) === repositoryId(source.upstream)
              : null,
          reuse: roleConflict
            ? "Do not equate kernel source with similarly named recipe repository"
            : "Reuse existing source history; exact pin/cleanliness qualification remains required",
        },
      ];
    });
    const changedPaths = status.stdout.split(/\r?\n/).filter(Boolean);
    return {
      path,
      git: true,
      sourceOnly: true,
      resolvedPath,
      commonDirectory,
      head,
      remotes,
      role,
      roleEvidence: { headPaths, source: "Git HEAD tree, not leftover unmerged working-tree paths" },
      diagnostics: [identity, remoteResult, status, tree].flatMap(result =>
        result.stderr.trim() ? [result.stderr.trim()] : [],
      ),
      rootMatches,
      changedPaths,
      cleanTracked: changedPaths.length === 0,
      unmerged: changedPaths.some(line => /^(?:DD|AU|UD|UA|DU|AA|UU)/.test(line)),
      untrackedInspected: false,
      submoduleStatusInspected: false,
    };
  } catch (error) {
    return { path, git: true, sourceOnly: true, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Reuse the installed native MSYS2 context and its source views; never install, sync, build or relocate. */
export async function inspectMsys2Sources(options: Msys2SourceOptions = {}) {
  const discoveredPacman = Bun.which("pacman.exe") ?? Bun.which("pacman");
  const configuredRoot = options.sourceRoot ?? Bun.env.APHRODY_MSYS2_SOURCE_ROOT;
  if (configuredRoot !== undefined && !configuredRoot.trim()) throw new Error("MSYS2 sourceRoot cannot be empty.");
  if (!configuredRoot && !discoveredPacman)
    throw new Error("Set sourceRoot/APHRODY_MSYS2_SOURCE_ROOT or expose native MSYS2 pacman on PATH.");
  const sourceRoot = resolve(configuredRoot ?? join(dirname(discoveredPacman!), "../src"));
  const installationRoot = resolve(sourceRoot, "../..");
  const homeOption = options.home ?? Bun.env.APHRODY_MSYS2_HOME;
  const home = homeOption ? resolve(homeOption) : undefined;
  const sourceRootState = await lstat(sourceRoot);
  if (!sourceRootState.isDirectory()) throw new Error("MSYS2 sourceRoot must be an existing directory.");
  const pacmanCandidate = join(installationRoot, "usr/bin", process.platform === "win32" ? "pacman.exe" : "pacman");
  const pacman = (await Bun.file(pacmanCandidate).exists()) ? pacmanCandidate : discoveredPacman;
  const registryPath = join(sourceRoot, "sources.json");
  const registry = await readObject(registryPath);
  const declared = isObject(registry.sources) ? registry.sources : {};
  const rootCatalog = await readObject(join(import.meta.dir, "sources.json"));
  const rootSources: RootSource[] = Array.isArray(rootCatalog.sources)
    ? rootCatalog.sources.filter(
        (entry): entry is RootSource =>
          isObject(entry) &&
          typeof entry.id === "string" &&
          typeof entry.repository === "string" &&
          typeof entry.revision === "string",
      )
    : [];
  const topLevel = await entries(sourceRoot);
  const cachyosPath = join(sourceRoot, "cachyos");
  const cachyos = await lstat(cachyosPath).then(
    () => entries(cachyosPath),
    () => [],
  );
  const views = [...topLevel, ...cachyos].filter(entry => entry.type !== "file");
  const repositories: Awaited<ReturnType<typeof inspectRepository>>[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (;;) {
        const entry = views[cursor++];
        if (!entry) return;
        repositories.push(await inspectRepository(entry.path, rootSources));
      }
    }),
  );
  repositories.sort((a, b) => a.path.localeCompare(b.path));
  const registeredSources = Object.entries(declared).map(([id, value]) => {
    const record = isObject(value) ? value : {};
    const path = resolve(sourceRoot, typeof record.path === "string" ? record.path : id);
    const local = relative(sourceRoot, path);
    const external = isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`);
    return {
      id,
      path,
      origin: typeof record.origin === "string" ? publicRemote(record.origin) : null,
      upstream: typeof record.upstream === "string" ? publicRemote(record.upstream) : null,
      declaredStatus: typeof record.status === "string" ? record.status : null,
      externalReference: external,
      inspection: external
        ? "Configured reference outside sourceRoot; not traversed"
        : (repositories.find(repo => repo.path.toLowerCase() === path.toLowerCase()) ??
          "Not an initialized direct source view"),
    };
  });
  const packageQuery = async (flag: "-Q" | "-V") => {
    if (!pacman) return { code: null, stdout: "", error: "Native pacman not discovered" };
    try {
      const result = await runProcess([pacman, flag], sourceRoot, {
        timeoutMs: 15_000,
        maxOutputBytes: 2 * 1024 * 1024,
      });
      return { ...result, error: result.code === 0 ? null : "Native pacman read-only query failed" };
    } catch (error) {
      return { code: null, stdout: "", error: error instanceof Error ? error.message : String(error) };
    }
  };
  const [version, installed] = await Promise.all([packageQuery("-V"), packageQuery("-Q")]);
  const packages =
    installed.code === 0
      ? installed.stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .map(line => {
            const split = line.indexOf(" ");
            return { name: line.slice(0, split), version: line.slice(split + 1) };
          })
      : [];
  const bin = join(installationRoot, "usr/bin");
  const tools = await Promise.all(
    ["pacman.exe", "cym.exe", "bash.exe", "git.exe", "makepkg", "repo-add"].map(async name => ({
      name,
      path: join(bin, name),
      present: await Bun.file(join(bin, name)).exists(),
    })),
  );
  const cymSource = join(sourceRoot, "msys2-packages/cachyos-msys2");
  const cymManifest = await readObject(join(cymSource, "sources.json"));
  const homeContext = home
    ? {
        path: home,
        role: "Explicit native development user context, not a source root or Bun OS rootfs",
        topLevel: (await readdir(home, { withFileTypes: true })).map(entry => ({
          name: entry.name,
          type: entry.isSymbolicLink() ? "link" : entry.isDirectory() ? "directory" : "file",
        })),
        guidance: await Promise.all(["AGENTS.md", "README.md"].map(name => document(join(home, name)))),
        contentTraversal: false,
      }
    : null;
  return {
    schemaVersion: 1,
    kind: "bun-os-msys2-source-inspection",
    sourceRoot,
    sourceRootOrigin: options.sourceRoot ? "option" : Bun.env.APHRODY_MSYS2_SOURCE_ROOT ? "environment" : "pacman-path",
    installationRoot,
    home: homeContext,
    host: {
      platform: process.platform,
      architecture: process.arch,
      context:
        process.platform === "win32"
          ? "Native Windows MSYS2/Cygwin development and source laboratory"
          : "Source inspection on a non-Windows host; native MSYS2 execution is unqualified",
      nativeMsys2Detected:
        process.platform === "win32" && version.code === 0 && packages.some(pkg => pkg.name === "msys2-runtime"),
      archLinuxGlibcCompatible: false,
      sourceOnly: true,
      targetABIs: ["Windows PE/MSYS2-Cygwin", "MinGW Windows native when separately qualified"],
      linuxArtifactsQualified: false,
    },
    documents: await Promise.all(
      ["README.md", "sources.json", "GRAPH_REPORT.md", "AGENTS.md"].map(name => document(join(sourceRoot, name))),
    ),
    graphReport: {
      source: "graph:msys64",
      path: join(sourceRoot, "GRAPH_REPORT.md"),
      freshness: "Historical report; not rebuilt or verified against current source HEADs",
      graphPayloadRead: false,
    },
    topLevel,
    cachyos,
    registeredSources,
    repositories,
    sharedGitStores: repositories
      .filter(repo => repo.commonDirectory)
      .map(repo => ({ path: repo.path, commonDirectory: repo.commonDirectory })),
    pacman: {
      path: pacman,
      version: version.stdout.trim(),
      versionCode: version.code,
      versionError: version.error,
      packagesCode: installed.code,
      packagesError: installed.error,
      packages,
      operations: ["-V", "-Q"],
    },
    capabilities: {
      tools,
      knownPackages: packages.filter(pkg =>
        /^(?:pacman|msys2-runtime|cachyos-msys2|bash|git|mingw.*|rust.*|clang.*|cmake|ninja|meson)$/.test(pkg.name),
      ),
      cym: {
        source: cymSource,
        entrypoint: await document(join(cymSource, "cym.ts")),
        recipe: await document(join(cymSource, "PKGBUILD")),
        implementation: (await Bun.file(join(cymSource, "cym.ts")).exists())
          ? "Existing Bun TypeScript CLI compiled to a native executable; not a new Rust runner"
          : "Source entrypoint unavailable",
        role: "Existing CachyOS/Omarchy/MSYS2/Bun Engine pipeline owner",
        manifest: cymManifest,
        executed: false,
        installedBinarySourceParity: "Not verified by source presence or installed package version",
      },
    },
    mutation: false,
    qualified: false,
    policy: {
      preserveCheckoutsAndJunctions: true,
      preserveDirtySources: true,
      noNewForksOrClones: true,
      noProviderStateTraversal: true,
      noPackageInstallOrUpdate: true,
      noBuilds: true,
      noWsl: true,
      rootReuse:
        "Match existing upstream identities and exact pins; fork lineage or similar names do not establish identical source roles or qualified artifacts",
    },
  };
}

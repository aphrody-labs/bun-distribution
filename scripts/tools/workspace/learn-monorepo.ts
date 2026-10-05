import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type Entry = { path: string; kind: "file" | "dir"; size?: number };
const infra = resolve(import.meta.dir, "..", "..", "..");
const scope = JSON.parse(await Bun.file(join(infra, "config", "knowledge-scope.json")).text()) as {
  repositoryDiscovery: { standaloneFallback: string; includeUnpinnedLocalCheckouts: boolean };
  exclude: string[];
};
const runId = `${new Date()
  .toISOString()
  .replaceAll(/[-:.TZ]/g, "")
  .slice(0, 14)}-${process.pid}`;
const runDir = join(infra, "var", "runs", runId);
for (const dir of ["pending", "results", "logs", "evidence"])
  await mkdir(join(runDir, dir), { recursive: true });

const excluded = new Set(scope.exclude.filter((value) => !value.includes("*")));
const secretLike = /(^|\/)(\.env(?:\.|$)|secrets?|credentials?|cookies?)(\/|$)/i;
const generatedLike =
  /(^|\/)(node_modules|target|\.next|dist|build|\.turbo|\.cache|var|data|assets|public|vendor|vendors|backups|artifacts)(\/|$)/i;
function git(args: string[], cwd: string) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

async function discoverRepositories() {
  const superproject = git(["rev-parse", "--show-superproject-working-tree"], infra);
  const workspace =
    superproject ||
    (scope.repositoryDiscovery.standaloneFallback === "infra-repository" ? infra : "");
  if (!workspace)
    return [{ name: "aphrody-infra", path: infra, pinned: false, source: "standalone" }];

  const discovered = new Map<
    string,
    { name: string; path: string; pinned: boolean; source: string }
  >();
  const gitlinks = git(["ls-files", "--stage"], workspace);
  for (const line of gitlinks.split("\n")) {
    const match = /^160000 ([0-9a-f]+) \d+\t(.+)$/.exec(line);
    if (!match) continue;
    const path = match[2];
    discovered.set(path, {
      name: path.split("/").at(-1) ?? path,
      path: join(workspace, path),
      pinned: true,
      source: "superproject-gitlink",
    });
  }

  if (scope.repositoryDiscovery.includeUnpinnedLocalCheckouts) {
    let children: Awaited<ReturnType<typeof readdir>> = [];
    try {
      children = await readdir(workspace, { withFileTypes: true });
    } catch {
      /* unavailable workspace */
    }
    for (const child of children) {
      if (!child.isDirectory() || child.name === ".git") continue;
      const path = join(workspace, child.name);
      try {
        const marker = await stat(join(path, ".git"));
        if (marker.isDirectory() || marker.isFile())
          discovered.set(
            child.name,
            discovered.get(child.name) ?? {
              name: child.name,
              path,
              pinned: false,
              source: "local-checkout",
            },
          );
      } catch {
        /* ordinary workspace directory */
      }
    }
  }
  if (!discovered.has("aphrody-infra"))
    discovered.set("aphrody-infra", {
      name: "aphrody-infra",
      path: infra,
      pinned: false,
      source: "infra-checkout",
    });
  return [...discovered.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

async function walk(dir: string, base = dir, entries: Entry[] = []): Promise<Entry[]> {
  let children: Awaited<ReturnType<typeof readdir>>;
  try {
    children = await readdir(dir, { withFileTypes: true });
  } catch {
    return entries;
  }
  await Promise.all(
    children.map(async (child) => {
      const path = join(dir, child.name);
      const rel = relative(base, path).replaceAll("\\", "/");
      if (excluded.has(child.name) || secretLike.test(rel) || generatedLike.test(rel)) return;
      if (child.isDirectory()) {
        entries.push({ path: rel, kind: "dir" });
        await walk(path, base, entries);
      } else if (child.isFile()) {
        const info = await stat(path);
        entries.push({ path: rel, kind: "file", size: info.size });
      }
    }),
  );
  return entries;
}

async function parseJson(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}
async function inspect(repo: { name: string; path: string; pinned: boolean; source: string }) {
  const { name, path, pinned, source } = repo;
  try {
    if (!(await stat(path)).isDirectory()) throw new Error("not a directory");
  } catch {
    return { name, found: false, pinned, source, capabilities: [], files: 0 };
  }
  const entries = await walk(path);
  const files = entries.filter((entry) => entry.kind === "file");
  const extensions = Object.entries(
    files.reduce<Record<string, number>>((acc, file) => {
      const ext = file.path.includes(".")
        ? file.path.slice(file.path.lastIndexOf(".")).toLowerCase()
        : "[no-ext]";
      acc[ext] = (acc[ext] ?? 0) + 1;
      return acc;
    }, {}),
  ).toSorted((a, b) => b[1] - a[1]);
  const pkg = await parseJson(join(path, "package.json"));
  const capabilities = [
    files.some((file) => /(^|\/)(apps|packages|src)(\/|$)/.test(file.path)) && "application-source",
    files.some((file) => /(^|\/)(docs|README|AGENTS|CLAUDE|GEMINI)/i.test(file.path)) &&
      "documentation",
    files.some((file) => /(^|\/)(test|tests|__tests__)(\/|$)/.test(file.path)) && "tests",
    files.some((file) => /\.ya?ml$/.test(file.path) && file.path.includes(".github/workflows")) &&
      "ci",
    files.some((file) => /(^|\/)(Cargo\.toml|rust-toolchain)/.test(file.path)) && "rust",
    files.some((file) => /(^|\/)(package\.json|bun\.lock)/.test(file.path)) && "bun-typescript",
    files.some((file) => /(^|\/)(pyproject\.toml|uv\.lock)/.test(file.path)) && "python-uv",
  ].filter(Boolean);
  return {
    name,
    found: true,
    pinned,
    source,
    path,
    files: files.length,
    bytes: files.reduce((sum, file) => sum + (file.size ?? 0), 0),
    extensions,
    capabilities,
    package: pkg
      ? { name: pkg.name, version: pkg.version, scripts: Object.keys(pkg.scripts ?? {}) }
      : undefined,
  };
}

const repos = await Promise.all((await discoverRepositories()).map(inspect));
const summary = {
  schemaVersion: 1,
  runId,
  scope: "metadata-and-public-contracts-only",
  repositories: repos,
  generatedAt: new Date().toISOString(),
};
await Bun.write(join(runDir, "results", "repo-summary.json"), JSON.stringify(summary, null, 2));
await Bun.write(
  join(runDir, "results", "capabilities.json"),
  JSON.stringify(
    repos.map(({ name, found, capabilities }) => ({ name, found, capabilities })),
    null,
    2,
  ),
);
await Bun.write(
  join(runDir, "results", "package-surface.json"),
  JSON.stringify(
    repos.map(({ name, package: pkg }) => ({ name, package: pkg })),
    null,
    2,
  ),
);
await Bun.write(
  join(runDir, "manifest.json"),
  JSON.stringify(
    {
      run_id: runId,
      requested_scope: "learn-production-monorepo",
      tool_versions: { bun: Bun.version },
      inputs: scope,
      actions: [{ name: "async-repository-index", status: "success", repositories: repos.length }],
      outputs: [
        "results/repo-summary.json",
        "results/capabilities.json",
        "results/package-surface.json",
      ],
      status: "success",
      evidence: ["metadata-only", "excluded-secrets-and-generated-trees"],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      runId,
      repositories: repos.length,
      found: repos.filter((repo) => repo.found).length,
      output: runDir,
    },
    null,
    2,
  ),
);

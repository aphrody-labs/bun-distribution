// SPDX-License-Identifier: Apache-2.0
/** Inventory the current checkout, never a historical migration source map. */
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile, lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { markdownLinkDestinations } from "./docs-links.ts";
import { cleanWorkspace } from "./workspace-clean.ts";

type Manifest = {
  path: string;
  name: string;
  scripts: Record<string, string>;
  dependencies: string[];
};
type Issue = { path: string; target: string; kind: string };
function git(root: string, ...args: string[]): string {
  const p = Bun.spawnSync(["git", "-C", root, ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode !== 0) throw new Error(new TextDecoder().decode(p.stderr));
  return new TextDecoder().decode(p.stdout);
}
async function hash(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest("hex");
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export async function scanRepository(root: string) {
  root = resolve(root);
  const files = git(root, "ls-files", "-z").split("\0").filter(Boolean);
  const existing: { path: string; bytes: number }[] = [];
  const missingTracked: string[] = [];
  const infos = await Promise.all(
    files.map((path) => lstat(join(root, path)).catch(() => undefined)),
  );
  for (const [index, path] of files.entries()) {
    const info = infos[index];
    if (!info) missingTracked.push(path);
    else if (info.isFile()) existing.push({ path, bytes: info.size });
  }
  const bySize = new Map<number, typeof existing>();
  for (const entry of existing) {
    if (!entry.bytes) continue;
    const group = bySize.get(entry.bytes) ?? [];
    group.push(entry);
    bySize.set(entry.bytes, group);
  }
  const duplicates: { sha256: string; bytes: number; paths: string[] }[] = [];
  for (const [bytes, entries] of bySize) {
    if (entries.length < 2) continue;
    const groups = new Map<string, string[]>();
    for (const entry of entries) {
      // oxlint-disable-next-line no-await-in-loop -- hachage séquentiel : un seul gros fichier est lu en mémoire à la fois
      const digest = await hash(join(root, entry.path));
      const group = groups.get(digest) ?? [];
      group.push(entry.path);
      groups.set(digest, group);
    }
    for (const [sha256, paths] of groups)
      if (paths.length > 1) duplicates.push({ sha256, bytes, paths });
  }
  const rootPackage = await Bun.file(join(root, "package.json")).json();
  const declared = Array.isArray(rootPackage.workspaces)
    ? rootPackage.workspaces
    : (rootPackage.workspaces?.packages ?? []);
  const bun: Manifest[] = [],
    unmatched: string[] = [];
  const patterns = declared as string[];
  const matches = await Promise.all(
    patterns.map((pattern) =>
      Array.fromAsync(
        new Bun.Glob(`${pattern}/package.json`).scan({
          cwd: root,
          onlyFiles: true,
        }),
      ),
    ),
  );
  for (const [index, pattern] of patterns.entries()) {
    if (!matches[index]!.length) unmatched.push(pattern);
  }
  const manifests = await Promise.all(
    matches
      .flat()
      .map(async (path) => ({
        path,
        pkg: await Bun.file(join(root, path)).json(),
      })),
  );
  for (const { path, pkg } of manifests) {
    bun.push({
      path,
      name: String(pkg.name ?? ""),
      scripts: pkg.scripts ?? {},
      dependencies: Object.keys({
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      }),
    });
  }
  const packages = [...new Map(bun.map((p) => [p.path, p])).values()].toSorted(
    (a, b) => a.path.localeCompare(b.path),
  );
  const names = new Map<string, string[]>();
  for (const p of packages) {
    const paths = names.get(p.name) ?? [];
    paths.push(p.path);
    names.set(p.name, paths);
  }
  const cargo: { path: string; name: string; dependencies: string[] }[] = [];
  const issues: Issue[] = [];
  const docsIssues: Issue[] = [],
    legacyReferences: Issue[] = [];
  const parseErrors: { path: string; error: string }[] = [];
  for (const entry of existing) {
    const path = entry.path;
    if (
      path.startsWith("upstream/") ||
      path.startsWith("docs/") ||
      path.includes("/templates/") ||
      path.startsWith("templates/")
    )
      continue;
    if (path.endsWith("Cargo.toml")) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- lecture séquentielle des manifestes : borne les descripteurs ouverts sur un dépôt entier et garde l'ordre des rapports
        const manifest = object(
          Bun.TOML.parse(await readFile(join(root, path), "utf8")),
        );
        const pkg = object(manifest.package);
        const dependencies = {
          ...object(manifest.dependencies),
          ...object(manifest["dev-dependencies"]),
          ...object(manifest["build-dependencies"]),
        };
        if (pkg.name)
          cargo.push({
            path,
            name: String(pkg.name),
            dependencies: Object.keys(dependencies),
          });
        function walk(value: unknown): void {
          const v = object(value);
          if (typeof v.path === "string") {
            const dest = resolve(root, dirname(path), v.path);
            if (!existsSync(join(dest, "Cargo.toml")))
              issues.push({
                path,
                target: relative(root, dest),
                kind: "cargo-path",
              });
          }
          for (const child of Object.values(v))
            if (child && typeof child === "object") walk(child);
        }
        // Dependency tables only: lib/bin `path` values name source files.
        for (const key of [
          "dependencies",
          "dev-dependencies",
          "build-dependencies",
          "target",
        ])
          walk(manifest[key]);
        if (path === "Cargo.toml")
          walk(object(manifest.workspace).dependencies);
      } catch (error) {
        parseErrors.push({ path, error: String(error) });
      }
    }
    if (
      /\.(md|ts|tsx|rs|py|sh|nu|ps1|json|toml|service)$/.test(path) &&
      !path.startsWith("docs/migration/")
    ) {
      // oxlint-disable-next-line no-await-in-loop -- lecture séquentielle des fichiers : borne les descripteurs ouverts sur un dépôt entier et garde l'ordre des rapports
      const content = await readFile(join(root, path), "utf8");
      if (
        !path.startsWith("docs/") &&
        !path.endsWith(".md") &&
        /(?:\/home\/aphro\/src|src\/aphrody-(?:infra|ai|os|ui|web))/.test(
          content,
        )
      )
        legacyReferences.push({
          path,
          target: "legacy src checkout",
          kind: "active-legacy-reference",
        });
      if (path.endsWith(".md")) {
        for (const target of markdownLinkDestinations(
          content.replace(/```[\s\S]*?```/g, ""),
        )) {
          if (!target || /^(?:https?:|mailto:|#|\/)/.test(target)) continue;
          let clean: string;
          try {
            clean = decodeURIComponent(target.split("#")[0] ?? "");
          } catch {
            docsIssues.push({ path, target, kind: "invalid-url-encoding" });
            continue;
          }
          if (!clean) continue;
          // oxlint-disable-next-line no-await-in-loop -- contrôle séquentiel des liens : borne les accès disque et garde l'ordre des rapports
          if (
            !(await lstat(resolve(root, dirname(path), clean)).catch(
              () => undefined,
            ))
          )
            docsIssues.push({ path, target, kind: "missing-local-link" });
        }
      }
    }
  }
  const cache = await cleanWorkspace(root);
  return {
    schemaVersion: 1,
    at: new Date().toISOString(),
    root,
    git: {
      head: git(root, "rev-parse", "HEAD").trim(),
      branch: git(root, "branch", "--show-current").trim(),
      status: git(root, "status", "--porcelain=v1")
        .trim()
        .split("\n")
        .filter(Boolean),
      remotes: git(root, "remote", "-v").trim().split("\n").filter(Boolean),
    },
    files: {
      tracked: files.length,
      existing: existing.length,
      missingTracked,
      bytes: existing.reduce((n, f) => n + f.bytes, 0),
    },
    bun: {
      packages,
      unmatchedPatterns: unmatched,
      duplicateNames: [...names].filter(([, p]) => p.length > 1),
    },
    cargo: { packages: cargo, missingPaths: issues, parseErrors },
    documentation: { missingLinks: docsIssues },
    legacyReferences,
    exactDuplicates: duplicates,
    cleanup: cache,
    summary: {
      bunPackages: packages.length,
      cargoManifests: cargo.length,
      duplicateGroups: duplicates.length,
      duplicateBytes: duplicates.reduce(
        (n, g) => n + g.bytes * (g.paths.length - 1),
        0,
      ),
      missingCargoPaths: issues.length,
      missingDocLinks: docsIssues.length,
      activeLegacyReferences: legacyReferences.length,
      generatedDirectories: cache.removed.length,
    },
  };
}
export async function runRepositoryState(args: string[]): Promise<number> {
  let root = process.cwd(),
    out: string | undefined,
    json = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") root = args[++i] ?? "";
    else if (args[i] === "--out") out = args[++i];
    else if (args[i] === "--json") json = true;
    else if (args[i] === "--help") {
      console.log(
        "Usage: yolo ops repository-state [--root path] [--out report.json] [--json]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${args[i]}`);
  }
  const report = await scanRepository(root);
  if (out) {
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(out, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify(json ? report : report.summary, null, 2));
  return 0;
}
if (import.meta.main)
  process.exit(await runRepositoryState(process.argv.slice(2)));

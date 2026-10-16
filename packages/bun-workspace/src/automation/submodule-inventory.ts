// SPDX-License-Identifier: Apache-2.0
/** Read Gitlink and .gitmodules state without initializing or modifying submodules. */
import { execFileSync } from "@aphrody/update/process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, readFile, readlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Glob } from "bun";

export type SubmoduleRoot = { key: string; path: string };

type Declaration = {
  name: string;
  path: string;
  url?: string;
  branch?: string;
};
export type Submodule = {
  root: string;
  path: string;
  depth: number;
  name?: string;
  url?: string;
  branch?: string;
  indexPin?: string;
  headPin?: string;
  observedHead?: string;
  dirtyPathCount?: number;
  state: string;
};

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function classifyNestedFile(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  if (/^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:\.|$)/i.test(name)) return "license";
  if (
    /^(?:Cargo\.toml|package\.json|pyproject\.toml|bun\.lock|Cargo\.lock|pnpm-workspace\.yaml|tsconfig\.json)$/.test(
      name,
    )
  )
    return "manifest-or-lockfile";
  if (/\.(?:md|mdx|rst|adoc|txt|pdf)$/i.test(name)) return "documentation";
  if (path.split("/").some(part => part === "scripts" || part === "script")) return "script";
  if (name.endsWith(".rs")) return "rust-source";
  if (path.startsWith("crates/")) return "crate-file";
  if (path.startsWith("packages/")) return "package-file";
  if (path.startsWith("apps/")) return "app-file";
  return "source-or-config";
}

function fileObjects(root: string, args: string[]): Map<string, { mode: string; oid: string }> {
  const result = new Map<string, { mode: string; oid: string }>();
  const raw = git(root, args);
  if (!raw) return result;
  for (const item of raw.split("\0")) {
    const match = /^(\d{6}) (?:\w+ )?([0-9a-f]{40})(?: 0)?\t(.+)$/.exec(item);
    if (match) result.set(match[3]!, { mode: match[1]!, oid: match[2]! });
  }
  return result;
}

function fileStatuses(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const raw = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (raw === null) return result;
  const records = raw.split("\0");
  for (let i = 0; i < records.length; i++) {
    const item = records[i]!;
    if (item.length < 4) continue;
    const code = item.slice(0, 2);
    result.set(item.slice(3), code);
    if (/[RC]/.test(code)) i++;
  }
  return result;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function manifestSummary(path: string, content: Buffer): Record<string, unknown> | null {
  const name = path.split("/").at(-1);
  if (!name || !["Cargo.toml", "package.json", "pyproject.toml", "pnpm-workspace.yaml"].includes(name)) return null;
  try {
    const text = content.toString("utf8");
    const parsed = name.endsWith(".toml")
      ? object(Bun.TOML.parse(text))
      : name.endsWith(".yaml")
        ? object(Bun.YAML.parse(text))
        : object(JSON.parse(text));
    if (name === "Cargo.toml") {
      const workspace = object(parsed.workspace);
      const pkg = object(parsed.package);
      return {
        path,
        format: "cargo",
        workspaceDeclared: "workspace" in parsed,
        members: strings(workspace.members),
        exclude: strings(workspace.exclude),
        defaultMembers: strings(workspace["default-members"]),
        ...(typeof pkg.name === "string" ? { packageName: pkg.name } : {}),
        ...(typeof pkg.license === "string" ? { license: pkg.license } : {}),
        ...(typeof pkg["license-file"] === "string" ? { licenseFile: pkg["license-file"] } : {}),
      };
    }
    if (name === "package.json") {
      const workspaces = Array.isArray(parsed.workspaces) ? parsed.workspaces : object(parsed.workspaces).packages;
      return {
        path,
        format: "bun-or-node",
        workspaceDeclared: "workspaces" in parsed,
        members: strings(workspaces),
        ...(typeof parsed.name === "string" ? { packageName: parsed.name } : {}),
        ...(typeof parsed.license === "string" ? { license: parsed.license } : {}),
        ...(typeof parsed.private === "boolean" ? { private: parsed.private } : {}),
        ...(typeof parsed.packageManager === "string" ? { packageManager: parsed.packageManager } : {}),
      };
    }
    if (name === "pyproject.toml") {
      const project = object(parsed.project);
      const uv = object(object(object(parsed.tool).uv).workspace);
      return {
        path,
        format: "python",
        workspaceDeclared: Object.keys(uv).length > 0,
        members: strings(uv.members),
        exclude: strings(uv.exclude),
        ...(typeof project.name === "string" ? { packageName: project.name } : {}),
      };
    }
    return {
      path,
      format: "pnpm",
      workspaceDeclared: true,
      members: strings(parsed.packages),
    };
  } catch (error) {
    return { path, format: name, parseError: String(error) };
  }
}

export async function inventoryNestedFiles(submodules: Submodule[], roots: SubmoduleRoot[]) {
  const rootPaths = new Map(roots.map(root => [root.key, resolve(root.path)]));
  const checkoutPaths = new Map<string, string>();
  const entries: Array<Record<string, unknown>> = [];
  const checkoutSummaries: Array<Record<string, unknown>> = [];
  const manifests: Array<Record<string, unknown>> = [];
  for (const submodule of submodules) {
    if (submodule.depth < 2 || !submodule.observedHead || submodule.path.startsWith("aphrody-ui/")) continue;
    const rootPath = rootPaths.get(submodule.root);
    if (!rootPath) continue;
    const checkout = resolve(rootPath, submodule.path);
    if (!checkout.startsWith(`${rootPath}/`)) continue;
    checkoutPaths.set(submodule.path, checkout);
    const raw = git(checkout, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
    if (raw === null) continue;
    const paths = [...new Set(raw.split("\0").filter(Boolean))].toSorted();
    const indexed = fileObjects(checkout, ["ls-files", "--stage", "-z"]);
    const committed = fileObjects(checkout, ["ls-tree", "-r", "-z", "HEAD"]);
    const statuses = fileStatuses(checkout);
    let regularFiles = 0;
    let missingFiles = 0;
    for (const path of paths) {
      const file = resolve(checkout, path);
      if (!file.startsWith(`${checkout}/`)) continue;
      const index = indexed.get(path);
      const head = committed.get(path);
      const entry: Record<string, unknown> = {
        source: `${submodule.path}/${path}`,
        submodule: submodule.path,
        relativePath: path,
        kind: classifyNestedFile(path),
        status: statuses.get(path) ?? "clean",
        ...(index ? { indexMode: index.mode, indexOid: index.oid } : {}),
        ...(head ? { headMode: head.mode, headOid: head.oid } : {}),
        target: null,
      };
      try {
        // oxlint-disable-next-line no-await-in-loop -- inventaire séquentiel des fichiers imbriqués : un fichier à la fois pour borner les descripteurs et garder l'ordre des entrées
        const metadata = await lstat(file);
        if (metadata.isSymbolicLink()) {
          // oxlint-disable-next-line no-await-in-loop -- inventaire séquentiel des fichiers imbriqués : un fichier à la fois pour borner les descripteurs et garder l'ordre des entrées
          const link = await readlink(file);
          entry.kind = "symlink";
          entry.size = Buffer.byteLength(link);
          entry.sha256 = createHash("sha256").update(link).digest("hex");
          entry.linkTarget = link;
        } else if (metadata.isFile()) {
          // oxlint-disable-next-line no-await-in-loop -- inventaire séquentiel des fichiers imbriqués : un fichier à la fois pour borner les descripteurs et garder l'ordre des entrées
          const bytes = await readFile(file);
          entry.size = bytes.length;
          entry.sha256 = createHash("sha256").update(bytes).digest("hex");
          const manifest = manifestSummary(path, bytes);
          if (manifest) manifests.push({ submodule: submodule.path, ...manifest });
          regularFiles++;
        } else {
          entry.kind = "gitlink";
          entry.size = null;
        }
      } catch {
        entry.status = "missing";
        entry.size = null;
        missingFiles++;
      }
      entries.push(entry);
    }
    checkoutSummaries.push({
      path: submodule.path,
      head: submodule.observedHead,
      indexPin: submodule.indexPin,
      dirtyPathCount: submodule.dirtyPathCount,
      paths: paths.length,
      regularFiles,
      missingFiles,
    });
  }
  const memberResolutions: Array<Record<string, unknown>> = [];
  for (const manifest of manifests) {
    if (manifest.workspaceDeclared !== true) continue;
    const checkout = checkoutPaths.get(manifest.submodule as string);
    if (!checkout) continue;
    const workspace = resolve(checkout, dirname(manifest.path as string));
    const expected = manifest.format === "cargo" ? "Cargo.toml" : "package.json";
    for (const pattern of strings(manifest.members)) {
      const candidatePaths = /[*?[\]{}]/.test(pattern)
        ? [
            ...new Glob(pattern).scanSync({
              cwd: workspace,
              onlyFiles: false,
              followSymlinks: false,
            }),
          ]
        : [pattern];
      const matches = candidatePaths
        .filter(candidate => {
          const directory = resolve(workspace, candidate);
          return (
            (directory === workspace || directory.startsWith(`${workspace}/`)) && existsSync(join(directory, expected))
          );
        })
        .toSorted();
      memberResolutions.push({
        submodule: manifest.submodule,
        manifest: manifest.path,
        pattern,
        matches,
        ...(matches.length === 0 ? { unresolved: "no-member-manifest" } : {}),
      });
    }
  }
  return {
    observedAt: new Date().toISOString(),
    scope:
      "Initialized nested non-UI checkouts; tracked and untracked paths, working-file SHA-256, index and HEAD objects. No target files imported.",
    checkouts: checkoutSummaries,
    manifests,
    memberResolutions,
    totals: {
      checkouts: checkoutSummaries.length,
      paths: entries.length,
      parsedManifests: manifests.filter(manifest => !("parseError" in manifest)).length,
      manifestParseFailures: manifests.filter(manifest => "parseError" in manifest).length,
      declaredWorkspaces: manifests.filter(manifest => manifest.workspaceDeclared === true).length,
      memberPatterns: memberResolutions.length,
      unresolvedMemberPatterns: memberResolutions.filter(member => "unresolved" in member).length,
      byKind: Object.fromEntries(
        [...new Set(entries.map(entry => entry.kind as string))]
          .toSorted()
          .map(kind => [kind, entries.filter(entry => entry.kind === kind).length]),
      ),
    },
    entries,
  };
}

function declarations(root: string): Map<string, Declaration> {
  const result = new Map<string, Declaration>();
  const file = join(root, ".gitmodules");
  if (!existsSync(file)) return result;
  const raw = git(root, ["config", "--null", "-f", file, "--get-regexp", "^submodule\\..*\\.(path|url|branch)$"]);
  if (!raw) return result;
  const byName = new Map<string, Partial<Declaration>>();
  for (const item of raw.split("\0")) {
    const splitAt = item.indexOf("\n");
    if (splitAt < 0) continue;
    const key = item.slice(0, splitAt);
    const value = item.slice(splitAt + 1);
    const match = /^submodule\.(.+)\.(path|url|branch)$/.exec(key);
    if (!match) continue;
    const name = match[1]!;
    const record = byName.get(name) ?? { name };
    record[match[2]! as "path" | "url" | "branch"] = value;
    byName.set(name, record);
  }
  for (const record of byName.values()) {
    if (record.name && record.path) result.set(record.path, record as Declaration);
  }
  return result;
}

function gitlinks(root: string, args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const raw = git(root, args);
  if (!raw) return result;
  for (const item of raw.split("\0")) {
    const match = /^160000 (?:commit )?([0-9a-f]{40})(?: 0)?\t(.+)$/.exec(item);
    if (match) result.set(match[2]!, match[1]!);
  }
  return result;
}

export function inventorySubmodules(roots: SubmoduleRoot[]): {
  observedAt: string;
  scope: string;
  submodules: Submodule[];
  missingRoots: Array<{ key: string; path: string; state: string }>;
  counts: Record<string, number>;
} {
  const submodules: Submodule[] = [];
  const missingRoots: Array<{ key: string; path: string; state: string }> = [];
  const visited = new Set<string>();

  function walk(rootKey: string, root: string, prefix: string, depth: number): void {
    const top = resolve(root);
    if (visited.has(top)) return;
    visited.add(top);
    const declared = declarations(top);
    const indexed = gitlinks(top, ["ls-files", "--stage", "-z"]);
    const committed = gitlinks(top, ["ls-tree", "-r", "-z", "HEAD"]);
    const paths = new Set([...declared.keys(), ...indexed.keys(), ...committed.keys()]);
    for (const path of [...paths].toSorted()) {
      const location = resolve(top, path);
      const relativePath = join(prefix, path).replaceAll("\\", "/");
      const declaration = declared.get(path);
      const indexPin = indexed.get(path);
      const headPin = committed.get(path);
      const record: Submodule = {
        root: rootKey,
        path: relativePath,
        depth,
        ...(declaration?.name ? { name: declaration.name } : {}),
        ...(declaration?.url ? { url: declaration.url } : {}),
        ...(declaration?.branch ? { branch: declaration.branch } : {}),
        ...(indexPin ? { indexPin } : {}),
        ...(headPin ? { headPin } : {}),
        state: "uninitialized",
      };
      if (!location.startsWith(`${top}/`)) record.state = "invalid-path";
      else if (rootKey === "src-root-docs" && relativePath === "aphrody-ui") record.state = "delegated-uninspected";
      else if (!indexPin && !headPin) record.state = "declaration-only";
      else if (!declaration) record.state = "gitlink-without-declaration";
      if (
        record.state !== "invalid-path" &&
        record.state !== "delegated-uninspected" &&
        existsSync(join(location, ".git"))
      ) {
        const actualTop = git(location, ["rev-parse", "--show-toplevel"])?.trim();
        if (actualTop === location) {
          const observedHead = git(location, ["rev-parse", "HEAD"])?.trim();
          if (observedHead) record.observedHead = observedHead;
          const status = git(location, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
          if (status !== null) record.dirtyPathCount = status.split("\0").filter(Boolean).length;
          record.state = !declaration
            ? "gitlink-without-declaration"
            : !indexPin
              ? "declaration-only"
              : observedHead === indexPin
                ? "matching-index"
                : "head-differs-from-index";
          walk(rootKey, location, relativePath, depth + 1);
        }
      }
      submodules.push(record);
    }
  }

  for (const root of roots) {
    if (root.key === "aphrody-ui") continue;
    const path = resolve(root.path);
    if (!existsSync(join(path, ".git"))) {
      missingRoots.push({ key: root.key, path, state: "checkout-not-on-disk" });
      continue;
    }
    walk(root.key, path, "", 1);
  }
  submodules.sort((a, b) => a.path.localeCompare(b.path) || a.root.localeCompare(b.root));
  const states = [...new Set(submodules.map(entry => entry.state))].toSorted();
  return {
    observedAt: new Date().toISOString(),
    scope:
      "Gitlink and .gitmodules metadata; initialized non-UI checkouts inspected recursively. aphrody-ui is delegated and uninspected.",
    submodules,
    missingRoots,
    counts: Object.fromEntries(states.map(state => [state, submodules.filter(entry => entry.state === state).length])),
  };
}

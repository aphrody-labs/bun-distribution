// SPDX-License-Identifier: Apache-2.0
/** Snapshot extraction inputs without changing any source checkout. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { inventoryNestedFiles, inventorySubmodules } from "./submodule-inventory.ts";
import { importInfraConfig } from "./infra-config-import.ts";
import { importInfraScripts } from "./infra-scripts-import.ts";

type Mode = "extract" | "orchestrator-split" | "upstream-pinned" | "deferred" | "classify";
type RootSpec = { key: string; path: string; owner: string; mode: Mode; rootDocsOnly?: boolean };
type Entry = {
  source: string;
  kind: string;
  category?: string;
  size: number | null;
  status: string;
  sha256?: string;
  target: string | null;
  importedTarget?: string;
  importedSha256?: string;
  importedSourceSha256?: string;
  duplicateOf?: string;
};
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".adoc", ".txt", ".pdf"]);
const SCRIPT_EXTENSIONS = new Set([
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".sh",
  ".bash",
  ".nu",
  ".py",
  ".ps1",
]);
const EXTERNAL_PARTS = new Set(["vendor", "third_party", "thirdparty", "upstream", "node_modules"]);

function git(root: string, args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
}
function argsOf(args: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--help" || arg === "-h") continue;
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    result.set(arg, value);
  }
  return result;
}
function classifyDoc(path: string): string {
  const lower = path.toLowerCase();
  if (/\b(plan|roadmap|backlog)\b/.test(lower) || /(^|\/)plans?\//.test(lower)) return "plans";
  if (/architect|design|system-map/.test(lower)) return "architecture";
  if (/api|protocol|schema|contract|format/.test(lower)) return "apis";
  if (/decision|adr|rfc/.test(lower)) return "decisions";
  if (/guide|tutorial|howto|contribut|setup|install/.test(lower)) return "guides";
  if (/deploy|operations?|infra|release|ci-cd|runbook/.test(lower)) return "operations";
  if (/audit|research|report|benchmark|security|parity/.test(lower)) return "research";
  if (/readme|product|app\//.test(lower)) return "products";
  return "reference";
}
function classifyScript(path: string): string {
  const s = path.toLowerCase();
  if (/audit|check|lint|test|verify|scan|validate|doctor/.test(s)) return "audit";
  if (/release|publish|version|tag/.test(s)) return "release";
  if (/migrat|import|extract|transfer/.test(s)) return "migration";
  if (/build|bundle|compile|package/.test(s)) return "build";
  if (/dev|watch|serve|format/.test(s)) return "dev";
  return "tools";
}
function kindOf(path: string): { kind: string; category?: string } {
  const parts = path.split("/");
  const name = basename(path);
  const ext = name.includes(".") ? `.${name.split(".").at(-1)!.toLowerCase()}` : "";
  if (
    DOC_EXTENSIONS.has(ext) ||
    /^(AGENTS|CONTRIBUTING|ARCHITECTURE|PLAN|README)(\.|$)/i.test(name)
  )
    return { kind: "documentation", category: classifyDoc(path) };
  if (parts.includes("scripts") || parts.includes("script") || parts.includes("tools"))
    if (SCRIPT_EXTENSIONS.has(ext)) return { kind: "script", category: classifyScript(path) };
  if (name === "Cargo.toml") return { kind: "cargo-manifest" };
  if (name === "package.json") return { kind: "bun-manifest" };
  if (name === "pyproject.toml") return { kind: "python-manifest" };
  if (parts[0] === "packages") return { kind: "bun-package" };
  if (parts[0] === "apps") return { kind: "bun-app" };
  if (ext === ".rs") return { kind: "rust-source" };
  if (parts.includes("scripts") || parts.includes("script") || parts.includes("tools"))
    if (SCRIPT_EXTENSIONS.has(ext)) return { kind: "script", category: classifyScript(path) };
  if (parts[0] === "docs") return { kind: "documentation", category: classifyDoc(path) };
  return { kind: "source-or-config" };
}
function safeKey(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}
function targetPath(owner: string, path: string, info: ReturnType<typeof kindOf>): string | null {
  const parts = path.split("/");
  const ext = basename(path).split(".").at(-1)?.toLowerCase();
  if (info.kind === "documentation") {
    const remainder = parts[0] === "docs" ? parts.slice(1).join("/") : path;
    return `docs/${info.category ?? "reference"}/${owner}/${remainder || basename(path)}`;
  }
  if (ext === "py" || ext === "pyi" || ext === "ipynb")
    return `../aphrody-py/${parts[0] === "scripts" ? "tools" : parts[0] === "apps" ? "apps" : "packages"}/${owner}/${path}`;
  if (info.kind === "script") return `scripts/${info.category ?? "tools"}/${owner}/${path}`;
  if (info.kind === "rust-source") {
    const remainder =
      parts[0] === "crates"
        ? parts.slice(1).join("/")
        : parts[0] === "apps"
          ? `apps/${parts.slice(1).join("/")}`
          : path;
    return `crates/${owner}/${remainder}`;
  }
  if (info.kind === "bun-package") return `packages/${owner}/${path.slice("packages/".length)}`;
  if (info.kind === "bun-app") return `apps/${owner}/${path.slice("apps/".length)}`;
  if (info.kind === "cargo-manifest" && ["crates", "apps"].includes(parts[0]!)) {
    const remainder =
      parts[0] === "crates" ? parts.slice(1).join("/") : `apps/${parts.slice(1).join("/")}`;
    return `crates/${owner}/${remainder}`;
  }
  if (info.kind === "bun-manifest" && ["packages", "apps"].includes(parts[0]!)) {
    const kind = parts[0] === "crates" ? "crates" : parts[0]!;
    return `${kind}/${owner}/${path.slice(kind.length + 1)}`;
  }
  if (parts[0] === "crates") return `crates/${owner}/${parts.slice(1).join("/")}`;
  if (parts[0] === "packages") return `packages/${owner}/${parts.slice(1).join("/")}`;
  if (parts[0] === "apps") return `apps/${owner}/${parts.slice(1).join("/")}`;
  if (info.kind.endsWith("manifest")) return `migration/manifests/${owner}/${path}`;
  return `migration/source-refs/${owner}/${path}`;
}
function parseStatus(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of raw.split("\0")) {
    if (item.length < 4) continue;
    result.set(safeKey(item.slice(3)), item.slice(0, 2).trim() || "M");
  }
  return result;
}

async function rootSnapshot(
  spec: RootSpec,
): Promise<{ root: Record<string, unknown>; entries: Entry[] }> {
  const top = resolve(spec.path);
  const gitRoot = resolve(git(top, ["rev-parse", "--show-toplevel"]).trim());
  const head = git(gitRoot, ["rev-parse", "HEAD"]).trim();
  const branch = git(gitRoot, ["branch", "--show-current"]).trim() || "detached";
  const statusRaw = git(gitRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const statuses = parseStatus(statusRaw);
  const tracked = git(gitRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
    .split("\0")
    .filter(Boolean)
    .map(safeKey);
  const entries: Entry[] = [];
  for (const path of [...new Set(tracked)].sort()) {
    if (
      spec.rootDocsOnly &&
      !(
        path.startsWith("docs/") ||
        /^(README|PLAN|AGENTS|ARCHITECTURE|\.gitmodules|manifest\.json)/i.test(path)
      )
    )
      continue;
    const source = join(gitRoot, path);
    const info = kindOf(path);
    const exists = await Bun.file(source).exists();
    let size: number | null = null;
    let sha256: string | undefined;
    if (exists) {
      const st = await stat(source);
      size = st.size;
      const firstPartyCode =
        ["rust-source", "cargo-manifest", "bun-manifest", "bun-package", "bun-app"].includes(
          info.kind,
        ) || ["crates", "apps", "packages"].includes(path.split("/")[0]!);
      const infraCatalog =
        spec.mode === "orchestrator-split" &&
        (path.startsWith("config/") ||
          path.startsWith("inventory/") ||
          path.startsWith("systemd/") ||
          path === "rust-toolchain.toml");
      if (
        (["documentation", "script"].includes(info.kind) || firstPartyCode || infraCatalog) &&
        st.isFile() &&
        st.size <= 10 * 1024 * 1024
      ) {
        const bytes = await readFile(source);
        sha256 = createHash("sha256").update(bytes).digest("hex");
      }
    }
    const external = path.split("/").some((part) => EXTERNAL_PARTS.has(part));
    const infraCatalog =
      spec.mode === "orchestrator-split" &&
      (path.startsWith("config/") ||
        path.startsWith("inventory/") ||
        path.startsWith("systemd/") ||
        path === "rust-toolchain.toml");
    const infraOwnedControl =
      spec.mode === "orchestrator-split" &&
      (path.startsWith("scripts/") || path.startsWith("packages/aphrody-workspace/"));
    const destination = infraCatalog
      ? path
      : spec.mode === "deferred" || spec.mode === "classify" || infraOwnedControl
        ? null
        : external
          ? `upstream/${spec.owner}/${path}`
          : spec.mode === "upstream-pinned" && info.kind !== "documentation"
            ? `upstream/${spec.owner}/${path}`
            : targetPath(
                spec.mode === "upstream-pinned" ? `upstream-${spec.owner}` : spec.owner,
                path,
                info,
              );
    entries.push({
      source: `${spec.key}/${path}`,
      kind: external && info.kind !== "documentation" ? "upstream-source" : info.kind,
      ...(info.category ? { category: info.category } : {}),
      size,
      status: exists ? (statuses.get(path) ?? "clean") : "missing",
      ...(sha256 ? { sha256 } : {}),
      target: destination,
    });
  }
  const summary = {
    key: spec.key,
    owner: spec.owner,
    policy: spec.mode,
    sourcePath:
      spec.key === "iecode" ? "../iecode" : spec.key === "src-root-docs" ? "." : `src/${spec.key}`,
    head,
    branch,
    dirty: statuses.size > 0,
    dirtyPathCount: statuses.size,
    trackedAndUntrackedPathCount: entries.length,
    documentationCount: entries.filter((entry) => entry.kind === "documentation").length,
    rustManifestCount: entries.filter((entry) => entry.kind === "cargo-manifest").length,
    bunManifestCount: entries.filter((entry) => entry.kind === "bun-manifest").length,
    pythonManifestCount: entries.filter((entry) => entry.kind === "python-manifest").length,
  };
  return { root: summary, entries };
}

export async function runConsolidation(args: string[]): Promise<number> {
  const [action = "inventory", ...rest] = args;
  if (action === "--help" || action === "-h" || action === "help") {
    console.log(
      "Usage: aphrody-ops consolidation <inventory|submodules-inventory|infra-config-import|infra-scripts-import|docs-import|scripts-import> [--source-root path] [--iecode-root path] [--aphrody-root path] [--python-root path]",
    );
    return 0;
  }
  if (
    action !== "inventory" &&
    action !== "submodules-inventory" &&
    action !== "infra-config-import" &&
    action !== "infra-scripts-import" &&
    action !== "docs-import" &&
    action !== "scripts-import"
  )
    throw new Error(
      "Usage: aphrody-ops consolidation <inventory|submodules-inventory|infra-config-import|infra-scripts-import|docs-import|scripts-import> [options]",
    );
  const options = argsOf(rest);
  const sourceRoot = resolve(options.get("--source-root") ?? "/home/aphro/src");
  const iecodeRoot = resolve(options.get("--iecode-root") ?? join(dirname(sourceRoot), "iecode"));
  const aphrodyRoot = resolve(
    options.get("--aphrody-root") ?? join(dirname(sourceRoot), "aphrody"),
  );
  const pythonRoot = resolve(
    options.get("--python-root") ?? join(dirname(sourceRoot), "aphrody-py"),
  );
  const output = join(aphrodyRoot, "docs/migration/source-map.json");
  const nestedOutput = join(aphrodyRoot, "docs/migration/nested-source-map.json");
  const pythonOutput = join(pythonRoot, "docs/migration/source-map.json");
  if (action === "infra-config-import") {
    const result = await importInfraConfig(sourceRoot, aphrodyRoot);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (action === "infra-scripts-import") {
    const result = await importInfraScripts(sourceRoot, aphrodyRoot);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }
  if (action === "scripts-import") {
    const report = JSON.parse(await readFile(output, "utf8")) as {
      entries: Entry[];
      roots: Array<{ key: string }>;
    };
    const sourceRoots = new Map<string, string>([
      ["src-root-docs", sourceRoot],
      ["iecode", iecodeRoot],
    ]);
    for (const root of report.roots)
      if (root.key !== "src-root-docs" && root.key !== "iecode")
        sourceRoots.set(root.key, join(sourceRoot, root.key));
    const index = [
      "<!-- Generated by aphrody-ops consolidation scripts-import. -->",
      "# Imported scripts",
      "",
      "Scripts retain their source-relative paths below category and owner. Relocated commands have not been qualified or executed.",
      "",
    ];
    const failures: string[] = [];
    let copied = 0;
    let identical = 0;
    let aliases = 0;
    let conflicts = 0;
    for (const entry of report.entries) {
      if (entry.kind !== "script") continue;
      if (entry.duplicateOf) {
        aliases++;
        continue;
      }
      const planned = entry.target;
      if (!planned || !(planned.startsWith("scripts/") || planned.startsWith("../aphrody-py/")))
        continue;
      if (!entry.sha256) {
        failures.push(`no safe script hash: ${entry.source}`);
        continue;
      }
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (!sourceBase) {
        failures.push(`unknown source root: ${entry.source}`);
        continue;
      }
      const source = resolve(sourceBase, entry.source.slice(slash + 1));
      if (!existsSync(source)) {
        failures.push(`script source missing: ${entry.source}`);
        continue;
      }
      const sourceHash = createHash("sha256")
        .update(await readFile(source))
        .digest("hex");
      if (sourceHash !== entry.sha256) {
        failures.push(`script source changed after inventory: ${entry.source}`);
        continue;
      }
      const intoPython = planned.startsWith("../aphrody-py/");
      const destinationRoot = intoPython ? pythonRoot : aphrodyRoot;
      let destination = intoPython ? planned.slice("../aphrody-py/".length) : planned;
      let target = resolve(destinationRoot, destination);
      if (!target.startsWith(`${destinationRoot}/`)) {
        failures.push(`script target escaped: ${planned}`);
        continue;
      }
      if (existsSync(target)) {
        const existingHash = createHash("sha256")
          .update(await readFile(target))
          .digest("hex");
        if (existingHash === sourceHash || existingHash === entry.importedSha256) {
          identical++;
          entry.importedSha256 = existingHash;
          entry.importedSourceSha256 = sourceHash;
        } else if (
          entry.importedSha256 === existingHash &&
          entry.importedSourceSha256 !== sourceHash
        ) {
          await copyFile(source, target);
          copied++;
          entry.importedSha256 = sourceHash;
          entry.importedSourceSha256 = sourceHash;
        } else {
          conflicts++;
          const owner = entry.source.slice(0, slash);
          const category = entry.category ?? "tools";
          destination = `${intoPython ? `tools/${category}/${owner}` : `scripts/${category}/${owner}`}/_source/${entry.source.slice(slash + 1)}`;
          target = resolve(destinationRoot, destination);
          if (existsSync(target)) {
            const fallbackHash = createHash("sha256")
              .update(await readFile(target))
              .digest("hex");
            if (fallbackHash === sourceHash) {
              identical++;
              entry.importedTarget = intoPython ? `../aphrody-py/${destination}` : destination;
              entry.importedSha256 = sourceHash;
              entry.importedSourceSha256 = sourceHash;
              continue;
            }
            destination = `${destination}.${sourceHash.slice(0, 12)}`;
            target = resolve(destinationRoot, destination);
          }
          entry.importedTarget = intoPython ? `../aphrody-py/${destination}` : destination;
          await mkdir(dirname(target), { recursive: true });
          await copyFile(source, target);
          copied++;
          entry.importedSha256 = sourceHash;
          entry.importedSourceSha256 = sourceHash;
        }
      } else {
        await mkdir(dirname(target), { recursive: true });
        await copyFile(source, target);
        copied++;
        entry.importedSha256 = sourceHash;
        entry.importedSourceSha256 = sourceHash;
      }
      index.push(
        `- \`${entry.category ?? "tools"}\` — \`${entry.source}\` → \`${entry.importedTarget ?? planned}\` (sha256 \`${sourceHash}\`)`,
      );
    }
    const indexPath = join(aphrodyRoot, "docs/migration/IMPORTED-SCRIPTS-INDEX.md");
    await mkdir(dirname(indexPath), { recursive: true });
    await writeFile(indexPath, `${index.join("\n")}\n`);
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    const result = {
      generatedAt: new Date().toISOString(),
      copied,
      identical,
      exactDuplicateAliases: aliases,
      conflicts,
      failures,
      indexedScripts: index.length - 5,
      report: relative(aphrodyRoot, indexPath),
    };
    const importReport = join(aphrodyRoot, "docs/migration/script-import.json");
    await writeFile(importReport, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    return failures.length ? 1 : 0;
  }
  if (action === "docs-import") {
    const report = JSON.parse(await readFile(output, "utf8")) as {
      entries: Entry[];
      roots: Array<{ key: string }>;
    };
    const sourceRoots = new Map<string, string>([
      ["src-root-docs", sourceRoot],
      ["iecode", iecodeRoot],
    ]);
    for (const root of report.roots) {
      if (root.key !== "src-root-docs" && root.key !== "iecode")
        sourceRoots.set(root.key, join(sourceRoot, root.key));
    }
    let copied = 0;
    let identical = 0;
    let aliases = 0;
    let conflicts = 0;
    let removedGeneratedFallbacks = 0;
    let updatedImportedDocs = 0;
    const failures: string[] = [];
    const imported: Entry[] = [];
    const rewriteSources = new Set<string>();
    const protectedConflicts = new Set([
      "docs/reference/ai/CLI.md",
      "docs/products/ai/README.md",
      "docs/products/compat/README.md",
      "docs/products/os/README.md",
      "docs/products/ui/README.md",
      "docs/products/nie/README.md",
      "docs/products/upstream-bun/README.md",
    ]);
    for (const entry of report.entries) {
      if (
        entry.kind !== "documentation" ||
        !entry.importedTarget?.includes("/_source/") ||
        !entry.target ||
        protectedConflicts.has(entry.target)
      )
        continue;
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (!sourceBase || !entry.sha256) continue;
      const source = resolve(sourceBase, entry.source.slice(slash + 1));
      const fallback = resolve(aphrodyRoot, entry.importedTarget);
      const preferred = resolve(aphrodyRoot, entry.target);
      if (
        !fallback.startsWith(`${aphrodyRoot}/`) ||
        !preferred.startsWith(`${aphrodyRoot}/`) ||
        !existsSync(source) ||
        !existsSync(fallback) ||
        !existsSync(preferred)
      )
        continue;
      const sourceHash = createHash("sha256")
        .update(await readFile(source))
        .digest("hex");
      if (sourceHash !== entry.sha256) {
        failures.push(`generated fallback kept because source changed: ${entry.source}`);
        continue;
      }
      entry.importedSha256 = createHash("sha256")
        .update(await readFile(preferred))
        .digest("hex");
      await unlink(fallback);
      delete entry.importedTarget;
      removedGeneratedFallbacks++;
    }
    for (const entry of report.entries) {
      if (entry.kind !== "documentation") continue;
      if (entry.duplicateOf) {
        aliases++;
        continue;
      }
      if (!entry.target?.startsWith("docs/")) continue;
      if (!entry.sha256) {
        failures.push(`no safe import hash: ${entry.source}`);
        continue;
      }
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (!sourceBase) {
        failures.push(`unknown source root: ${entry.source}`);
        continue;
      }
      const source = resolve(sourceBase, entry.source.slice(slash + 1));
      let destination = entry.importedTarget ?? entry.target;
      let target = resolve(aphrodyRoot, destination);
      if (!target.startsWith(`${aphrodyRoot}/`)) {
        failures.push(`target escaped destination: ${destination}`);
        continue;
      }
      if (!existsSync(source)) {
        failures.push(`source vanished after inventory; preserved mapping: ${entry.source}`);
        continue;
      }
      const sourceBytes = await readFile(source);
      const actualHash = createHash("sha256").update(sourceBytes).digest("hex");
      if (actualHash !== entry.sha256) {
        failures.push(`source changed after inventory: ${entry.source}`);
        continue;
      }
      if (existsSync(target)) {
        const existingHash = createHash("sha256")
          .update(await readFile(target))
          .digest("hex");
        if (entry.importedSha256 === existingHash && entry.importedSourceSha256 !== actualHash) {
          await copyFile(source, target);
          entry.importedSha256 = actualHash;
          entry.importedSourceSha256 = actualHash;
          rewriteSources.add(entry.source);
          updatedImportedDocs++;
          continue;
        }
        if (entry.importedSha256 === existingHash) {
          entry.importedSourceSha256 = actualHash;
          identical++;
          continue;
        }
        if (existingHash === actualHash) {
          identical++;
          entry.importedSourceSha256 = actualHash;
          rewriteSources.add(entry.source);
          continue;
        }
        if (entry.importedTarget || entry.importedSha256) {
          conflicts++;
          entry.importedSha256 = existingHash;
          continue;
        }
        conflicts++;
        const parts = entry.target.split("/");
        destination = `${parts.slice(0, 3).join("/")}/_source/${parts.slice(3).join("/")}`;
        target = resolve(aphrodyRoot, destination);
        if (existsSync(target)) {
          const fallbackHash = createHash("sha256")
            .update(await readFile(target))
            .digest("hex");
          if (fallbackHash === actualHash || fallbackHash === entry.importedSha256) {
            identical++;
            entry.importedTarget = destination;
            entry.importedSha256 = fallbackHash;
            if (fallbackHash === actualHash) rewriteSources.add(entry.source);
            continue;
          }
          destination = `${destination}.${actualHash.slice(0, 12)}`;
          target = resolve(aphrodyRoot, destination);
        }
        entry.importedTarget = destination;
      }
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      copied++;
      entry.importedSourceSha256 = actualHash;
      rewriteSources.add(entry.source);
      imported.push(entry);
    }
    const docsByCategory = new Map<string, Entry[]>();
    const importedBySource = new Map<string, string>();
    for (const entry of report.entries) {
      const destination = entry.importedTarget ?? entry.target;
      if (entry.kind !== "documentation" || !destination?.startsWith("docs/")) continue;
      const category = destination.split("/")[1] ?? "reference";
      const group = docsByCategory.get(category) ?? [];
      group.push(entry);
      docsByCategory.set(category, group);
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (sourceBase)
        importedBySource.set(resolve(sourceBase, entry.source.slice(slash + 1)), destination);
    }
    for (const entry of report.entries) {
      if (entry.kind !== "documentation" || !entry.duplicateOf) continue;
      const canonicalTarget = report.entries.find(
        (candidate) =>
          candidate.target === entry.duplicateOf || candidate.importedTarget === entry.duplicateOf,
      );
      const destination = canonicalTarget?.importedTarget ?? canonicalTarget?.target;
      if (!destination?.startsWith("docs/")) continue;
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (sourceBase)
        importedBySource.set(resolve(sourceBase, entry.source.slice(slash + 1)), destination);
    }
    for (const entry of report.entries) {
      if (entry.kind === "documentation" || entry.duplicateOf || !entry.sha256) continue;
      const destination = entry.importedTarget ?? entry.target;
      if (!destination || !/^(?:apps|crates|packages|scripts)\//.test(destination)) continue;
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (!sourceBase) continue;
      const source = resolve(sourceBase, entry.source.slice(slash + 1));
      const target = resolve(aphrodyRoot, destination);
      if (!target.startsWith(`${aphrodyRoot}/`) || !existsSync(source) || !existsSync(target))
        continue;
      const sourceBytes = await readFile(source);
      if (createHash("sha256").update(sourceBytes).digest("hex") !== entry.sha256) continue;
      const targetBytes = await readFile(target);
      const targetHash = createHash("sha256").update(targetBytes).digest("hex");
      let matchesImport =
        targetHash === entry.sha256 ||
        (entry.importedSourceSha256 === entry.sha256 && entry.importedSha256 === targetHash);
      if (!matchesImport && entry.kind === "bun-manifest") {
        try {
          const sourceName = (JSON.parse(sourceBytes.toString()) as { name?: string }).name;
          const targetName = (JSON.parse(targetBytes.toString()) as { name?: string }).name;
          matchesImport = !!sourceName && sourceName === targetName;
        } catch {
          // A manifest without a matching package identity is not an imported file target.
        }
      }
      if (matchesImport) importedBySource.set(source, destination);
    }
    let rewrittenLinks = 0;
    const unresolvedLinks: string[] = [];
    for (const entry of report.entries) {
      if (entry.kind !== "documentation" || entry.duplicateOf) continue;
      const destination = entry.importedTarget ?? entry.target;
      if (!destination?.startsWith("docs/") || !/\.(md|mdx)$/i.test(destination)) continue;
      const slash = entry.source.indexOf("/");
      const sourceBase = sourceRoots.get(entry.source.slice(0, slash));
      if (!sourceBase) continue;
      const source = resolve(sourceBase, entry.source.slice(slash + 1));
      const target = resolve(aphrodyRoot, destination);
      if (!existsSync(source) || !existsSync(target)) continue;
      const original = await readFile(source, "utf8");
      if (createHash("sha256").update(original).digest("hex") !== entry.sha256) continue;
      const linkReplacements = new Map<string, string>();
      const rewritten = original.replace(
        /(!?\[[^\]]*\]\()([^\s)]+)(\s+[^)]*\)|\))/g,
        (whole, before: string, rawUrl: string, after: string) => {
          const wrapped = rawUrl.startsWith("<") && rawUrl.endsWith(">");
          const url = wrapped ? rawUrl.slice(1, -1) : rawUrl;
          if (!url || /^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return whole;
          const splitAt = url.search(/[?#]/);
          const localPart = splitAt < 0 ? url : url.slice(0, splitAt);
          const suffix = splitAt < 0 ? "" : url.slice(splitAt);
          let decoded: string;
          try {
            decoded = decodeURIComponent(localPart);
          } catch {
            return whole;
          }
          const sourceTarget = importedBySource.get(resolve(dirname(source), decoded));
          if (!sourceTarget) {
            if (localPart) unresolvedLinks.push(`${entry.source}: ${url}`);
            return whole;
          }
          let relativeTarget = relative(
            dirname(target),
            resolve(aphrodyRoot, sourceTarget),
          ).replaceAll("\\", "/");
          if (!relativeTarget.startsWith(".")) relativeTarget = `./${relativeTarget}`;
          rewrittenLinks++;
          const replacement = wrapped
            ? `<${relativeTarget}${suffix}>`
            : `${relativeTarget}${suffix}`;
          linkReplacements.set(rawUrl, replacement);
          return `${before}${replacement}${after}`;
        },
      );
      if (rewritten !== original) {
        const currentTarget = await readFile(target, "utf8");
        const currentTargetHash = createHash("sha256").update(currentTarget).digest("hex");
        if (currentTargetHash === entry.sha256 || currentTargetHash === entry.importedSha256) {
          const updatedTarget = currentTarget.replace(
            /(!?\[[^\]]*\]\()([^\s)]+)(\s+[^)]*\)|\))/g,
            (whole, before: string, rawUrl: string, after: string) => {
              const replacement = linkReplacements.get(rawUrl);
              return replacement ? `${before}${replacement}${after}` : whole;
            },
          );
          if (updatedTarget !== currentTarget) {
            await writeFile(target, updatedTarget);
            entry.importedSha256 = createHash("sha256").update(updatedTarget).digest("hex");
          }
        } else if (rewriteSources.has(entry.source)) {
          conflicts++;
          failures.push(`link rewrite preserved target edited outside importer: ${destination}`);
        }
      }
      entry.importedSourceSha256 = entry.sha256;
    }
    const indexLines = [
      "<!-- Generated from migration/source-map.json by aphrody-ops consolidation docs-import. -->",
      "# Documentation index",
      "",
      "Source documents are copied with provenance. Verified local file links are rewritten where their imported targets exist; see [document-import.json](migration/document-import.json) for unresolved references.",
      "",
    ];
    for (const [category, documents] of [...docsByCategory].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      indexLines.push(`## ${category}`, "");
      for (const entry of documents.sort((a, b) => a.target!.localeCompare(b.target!))) {
        const destination = entry.importedTarget ?? entry.target!;
        const label = destination.split("/").slice(3).join("/") || basename(destination);
        const href = relative(join(aphrodyRoot, "docs"), join(aphrodyRoot, destination)).replaceAll(
          "\\",
          "/",
        );
        indexLines.push(`- [${label.replaceAll("]", "\\]")}](${href}) — ${entry.source}`);
      }
      indexLines.push("");
    }
    const indexPath = join(aphrodyRoot, "docs/migration/IMPORTED-DOCS-INDEX.md");
    const generatedIndex = `${indexLines.join("\n")}\n`;
    if (existsSync(indexPath)) {
      const existingIndex = await readFile(indexPath, "utf8");
      if (!existingIndex.startsWith("<!-- Generated from migration/source-map.json"))
        failures.push("preserved existing generated-docs index; no index was written");
      else await writeFile(indexPath, generatedIndex);
    } else await writeFile(indexPath, generatedIndex);
    const result = {
      generatedAt: new Date().toISOString(),
      sourceMap: relative(aphrodyRoot, output),
      target: aphrodyRoot,
      copied,
      updatedImportedDocs,
      identical,
      exactDuplicateAliases: aliases,
      removedGeneratedFallbacks,
      indexedDocuments: docsByCategory.size
        ? [...docsByCategory.values()].reduce((n, docs) => n + docs.length, 0)
        : 0,
      conflicts,
      failures,
      importedPaths: imported.length,
      mappedLocalMarkdownLinks: rewrittenLinks,
      unresolvedLocalMarkdownLinkCount: unresolvedLinks.length,
      unresolvedLocalMarkdownLinkSample: unresolvedLinks.slice(0, 200),
      linkRewriting:
        "relative Markdown links to imported documents and verified local files rewritten; anchors preserved; unresolved attachments and reference-style links are not rewritten",
    };
    const importReport = join(aphrodyRoot, "docs/migration/document-import.json");
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "w" });
    await writeFile(importReport, `${JSON.stringify(result, null, 2)}\n`, { flag: "w" });
    console.log(
      JSON.stringify({ ...result, report: relative(aphrodyRoot, importReport) }, null, 2),
    );
    return failures.length > 0 ? 1 : 0;
  }
  const specs: RootSpec[] = [
    {
      key: "src-root-docs",
      path: sourceRoot,
      owner: "workspace",
      mode: "extract",
      rootDocsOnly: true,
    },
    ...[
      ["aphrody-ai", "ai", "extract"],
      ["aphrody-compat", "compat", "extract"],
      ["aphrody-contracts", "contracts", "extract"],
      ["aphrody-discord", "discord", "extract"],
      ["aphrody-infra", "infra", "orchestrator-split"],
      ["aphrody-koharu", "koharu", "extract"],
      ["aphrody-native", "native", "extract"],
      ["aphrody-os", "os", "extract"],
      ["aphrody-shell", "shell", "extract"],
      ["aphrody-ui", "ui", "extract"],
      ["aphrody-web", "web", "extract"],
      ["nie", "nie", "extract"],
      ["fut", "fut", "extract"],
      ["rg", "rg", "deferred"],
      ["shenron", "shenron", "deferred"],
      ["bun", "bun", "upstream-pinned"],
      ["oxc", "oxc", "upstream-pinned"],
      ["bevy", "bevy", "classify"],
      ["dust", "dust", "classify"],
      ["emu.nintendo.wii.gecko", "emu", "classify"],
    ].map(([key, owner, mode]) => ({
      key: key!,
      path: join(sourceRoot, key!),
      owner: owner!,
      mode: mode as Mode,
    })),
    { key: "iecode", path: iecodeRoot, owner: "iecode", mode: "extract" },
  ];
  if (action === "submodules-inventory") {
    const result = inventorySubmodules(specs);
    const nested = await inventoryNestedFiles(result.submodules, specs);
    const reportPath = join(aphrodyRoot, "docs/migration/submodule-inventory.json");
    await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
    await writeFile(nestedOutput, `${JSON.stringify(nested, null, 2)}\n`);
    if (existsSync(output)) {
      const sourceMap = JSON.parse(await readFile(output, "utf8")) as Record<string, unknown>;
      sourceMap.submoduleInventory = relative(aphrodyRoot, reportPath);
      sourceMap.submoduleInventoryObservedAt = result.observedAt;
      sourceMap.submodules = result.submodules;
      sourceMap.missingRoots = result.missingRoots;
      sourceMap.nestedSourceMap = relative(aphrodyRoot, nestedOutput);
      sourceMap.nestedSourceMapObservedAt = nested.observedAt;
      sourceMap.nestedSourceTotals = nested.totals;
      await writeFile(output, `${JSON.stringify(sourceMap, null, 2)}\n`);
    }
    console.log(
      JSON.stringify(
        {
          report: relative(aphrodyRoot, reportPath),
          nestedSourceMap: relative(aphrodyRoot, nestedOutput),
          nestedTotals: nested.totals,
          counts: result.counts,
          missingRoots: result.missingRoots,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const snapshots = [];
  for (const spec of specs) {
    if (!existsSync(join(spec.path, ".git"))) {
      console.error(`skip missing checkout: ${spec.key} (${spec.path})`);
      continue;
    }
    snapshots.push(await rootSnapshot(spec));
  }
  const entries = snapshots.flatMap((snapshot) => snapshot.entries);
  if (existsSync(output)) {
    try {
      const previous = JSON.parse(await readFile(output, "utf8")) as { entries?: Entry[] };
      const priorBySource = new Map((previous.entries ?? []).map((entry) => [entry.source, entry]));
      for (const entry of entries) {
        const prior = priorBySource.get(entry.source);
        if (!prior || prior.target !== entry.target || !entry.target) continue;
        if (prior.importedTarget) entry.importedTarget = prior.importedTarget;
        if (prior.importedSha256) entry.importedSha256 = prior.importedSha256;
        if (prior.importedSourceSha256 || prior.sha256)
          entry.importedSourceSha256 = prior.importedSourceSha256 ?? prior.sha256;
      }
    } catch (error) {
      console.error(`could not preserve prior import state: ${String(error)}`);
    }
  }
  const seen = new Map<string, string>();
  const seenScripts = new Map<string, { target: string; python: boolean }>();
  for (const entry of entries) {
    if (!entry.sha256 || !entry.target) continue;
    if (entry.kind === "documentation") {
      const first = seen.get(entry.sha256);
      if (first) {
        entry.duplicateOf = first;
        entry.target = null;
      } else seen.set(entry.sha256, entry.target);
    } else if (
      entry.kind === "script" &&
      (entry.target.startsWith("scripts/") || entry.target.startsWith("../aphrody-py/"))
    ) {
      const python = entry.target.startsWith("../aphrody-py/");
      const first = seenScripts.get(entry.sha256);
      if (first && first.python === python) {
        entry.duplicateOf = first.target;
        entry.target = null;
      } else seenScripts.set(entry.sha256, { target: entry.target, python });
    }
  }
  const byKind = Object.fromEntries(
    [...new Set(entries.map((entry) => entry.kind))]
      .sort()
      .map((kind) => [kind, entries.filter((entry) => entry.kind === kind).length]),
  );
  const submoduleInventory = inventorySubmodules(specs);
  const nestedSourceMap = await inventoryNestedFiles(submoduleInventory.submodules, specs);
  await writeFile(nestedOutput, `${JSON.stringify(nestedSourceMap, null, 2)}\n`);
  const report = {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    scope:
      "Inventory only. Source checkouts are unchanged. Exact document duplicates are identified by SHA-256; semantic overlap is not auto-merged. Git histories remain in their source repositories until an explicit import gate.",
    targets: {
      aphrody: aphrodyRoot,
      python: pythonRoot,
      infraController: "src/aphrody-infra/packages/aphrody-workspace",
    },
    roots: snapshots.map((snapshot) => snapshot.root),
    totals: { roots: snapshots.length, paths: entries.length, byKind },
    submodules: submoduleInventory.submodules,
    missingRoots: submoduleInventory.missingRoots,
    submoduleInventoryObservedAt: submoduleInventory.observedAt,
    nestedSourceMap: relative(aphrodyRoot, nestedOutput),
    nestedSourceMapObservedAt: nestedSourceMap.observedAt,
    nestedSourceTotals: nestedSourceMap.totals,
    entries,
  };
  await mkdir(dirname(output), { recursive: true });
  await mkdir(dirname(pythonOutput), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: "w" });
  const pythonEntries = entries.filter(
    (entry) => entry.kind === "python-manifest" || /\.py(i)?$|\.ipynb$/i.test(entry.source),
  );
  const pythonReport = {
    ...report,
    entries: pythonEntries,
    totals: { roots: snapshots.length, paths: pythonEntries.length },
  };
  await writeFile(pythonOutput, `${JSON.stringify(pythonReport, null, 2)}\n`, { flag: "w" });
  console.log(
    JSON.stringify(
      {
        output: relative(aphrodyRoot, output),
        pythonOutput: relative(pythonRoot, pythonOutput),
        totals: report.totals,
        roots: report.roots.map((root) => ({
          key: root.key,
          policy: root.policy,
          head: root.head,
          dirty: root.dirty,
          paths: root.trackedAndUntrackedPathCount,
        })),
      },
      null,
      2,
    ),
  );
  return 0;
}

if (import.meta.main) process.exit(await runConsolidation(process.argv.slice(2)));

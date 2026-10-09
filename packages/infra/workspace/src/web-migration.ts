// SPDX-License-Identifier: Apache-2.0
/** Read-only closure gate for the Aphrody Web consolidation. */
import { Glob, TOML } from "bun";
import { spawnSync } from "@aphrody/update/process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { firstPartyManifests } from "@aphrody/update/manifests";

type Component = { name: string; manifest: string };
type CatalogGap = { manifest: string; section: string; dependency: string; catalog: string };
type AbiSymbol = { symbol: string; path: string };

export interface WebMigrationReport {
  source: {
    root: string;
    head: string | null;
    dirty: boolean;
    rust: Component[];
    bun: Component[];
  };
  target: { root: string; head: string | null; rust: Component[]; bun: Component[] };
  missing: { rust: Component[]; bun: Component[] };
  catalogGaps: CatalogGap[];
  cdylibs: Component[];
  mcpHosts: Component[];
  legacyAbiSymbols: AbiSymbol[];
  legacyCodeFiles: string[];
  ready: boolean;
}

function git(root: string, ...args: string[]): string | null {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function paths(root: string, patterns: string[]): Promise<string[]> {
  const found = await Promise.all(
    patterns.map(async (pattern) =>
      Array.fromAsync(new Glob(pattern).scan({ cwd: root, onlyFiles: true })),
    ),
  );
  // Repository-relative identities use "/" on every host (Windows scans yield "\").
  return [...new Set(found.flat().map((path) => path.replaceAll("\\", "/")))].toSorted();
}

async function rustComponents(root: string, patterns: string[]): Promise<Component[]> {
  const manifests = await paths(root, patterns);
  return (
    await Promise.all(
      manifests.map(async (manifest) => {
        const parsed = TOML.parse(await Bun.file(join(root, manifest)).text()) as {
          package?: { name?: string };
        };
        return parsed.package?.name ? { name: parsed.package.name, manifest } : null;
      }),
    )
  ).filter((item): item is Component => item !== null);
}

async function bunComponents(root: string, patterns: string[]): Promise<Component[]> {
  const manifests = await paths(root, patterns);
  return (
    await Promise.all(
      manifests.map(async (manifest) => {
        const parsed = (await Bun.file(join(root, manifest)).json()) as { name?: string };
        return parsed.name ? { name: parsed.name, manifest } : null;
      }),
    )
  ).filter((item): item is Component => item !== null);
}

async function catalogGaps(root: string): Promise<CatalogGap[]> {
  const rootManifest = (await Bun.file(join(root, "package.json")).json()) as {
    workspaces?: {
      catalog?: Record<string, string>;
      catalogs?: Record<string, Record<string, string>>;
    };
  };
  const defaultCatalog = rootManifest.workspaces?.catalog ?? {};
  const namedCatalogs = rootManifest.workspaces?.catalogs ?? {};
  const manifests = await firstPartyManifests(root);
  const sections = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ] as const;
  const gaps: CatalogGap[] = [];
  const parsedManifests = await Promise.all(
    manifests.map(async (manifest) => ({
      manifest,
      parsed: (await Bun.file(join(root, manifest)).json()) as Record<string, unknown>,
    })),
  );
  for (const { manifest, parsed } of parsedManifests) {
    for (const section of sections) {
      const dependencies = parsed[section] as Record<string, unknown> | undefined;
      for (const [dependency, version] of Object.entries(dependencies ?? {})) {
        if (typeof version !== "string" || !version.startsWith("catalog:")) continue;
        const catalog = version.slice("catalog:".length);
        const entries = catalog ? namedCatalogs[catalog] : defaultCatalog;
        if (!entries || !(dependency in entries)) {
          gaps.push({ manifest, section, dependency, catalog: catalog || "default" });
        }
      }
    }
  }
  return gaps.toSorted((a, b) =>
    `${a.manifest}:${a.section}:${a.dependency}`.localeCompare(
      `${b.manifest}:${b.section}:${b.dependency}`,
    ),
  );
}

async function ffiOwners(root: string): Promise<Component[]> {
  const components = await rustComponents(root, [
    "crates/*/*/Cargo.toml",
    "crates/os/ostd/*/Cargo.toml",
    "crates/os/kernel/*/Cargo.toml",
    "crates/os/kernel/{comps,libs}/*/Cargo.toml",
  ]);
  const owners = await Promise.all(
    components.map(async (component) => {
      const parsed = TOML.parse(await Bun.file(join(root, component.manifest)).text()) as {
        lib?: { "crate-type"?: string[] };
      };
      return parsed.lib?.["crate-type"]?.includes("cdylib") ? component : null;
    }),
  );
  return owners.filter((item): item is Component => item !== null);
}

async function mcpHosts(root: string): Promise<Component[]> {
  const components = await rustComponents(root, [
    "crates/*/*/Cargo.toml",
    "crates/os/ostd/*/Cargo.toml",
    "crates/os/kernel/*/Cargo.toml",
    "crates/os/kernel/{comps,libs}/*/Cargo.toml",
  ]);
  const hosts = await Promise.all(
    components.map(async (component) => {
      if (!component.name.endsWith("-mcp")) return null;
      const main = join(root, component.manifest.replace(/Cargo\.toml$/, "src/main.rs"));
      return (await Bun.file(main).exists()) ? component : null;
    }),
  );
  return hosts.filter((item): item is Component => item !== null);
}

async function legacyAbiSymbols(root: string, owners: Component[]): Promise<AbiSymbol[]> {
  // Lectures indépendantes (une par crate et par fichier) : le résultat est trié en sortie.
  const sources = await Promise.all(
    owners.map(async (owner) => {
      const crateRoot = owner.manifest.replace(/\/Cargo\.toml$/, "");
      const files = await paths(root, [`${crateRoot}/src/**/*.rs`, `${crateRoot}/include/*.h`]);
      return Promise.all(
        files.map(async (path) => ({ path, content: await Bun.file(join(root, path)).text() })),
      );
    }),
  );
  const symbols: AbiSymbol[] = [];
  for (const { path, content } of sources.flat()) {
    if (path.endsWith(".rs")) {
      const exports =
        /#\[(?:unsafe\(no_mangle\)|no_mangle|export_name\s*=\s*"[^"]+")\]\s*(?:#\[[^\]]+\]\s*)*pub\s+(?:unsafe\s+)?extern\s+"C"\s+fn\s+(bxc_[A-Za-z0-9_]+)/g;
      for (const match of content.matchAll(exports)) symbols.push({ symbol: match[1]!, path });
    } else {
      const declarations = /\b(bxc_[A-Za-z0-9_]+)\s*\(/g;
      for (const match of content.matchAll(declarations)) symbols.push({ symbol: match[1]!, path });
    }
  }
  return symbols.toSorted((a, b) => `${a.path}:${a.symbol}`.localeCompare(`${b.path}:${b.symbol}`));
}

function legacyCodeFiles(root: string): string[] {
  const result = git(
    root,
    "grep",
    "-Il",
    "-i",
    "bxc",
    "--",
    "*.rs",
    "*.ts",
    "*.tsx",
    "*.js",
    "*.json",
    "*.toml",
    "*.h",
    "*.nu",
    "*.sh",
  );
  return result ? result.split("\n").filter(Boolean) : [];
}

/** Inventory names and closure signals. A matching name is not a parity claim. */
export async function scanWebMigration(
  sourceRoot: string,
  targetRoot: string,
): Promise<WebMigrationReport> {
  const source = resolve(sourceRoot);
  const target = resolve(targetRoot);
  const [sourceRust, sourceBun, targetRust, targetBun, gaps, cdylibs, mcp] = await Promise.all([
    rustComponents(source, ["crates/*/Cargo.toml", "crates/aphrody-obscura/crates/*/Cargo.toml"]),
    bunComponents(source, ["packages/*/package.json", "apps/*/package.json"]),
    rustComponents(target, ["crates/web/*/Cargo.toml", "crates/ai/*/Cargo.toml"]),
    bunComponents(target, [
      "packages/web/*/package.json",
      "packages/ai/*/package.json",
      "apps/web/*/package.json",
    ]),
    catalogGaps(target),
    ffiOwners(target),
    mcpHosts(target),
  ]);
  const rustNames = new Set(targetRust.map((item) => item.name));
  const bunNames = new Set(targetBun.map((item) => item.name));
  const missingRust = sourceRust.filter((item) => !rustNames.has(item.name));
  const missingBun = sourceBun.filter((item) => !bunNames.has(item.name));
  const [legacy, legacyAbi] = await Promise.all([
    Promise.resolve(legacyCodeFiles(target)),
    legacyAbiSymbols(target, cdylibs),
  ]);
  return {
    source: {
      root: source,
      head: git(source, "rev-parse", "HEAD"),
      dirty: Boolean(git(source, "status", "--porcelain")),
      rust: sourceRust,
      bun: sourceBun,
    },
    target: {
      root: target,
      head: git(target, "rev-parse", "HEAD"),
      rust: targetRust,
      bun: targetBun,
    },
    missing: { rust: missingRust, bun: missingBun },
    catalogGaps: gaps,
    cdylibs,
    mcpHosts: mcp,
    legacyAbiSymbols: legacyAbi,
    legacyCodeFiles: legacy,
    ready:
      missingRust.length === 0 &&
      missingBun.length === 0 &&
      gaps.length === 0 &&
      cdylibs.length === 1 &&
      mcp.length === 1 &&
      legacyAbi.length === 0 &&
      legacy.length === 0,
  };
}

export async function runWebMigration(args: string[]): Promise<number> {
  let source = join(homedir(), "src/aphrody-web");
  let target = join(homedir(), "aphrody");
  let json = false;
  let strict = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--source") source = args[++index] ?? "";
    else if (arg === "--target") target = args[++index] ?? "";
    else if (arg === "--json") json = true;
    else if (arg === "--strict") strict = true;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: yolo ops web-migration [--source PATH] [--target PATH] [--json] [--strict]",
      );
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!source || !target) throw new Error("--source and --target require paths");
  const report = await scanWebMigration(source, target);
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `Source ${report.source.head ?? "unknown"}${report.source.dirty ? " (dirty)" : ""}`,
    );
    console.log(
      `Rust source ${report.source.rust.length}, target ${report.target.rust.length}; Bun source ${report.source.bun.length}, target ${report.target.bun.length}`,
    );
    console.log(
      `Missing source names: Rust ${report.missing.rust.length}, Bun ${report.missing.bun.length}`,
    );
    for (const item of [...report.missing.rust, ...report.missing.bun])
      console.log(`  ${item.name}: ${item.manifest}`);
    console.log(
      `Catalog gaps ${report.catalogGaps.length}; cdylibs ${report.cdylibs.length}; MCP hosts ${report.mcpHosts.length}; legacy ABI symbols ${report.legacyAbiSymbols.length}; legacy code files ${report.legacyCodeFiles.length}`,
    );
    for (const symbol of report.legacyAbiSymbols.slice(0, 20))
      console.log(`  ${symbol.symbol}: ${symbol.path}`);
    for (const gap of report.catalogGaps.slice(0, 20))
      console.log(`  ${gap.manifest} ${gap.section}.${gap.dependency}: ${gap.catalog}`);
  }
  return strict && !report.ready ? 1 : 0;
}

if (import.meta.main) process.exit(await runWebMigration(process.argv.slice(2)));

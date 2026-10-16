#!/usr/bin/env bun
/**
 * The remaining shipped NIE command surfaces during the Aphrody migration.
 *
 * The scoped gate uses the union of Cargo closures for the remaining CLI, MCP
 * and model surfaces. Historical cost measurements predating the Site transfer
 * must not be applied to this reduced workspace.
 *
 * WHAT IS DERIVED AND WHAT IS DECLARED
 * Only the ROOT crate of each surface is declared here. Its workspace-local dependency closure is
 * read from `cargo metadata` at call time. Non-Cargo paths are declared in
 * `extraPaths`. Site and browser source now live in Aphrody Web and UI.
 *
 * Deployment is owned by Aphrody Infra; this module only records the legacy
 * command targets during migration.
 */

import { resolve } from "node:path";

export type SurfaceName = "cli" | "mcp" | "model";

export type Surface = {
  /** Stable identifier: the CI matrix entry, the `just` argument, the release tag prefix. */
  readonly name: SurfaceName;
  /** One line, English, shown by `surfaces list` and in the contribution guide. */
  readonly description: string;
  /** Cargo package names. Their workspace-local closure is derived, never written down. */
  readonly rootCrates: readonly string[];
  /** Repository paths Cargo does not know about. Directories are matched as prefixes. */
  readonly extraPaths: readonly string[];
  /** Build the shippable artefact. */
  readonly build: readonly (readonly string[])[];
  /**
   * Cheap check on the ARTEFACT, run after `build`. Never `cargo test` on a surface crate:
   * measured 2026-09-19, `cargo test -p aphrody-nie-model-serve` panics with "moins de 3 AWB dans le
   * VFS (0)" because its tests read the game's copyrighted VFS, which CI does not have. The
   * copyright-free test set is the one `ci.yml` already names: aphrody-nie-core, aphrody-nie-pe, aphrody-nie-asm,
   * aphrody-nie-forge.
   */
  readonly smoke: readonly (readonly string[])[];
  /** Retained deployment target labels; deployment belongs to @aphrody/workspace. */
  readonly deployTargets: readonly string[];
  /** Tag prefix that releases this surface alone, e.g. `cli-v0.6.0`. */
  readonly tagPrefix: string;
};

const repositoryRoot = resolve(import.meta.dir, "../../..");

export const surfaces: readonly Surface[] = [
  {
    name: "cli",
    description: "nie — the native command line: VFS, formats, reverse-engineering atlas.",
    rootCrates: ["aphrody-nie-cli"],
    extraPaths: ["crates/nie/aphrody-nie-cli"],
    build: [["cargo", "build", "--release", "--locked", "-p", "aphrody-nie-cli"]],
    smoke: [["target/release/nie", "--version"]],
    deployTargets: ["ffi", "cli"],
    tagPrefix: "cli-v",
  },
  {
    name: "mcp",
    description: "aphrody-nie-mcp — the native Rust Model Context Protocol server (stdio).",
    rootCrates: ["aphrody-nie-mcp"],
    extraPaths: ["crates/nie/aphrody-nie-mcp", ".mcp.json"],
    build: [["cargo", "build", "--release", "--locked", "-p", "aphrody-nie-mcp"]],
    smoke: [["cargo", "test", "--locked", "-p", "aphrody-nie-mcp", "--test", "stdio_smoke"]],
    deployTargets: ["mcp"],
    tagPrefix: "mcp-v",
  },
  {
    name: "model",
    description: "aphrody-nie-model-serve — the model and VFS asset server behind nie.aphrody.com/cdn/.",
    rootCrates: ["aphrody-nie-model-serve"],
    // Unit: aphrody-infra systemd/aphrody-nie-model-serve.service.
    extraPaths: ["crates/nie/aphrody-nie-model-serve"],
    build: [["cargo", "build", "--release", "--locked", "-p", "aphrody-nie-model-serve"]],
    smoke: [["target/release/aphrody-nie-model-serve", "--help"]],
    deployTargets: ["model"],
    tagPrefix: "model-v",
  },
];

export function surfaceByName(name: string): Surface {
  const found = surfaces.find(surface => surface.name === name);
  if (!found)
    throw new Error(`Unknown surface ${JSON.stringify(name)}. Known: ${surfaces.map(s => s.name).join(", ")}.`);
  return found;
}

type CargoNode = { id: string; deps: { pkg: string }[] };
type CargoPackage = { id: string; name: string; manifest_path: string };
type CargoMetadata = {
  workspace_root: string;
  workspace_members: string[];
  packages: CargoPackage[];
  resolve: { nodes: CargoNode[] };
};

let cachedMetadata: CargoMetadata | undefined;

async function metadata(): Promise<CargoMetadata> {
  if (cachedMetadata) return cachedMetadata;
  const child = Bun.spawn(["cargo", "metadata", "--format-version", "1"], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`cargo metadata failed (${code}): ${stderr.trim()}`);
  cachedMetadata = JSON.parse(stdout) as CargoMetadata;
  return cachedMetadata;
}

/** Workspace-local dependency closure of a surface, as Cargo package names, sorted. */
export async function closure(surface: Surface): Promise<string[]> {
  const meta = await metadata();
  const members = new Set(meta.workspace_members);
  const byId = new Map(meta.packages.map(pkg => [pkg.id, pkg]));
  const nodes = new Map(meta.resolve.nodes.map(node => [node.id, node]));
  const seen = new Set<string>();
  const stack = [...members].filter(id => surface.rootCrates.includes(byId.get(id)?.name ?? ""));
  const missing = surface.rootCrates.filter(crate => !stack.some(id => byId.get(id)?.name === crate));
  if (missing.length)
    throw new Error(`Surface ${surface.name} names crates absent from the workspace: ${missing.join(", ")}.`);
  while (stack.length) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) if (members.has(dep.pkg) && !seen.has(dep.pkg)) stack.push(dep.pkg);
  }
  return [...seen].map(id => byId.get(id)?.name ?? id).sort();
}

/** Repository-relative path prefixes that belong to a surface: its crates, plus `extraPaths`. */
export async function paths(surface: Surface): Promise<string[]> {
  const meta = await metadata();
  const byName = new Map(meta.packages.map(pkg => [pkg.name, pkg]));
  const crateDirs = (await closure(surface)).flatMap(name => {
    const manifest = byName.get(name)?.manifest_path;
    if (!manifest) return [];
    return [manifest.replace(`${meta.workspace_root}/`, "").replace(/\/Cargo\.toml$/u, "")];
  });
  return [...new Set([...crateDirs, ...surface.extraPaths])].sort();
}

/**
 * Paths that force EVERY lane: the lockfile, the workspace manifest, the toolchain pin, the
 * shared Cargo and CI configuration. A change here can alter any surface's compilation, so
 * narrowing on it would be a false negative.
 */
export const globalPaths: readonly string[] = [
  "Cargo.toml",
  "Cargo.lock",
  "rust-toolchain.toml",
  "clippy.toml",
  ".cargo",
  ".github/workflows",
  "scripts/iecode/tools/surfaces.ts",
  "bun.lock",
  "package.json",
];

function touches(file: string, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => file === prefix || file.startsWith(`${prefix}/`));
}

export type Plan = {
  readonly base: string;
  readonly head: string;
  readonly files: number;
  readonly global: boolean;
  readonly surfaces: SurfaceName[];
  readonly reason: string;
};

/** Which surfaces a diff can have broken. `global` widens it to all remaining surfaces. */
export async function plan(changedFiles: readonly string[], base: string, head: string): Promise<Plan> {
  const isGlobal = changedFiles.some(file => touches(file, globalPaths));
  if (isGlobal) {
    return {
      base,
      head,
      files: changedFiles.length,
      global: true,
      surfaces: surfaces.map(surface => surface.name),
      reason: "a shared manifest, lockfile, toolchain pin or workflow changed",
    };
  }
  const affected: SurfaceName[] = [];
  for (const surface of surfaces) {
    const prefixes = await paths(surface);
    if (changedFiles.some(file => touches(file, prefixes))) affected.push(surface.name);
  }
  return {
    base,
    head,
    files: changedFiles.length,
    global: false,
    surfaces: affected,
    reason: affected.length
      ? `changed paths belong to ${affected.join(", ")}`
      : "no shipped surface is reachable from the changed paths",
  };
}

async function capture(argv: string[]): Promise<string> {
  const child = Bun.spawn(argv, { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`${argv.join(" ")} failed (${code}): ${stderr.trim()}`);
  return stdout;
}

async function changedFiles(base: string, head: string): Promise<string[]> {
  const range = head === "WORKTREE" ? [base] : [base, head];
  const diff = await capture(["git", "diff", "--name-only", ...range]);
  return diff
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean);
}

async function runAll(commands: readonly (readonly string[])[], label: string): Promise<number> {
  for (const argv of commands) {
    process.stdout.write(`\n· ${argv.join(" ")}\n`);
    const child = Bun.spawn([...argv], { cwd: repositoryRoot, stdout: "inherit", stderr: "inherit", stdin: "ignore" });
    const code = await child.exited;
    if (code !== 0) {
      process.stderr.write(`\n✗ ${label}: ${argv.join(" ")} exited ${code}\n`);
      return code;
    }
  }
  process.stdout.write(`\n✓ ${label}\n`);
  return 0;
}

/** Union of several surfaces' closures — each shared crate named once, so compiled once. */
export async function unionClosure(names: readonly SurfaceName[]): Promise<string[]> {
  const crates = new Set<string>();
  for (const name of names) for (const crate of await closure(surfaceByName(name))) crates.add(crate);
  return [...crates].sort();
}

/** The scoped clippy gate: every crate named with `-p`, never `--workspace`. */
export function clippyArgv(crates: readonly string[]): string[] {
  return [
    "cargo",
    "clippy",
    "--locked",
    "--all-targets",
    ...crates.flatMap(crate => ["-p", crate]),
    "--",
    "-D",
    "warnings",
  ];
}

const usage = `Usage: bun run scripts/iecode/tools/surfaces.ts <command> [options]

  list                        the five surfaces, with their derived crate count
  paths <surface>             repository path prefixes that belong to a surface
  closure <surface>           workspace crates the surface is built from
  plan [--base <ref>] [--json]   which surfaces a diff can have broken (default base: origin/main)
  gate [--base <ref>]         ONE scoped clippy over the union of the affected surfaces
  gate <surface>              the same, forced to a single surface
  build <surface>             build the shippable artefact
  smoke <surface>             cheap check on the artefact 'build' just produced
  deploy <surface>            report the owning shared Infra release workflow

The shipping order is gate -> build -> smoke -> deploy. 'smoke' reads target/release/, so it
only means anything after 'build'.

The gate is deliberately one job, not one per surface: the surfaces share most of their crates,
so a per-surface split recompiles them once per lane. See the header of this file for the
measurement.
`;

async function main(): Promise<number> {
  const args = Bun.argv.slice(2);
  const command = args[0];
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(usage);
    return command ? 0 : 2;
  }

  if (command === "list") {
    for (const surface of surfaces) {
      const crates = await closure(surface);
      process.stdout.write(
        `${surface.name.padEnd(8)} ${String(crates.length).padStart(2)} crates  tag ${surface.tagPrefix.padEnd(10)} ${surface.description}\n`,
      );
    }
    return 0;
  }

  if (command === "plan") {
    const baseIndex = args.indexOf("--base");
    const base = baseIndex >= 0 ? (args[baseIndex + 1] ?? "origin/main") : "origin/main";
    const head = args.includes("--worktree") ? "WORKTREE" : "HEAD";
    const files = await changedFiles(base, head);
    const result = await plan(files, base, head);
    if (args.includes("--json")) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return 0;
    }
    process.stdout.write(
      `${result.files} changed file(s) between ${base} and ${head}\n` +
        `lanes: ${result.surfaces.length ? result.surfaces.join(", ") : "none"}\n` +
        `reason: ${result.reason}\n`,
    );
    return 0;
  }

  // `gate` without a surface name is the CI entry point: it derives the union itself.
  if (command === "gate" && (args.length === 1 || args[1]?.startsWith("--"))) {
    const baseIndex = args.indexOf("--base");
    const base = baseIndex >= 0 ? (args[baseIndex + 1] ?? "origin/main") : "origin/main";
    const head = args.includes("--worktree") ? "WORKTREE" : "HEAD";
    const result = await plan(await changedFiles(base, head), base, head);
    if (!result.surfaces.length) {
      process.stdout.write(
        `✓ no shipped surface is reachable from ${result.files} changed file(s) — nothing to gate\n`,
      );
      return 0;
    }
    const crates = await unionClosure(result.surfaces);
    process.stdout.write(
      `surfaces: ${result.surfaces.join(", ")} (${result.reason})\n` +
        `gating ${crates.length} of 47 workspace crates in one pass\n`,
    );
    return await runAll([clippyArgv(crates)], `gate ${result.surfaces.join("+")}`);
  }

  const name = args[1];
  if (!name) {
    process.stderr.write(`${command} needs a surface name.\n\n${usage}`);
    return 2;
  }
  const surface = surfaceByName(name);

  switch (command) {
    case "paths":
      for (const path of await paths(surface)) process.stdout.write(`${path}\n`);
      return 0;
    case "closure":
      for (const crate of await closure(surface)) process.stdout.write(`${crate}\n`);
      return 0;
    case "gate":
      return await runAll([clippyArgv(await closure(surface))], `gate ${surface.name}`);
    case "build":
      return await runAll(surface.build, `build ${surface.name}`);
    case "smoke":
      return await runAll(surface.smoke, `smoke ${surface.name}`);
    case "deploy":
      process.stderr.write(
        `Deployment for ${surface.name} is owned by Aphrody @aphrody/workspace. Inspect bun run infra --help and use its release workflow; local upstream deployment scripts are historical references.\n`,
      );
      return 2;
    default:
      process.stderr.write(`Unknown command ${JSON.stringify(command)}.\n\n${usage}`);
      return 2;
  }
}

if (import.meta.main) process.exitCode = await main();

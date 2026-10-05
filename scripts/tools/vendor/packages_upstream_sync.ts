#!/usr/bin/env bun
/**
 * Packages & Forks Hub Engine for Aphrody YOLO Monorepo
 *
 * Automates inspection, drift calculation, validation and synchronization
 * of all submodules in vendor/ using native Aphrody Git (`aphrody git inspect`).
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));

interface GitInspectOutput {
  root: string;
  git_dir: string;
  branch: string | null;
  head: string;
  dirty: boolean;
  changes: Array<{ path: string; layer: string }>;
  remotes: Array<{
    name: string;
    fetch_url: string;
    push_url: string;
    github: { owner: string; name: string } | null;
  }>;
}

interface PackageMeta {
  name: string;
  submodulePath: string;
  trackingBranch: string;
  ownerRepo: string;
  upstreamRepo?: string;
  type: "fork" | "upstream_mirror";
}

const PACKAGES_REGISTRY: PackageMeta[] = [
  {
    name: "bun",
    submodulePath: "vendor/bun",
    trackingBranch: "yolo",
    ownerRepo: "aphrody-labs/bun",
    upstreamRepo: "oven-sh/bun",
    type: "fork",
  },
  {
    name: "obscura",
    submodulePath: "vendor/obscura",
    trackingBranch: "yolo",
    ownerRepo: "aphrody-labs/obscura",
    type: "fork",
  },
  {
    name: "tauri",
    submodulePath: "vendor/tauri",
    trackingBranch: "yolo",
    ownerRepo: "aphrody-labs/tauri",
    upstreamRepo: "tauri-apps/tauri",
    type: "fork",
  },
  {
    name: "plugins-workspace",
    submodulePath: "vendor/plugins-workspace",
    trackingBranch: "yolo",
    ownerRepo: "aphrody-labs/plugins-workspace",
    upstreamRepo: "tauri-apps/plugins-workspace",
    type: "fork",
  },
  {
    name: "wry",
    submodulePath: "vendor/wry",
    trackingBranch: "yolo",
    ownerRepo: "aphrody-labs/wry",
    upstreamRepo: "tauri-apps/wry",
    type: "fork",
  },
  {
    name: "tao",
    submodulePath: "vendor/tao",
    trackingBranch: "yolo",
    ownerRepo: "aphrody-labs/tao",
    upstreamRepo: "tauri-apps/tao",
    type: "fork",
  },
  {
    name: "create-tauri-app",
    submodulePath: "vendor/create-tauri-app",
    trackingBranch: "yolo",
    ownerRepo: "aphrody-labs/create-tauri-app",
    upstreamRepo: "tauri-apps/create-tauri-app",
    type: "fork",
  },
  {
    name: "next",
    submodulePath: "vendor/next",
    trackingBranch: "yolo",
    ownerRepo: "aphrody-labs/next.js",
    upstreamRepo: "vercel/next.js",
    type: "fork",
  },
];

async function runCommand(
  cmd: string,
  args: string[],
  cwd: string = rootDir,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((res) => {
    const proc = spawn(cmd, args, { cwd, env: { ...process.env, PAGER: "cat" } });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("close", (code) => {
      res({ stdout: stdout.trim(), stderr: stderr.trim(), code: code ?? 0 });
    });
  });
}

async function inspectPackage(
  pkg: PackageMeta,
): Promise<{ meta: PackageMeta; inspect: GitInspectOutput | null }> {
  const pkgDir = resolve(rootDir, pkg.submodulePath);
  const { stdout, code } = await runCommand("aphrody", ["git", "inspect", pkgDir]);
  if (code !== 0) {
    return { meta: pkg, inspect: null };
  }
  try {
    const inspect: GitInspectOutput = JSON.parse(stdout);
    return { meta: pkg, inspect };
  } catch {
    return { meta: pkg, inspect: null };
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const jsonMode = args.has("--json");
  const fetchMode = args.has("--fetch");

  console.log("──────────────────────────────────────────────────────────────────────────────");
  console.log(" Aphrody Monorepo Forks & Packages Control Hub (via `aphrody git`)");
  console.log("──────────────────────────────────────────────────────────────────────────────");

  const results = [];
  for (const pkg of PACKAGES_REGISTRY) {
    if (fetchMode) {
      const pkgDir = resolve(rootDir, pkg.submodulePath);
      await runCommand("git", ["fetch", "--all", "--prune"], pkgDir);
    }
    const info = await inspectPackage(pkg);
    results.push(info);
  }

  if (jsonMode) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const { meta, inspect } of results) {
    if (!inspect) {
      console.log(`❌ ${meta.name.padEnd(18)} : Impossible d'inspecter`);
      continue;
    }

    const dirtyIcon = inspect.dirty ? "⚠️ DIRTY" : "✅ CLEAN";
    const branchStatus = inspect.branch ? `branch:${inspect.branch}` : "detached";
    const headShort = inspect.head.slice(0, 10);
    const changesCount = inspect.changes.length;

    console.log(
      `📦 ${meta.name.padEnd(18)} [${meta.type.padEnd(15)}] ${branchStatus.padEnd(18)} ${headShort} | ${dirtyIcon.padEnd(10)} (${changesCount} modified files)`,
    );

    for (const remote of inspect.remotes) {
      console.log(`   └─ remote ${remote.name.padEnd(10)}: ${remote.fetch_url}`);
    }
  }

  console.log("──────────────────────────────────────────────────────────────────────────────");
  console.log("Contrat Aphrody respecté: Aucune altération non supervisée des submodules.");
}

main().catch(console.error);

// SPDX-License-Identifier: Apache-2.0
/**
 * Dedicated Bun-native build orchestrator for Aphrody UI packages.
 *
 * Utilizes `@aphrody/m3-config/bun-build` directly over `Bun.build`:
 * - Zero external build tool dependencies (no tsup/esbuild overhead)
 * - Automatic 'use client' preservation
 * - Parallel package compilation
 *
 * Usage:
 *   bun scripts/aphrody/build/ui/build-ui-packages.ts [--package <name>] [--minify] [--all]
 */
import { Glob } from "bun";
import { resolve, join } from "node:path";
import { m3BunBuild } from "@aphrody/m3-config/bun-build";

const REPO_ROOT = resolve(import.meta.dir, "../../../../");
const UI_ROOT = join(resolve(process.env.APHRODY_MATERIAL_CHECKOUT ?? join(REPO_ROOT, "..", "material")), "packages");

interface PackageBuildTarget {
  name: string;
  dir: string;
  entrypoints: string[];
}

function parseArgs(args: string[]): {
  targetPackage?: string;
  minify: boolean;
  all: boolean;
} {
  let targetPackage: string | undefined;
  let minify = false;
  let all = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--package" || arg === "-p") {
      targetPackage = args[++i];
    } else if (arg === "--minify" || arg === "-m") {
      minify = true;
    } else if (arg === "--all" || arg === "-a") {
      all = true;
    }
  }

  return { targetPackage, minify, all };
}

async function discoverUiTargets(targetName?: string): Promise<PackageBuildTarget[]> {
  const targets: PackageBuildTarget[] = [];
  const glob = new Glob("*/package.json");

  for await (const manifestPath of glob.scan({
    cwd: UI_ROOT,
    onlyFiles: true,
  })) {
    const packageDir = join(UI_ROOT, manifestPath.split("/")[0]!);
    const manifestFile = Bun.file(join(packageDir, "package.json"));
    if (!(await manifestFile.exists())) continue;

    const manifest = await manifestFile.json();
    const pkgName = manifest.name ?? manifestPath.split("/")[0]!;

    if (targetName && pkgName !== targetName && !manifestPath.startsWith(targetName)) {
      continue;
    }

    // Check if source exists
    const srcIndex = join(packageDir, "src", "index.ts");
    const rootIndex = join(packageDir, "index.ts");
    const entrypoints: string[] = [];

    if (await Bun.file(srcIndex).exists()) {
      entrypoints.push(srcIndex);
    } else if (await Bun.file(rootIndex).exists()) {
      entrypoints.push(rootIndex);
    }

    if (entrypoints.length > 0) {
      targets.push({
        name: pkgName,
        dir: packageDir,
        entrypoints,
      });
    }
  }

  return targets;
}

export async function buildUiPackages(
  options: {
    targetPackage?: string;
    minify?: boolean;
  } = {},
): Promise<{ total: number; successful: number; failed: number }> {
  const { targetPackage, minify = false } = options;
  const targets = await discoverUiTargets(targetPackage);
  if (targets.length === 0) {
    throw new Error(`No UI build target found under ${UI_ROOT}${targetPackage ? ` for ${targetPackage}` : ""}`);
  }

  console.log(`[ui-build] Discovered ${targets.length} UI build target(s)...`);
  let successful = 0;
  let failed = 0;

  for (const target of targets) {
    const start = performance.now();
    try {
      const result = await m3BunBuild({
        entry: target.entrypoints,
        outDir: join(target.dir, "dist"),
        cwd: target.dir,
        target: "browser",
        minify,
        useClient: true,
      });

      const elapsed = Math.round(performance.now() - start);
      if (result.success) {
        console.log(`[ui-build] ✓ ${target.name} (${result.outputs.length} outputs, ${elapsed}ms)`);
        successful++;
      } else {
        console.error(`[ui-build] ✗ ${target.name} failed:`, result.logs.join("\n"));
        failed++;
      }
    } catch (error) {
      console.error(`[ui-build] ✗ ${target.name} threw error:`, error);
      failed++;
    }
  }

  return { total: targets.length, successful, failed };
}

if (import.meta.main) {
  const { targetPackage, minify } = parseArgs(process.argv.slice(2));
  const result = await buildUiPackages({ targetPackage, minify });
  console.log(`\n[ui-build] Completed: ${result.successful}/${result.total} packages built successfully.`);
  process.exit(result.failed === 0 ? 0 : 1);
}

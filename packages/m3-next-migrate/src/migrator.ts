// SPDX-License-Identifier: Apache-2.0
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { buildRouteHierarchy, type RouteHierarchy } from "./layout";
import { scanNextDirectory, type ScanStats } from "./scanner";
import { scaffoldTargetProject } from "./scaffolder";
import { transformComponent, type TransformOptions, type TransformResult } from "./transform";

export interface MigrateProjectOptions extends TransformOptions {
  sourceDir: string;
  targetDir: string;
  projectName?: string;
  scaffold?: boolean;
  dryRun?: boolean;
}

export interface MigrateProjectReport {
  stats: ScanStats;
  hierarchy: RouteHierarchy;
  migratedFiles: number;
  unmodifiedFiles: number;
  copiedAssets: number;
  transformDetails: Array<{
    file: string;
    transformations: string[];
    warnings: string[];
  }>;
}

export async function migrateProject(options: MigrateProjectOptions): Promise<MigrateProjectReport> {
  const {
    sourceDir,
    targetDir,
    projectName = "migrated-app",
    target = "tauri",
    scaffold = true,
    dryRun = false,
    modernizeM3 = false,
  } = options;

  // 1. Scan source directory
  const scanStats = await scanNextDirectory(sourceDir);

  // 2. Build route hierarchy for App Router layouts & pages
  const hierarchy = buildRouteHierarchy([...scanStats.layouts, ...scanStats.pages]);

  const report: MigrateProjectReport = {
    stats: scanStats,
    hierarchy,
    migratedFiles: 0,
    unmodifiedFiles: 0,
    copiedAssets: 0,
    transformDetails: [],
  };

  // 3. Scaffold destination project if requested
  if (scaffold && !dryRun) {
    await scaffoldTargetProject({
      projectName,
      target,
      outDir: targetDir,
      modernizeM3,
      hierarchy,
    });
  }

  // 4. Walk and process files
  async function processDir(currentPath: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const srcFile = join(currentPath, entry.name);
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === "dist" ||
        entry.name === ".git" ||
        entry.name === ".turbo"
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        await processDir(srcFile);
      } else {
        const rel = relative(sourceDir, srcFile);
        const isComponent = /\.(tsx|jsx|ts|js)$/.test(entry.name);
        const destFile = scaffold ? join(targetDir, "src", "components", rel) : join(targetDir, rel);

        if (isComponent) {
          const content = await readFile(srcFile, "utf-8");
          const result: TransformResult = transformComponent(content, options);

          if (result.modified) {
            report.migratedFiles++;
            report.transformDetails.push({
              file: rel,
              transformations: result.transformations,
              warnings: result.warnings,
            });
          } else {
            report.unmodifiedFiles++;
          }

          if (!dryRun) {
            await mkdir(dirname(destFile), { recursive: true });
            await writeFile(destFile, result.code);
          }
        } else {
          // Asset, CSS, JSON, or config file
          report.copiedAssets++;
          if (!dryRun) {
            const assetDest = entry.name.endsWith(".css")
              ? join(targetDir, "src", rel)
              : join(targetDir, "public", rel);
            await mkdir(dirname(assetDest), { recursive: true });
            await copyFile(srcFile, assetDest);
          }
        }
      }
    }
  }

  await processDir(sourceDir);

  return report;
}

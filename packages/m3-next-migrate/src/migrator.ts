// SPDX-License-Identifier: Apache-2.0
// Filesystem traversal and writes are serialized to bound I/O and preserve preflight/order guarantees.
// oxlint-disable no-await-in-loop
import {
  assertNativeShellOwner,
  assertPrivateOwnerWorkspace,
} from "@aphrody/scaffold";
import { existsSync, realpathSync } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { inSkipped, skippedSpans } from "@aphrody/next-bun/codemods/lex";
import { qualifyDependencies } from "./dependencies";
import { buildRouteHierarchy, type RouteHierarchy } from "./layout";
import { scanNextDirectory, type ScanStats } from "./scanner";
import {
  assertMigrationRequirements,
  migrationRequirements,
  type MigrationRequirement,
} from "./requirements";
import { scaffoldTargetProject } from "./scaffolder";
import {
  transformComponent,
  type TransformOptions,
  type TransformResult,
} from "./transform";

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
  /** Native host contracts that must qualify before activation; dry runs remain inspectable. */
  requirements: MigrationRequirement[];
  /** Excluded project configuration, protected files and symbolic links. */
  skippedFiles: string[];
  transformDetails: Array<{
    file: string;
    transformations: string[];
    warnings: string[];
  }>;
}

/** Preserve source-root aliases after moving modules under the consumer components tree. */
function rewriteSourceAliases(
  code: string,
  file: string,
  sourceDir: string,
): string {
  const spans = skippedSpans(code);
  return code.replace(
    /((?:from\s+|(?:import|require)\s*\(\s*|import\s+)(['"]))(@\/[^'"]+)(\2)/g,
    (
      match,
      prefix: string,
      _quote: string,
      specifier: string,
      suffix: string,
      offset: number,
    ) => {
      if (inSkipped(spans, offset)) return match;
      const subpath = specifier.slice(2);
      const roots = [resolve(sourceDir), resolve(sourceDir, "src")];
      const extensions = [
        "",
        ".tsx",
        ".ts",
        ".jsx",
        ".js",
        ".json",
        ".css",
        "/index.tsx",
        "/index.ts",
        "/index.jsx",
        "/index.js",
      ];
      const moduleRoot = roots.find((root) =>
        extensions.some((extension) => {
          const candidate = resolve(root, subpath + extension);
          const inside = relative(resolve(sourceDir), candidate);
          if (
            isAbsolute(inside) ||
            inside === ".." ||
            inside.startsWith(`..${sep}`) ||
            !existsSync(candidate)
          )
            return false;
          const canonical = relative(
            realpathSync(sourceDir),
            realpathSync(candidate),
          );
          return (
            !isAbsolute(canonical) &&
            canonical !== ".." &&
            !canonical.startsWith(`..${sep}`)
          );
        }),
      );
      if (!moduleRoot)
        throw new Error(
          `Cannot resolve source alias ${specifier} in ${relative(sourceDir, file)}; preserve its native source owner before migration`,
        );
      const destination = relative(
        dirname(file),
        resolve(moduleRoot, subpath),
      ).replaceAll("\\", "/");
      return (
        prefix +
        (destination.startsWith(".") ? destination : "./" + destination) +
        suffix
      );
    },
  );
}

export async function migrateProject(
  options: MigrateProjectOptions,
): Promise<MigrateProjectReport> {
  const {
    sourceDir,
    targetDir,
    projectName = "migrated-app",
    target = "tauri",
    scaffold = true,
    dryRun = false,
    modernizeM3 = false,
  } = options;

  const destination = relative(resolve(sourceDir), resolve(targetDir));
  if (
    !destination ||
    (!isAbsolute(destination) &&
      destination !== ".." &&
      !destination.startsWith(`..${sep}`))
  ) {
    throw new Error("Migration target must be outside the source tree");
  }

  if (scaffold && !dryRun) {
    assertPrivateOwnerWorkspace(targetDir);
    assertNativeShellOwner(target);
  }

  // 1. Scan source directory
  const scanStats = await scanNextDirectory(sourceDir);

  // 2. Build route hierarchy for App Router layouts & pages
  const hierarchy = buildRouteHierarchy([
    ...scanStats.layouts,
    ...scanStats.pages,
  ]);

  const report: MigrateProjectReport = {
    stats: scanStats,
    hierarchy,
    migratedFiles: 0,
    unmodifiedFiles: 0,
    copiedAssets: 0,
    requirements: [],
    skippedFiles: [],
    transformDetails: [],
  };

  // Qualify every transformed module before creating any destination files.
  const sourceModules = scanStats.files.filter(
    (file) =>
      !relative(sourceDir, file.path)
        .replaceAll("\\", "/")
        .startsWith("public/"),
  );
  const transformed = new Map<string, TransformResult>();
  const dependencies: Record<string, string> = {};
  for (const file of sourceModules) {
    const source = await Bun.file(file.path).text();
    report.requirements.push(
      ...migrationRequirements(relative(sourceDir, file.path), source),
    );
    const result = transformComponent(source, options);
    const resolved = rewriteSourceAliases(result.code, file.path, sourceDir);
    if (resolved !== result.code) {
      result.code = resolved;
      result.modified = true;
      result.transformations.push(
        "Resolved source-root aliases to preserved relative module paths",
      );
    }
    if (!dryRun) {
      const loader = file.path.endsWith(".tsx")
        ? "tsx"
        : file.path.endsWith(".jsx")
          ? "jsx"
          : file.path.endsWith(".ts")
            ? "ts"
            : "js";
      try {
        new Bun.Transpiler({ loader }).transformSync(result.code);
      } catch {
        throw new Error(
          `Cannot activate migrated module ${relative(sourceDir, file.path)}: its transformed syntax is invalid; backend async work requires a native host adapter`,
        );
      }
    }
    if (scaffold) {
      const contract = qualifyDependencies(
        relative(sourceDir, file.path),
        result.code,
        sourceDir,
      );
      Object.assign(dependencies, contract.dependencies);
      report.requirements.push(...contract.requirements);
    }
    transformed.set(file.path, result);
  }

  if (!dryRun) assertMigrationRequirements(report.requirements);

  // 3. Scaffold destination project if requested
  if (scaffold && !dryRun) {
    await scaffoldTargetProject({
      projectName,
      target,
      outDir: targetDir,
      modernizeM3,
      hierarchy,
      dependencies,
    });
  }

  // 4. Walk and process files
  async function processDir(currentPath: string) {
    const entries = await readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const srcFile = join(currentPath, entry.name);
      const rel = relative(sourceDir, srcFile).replaceAll("\\", "/");
      const publicAsset = rel.startsWith("public/");
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === "dist" ||
        entry.name === ".git" ||
        entry.name === ".turbo" ||
        entry.isSymbolicLink() ||
        (!publicAsset && entry.name.startsWith(".")) ||
        entry.name.startsWith(".env") ||
        (!publicAsset &&
          /^(?:package\.json|(?:bun|package|yarn|pnpm).*lock.*|tsconfig(?:\..+)?\.json|next-env\.d\.ts|(?:next|postcss|tailwind|vite)\.config\..+)$/.test(
            entry.name,
          ))
      ) {
        report.skippedFiles.push(rel);
        continue;
      }

      if (entry.isDirectory()) {
        await processDir(srcFile);
      } else {
        const isComponent = /\.(tsx|jsx|ts|js)$/.test(entry.name);
        const destFile = scaffold
          ? join(targetDir, "src", "components", rel)
          : join(targetDir, rel);

        if (isComponent && !publicAsset) {
          const result =
            transformed.get(srcFile) ??
            transformComponent(await Bun.file(srcFile).text(), options);

          if (result.modified) report.migratedFiles++;
          else report.unmodifiedFiles++;
          if (result.modified || result.warnings.length > 0) {
            report.transformDetails.push({
              file: rel,
              transformations: result.transformations,
              warnings: result.warnings,
            });
          }

          if (!dryRun) {
            await mkdir(dirname(destFile), { recursive: true });
            await Bun.write(destFile, result.code);
          }
        } else {
          // Asset, CSS, JSON, or config file
          report.copiedAssets++;
          if (!dryRun) {
            // Keep imports relative to their source module; public assets keep their URL root.
            const assetDest = !scaffold
              ? join(targetDir, rel)
              : publicAsset
                ? join(targetDir, rel)
                : join(targetDir, "src", "components", rel);
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

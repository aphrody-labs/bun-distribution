#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0

import { resolve } from "node:path";
import { buildRouteHierarchy } from "./layout";
import { migrateProject } from "./migrator";
import { scanNextDirectory } from "./scanner";
import { transformComponent } from "./transform";

function printHelp() {
  console.log(`
@aphrody/m3-next-migrate — Next.js 16 to Tauri v2 & Bun/Vite Component Migrator

USAGE:
  next-migrate [OPTIONS] <SOURCE_PATH> [TARGET_PATH]

ARGUMENTS:
  <SOURCE_PATH>   Path to a Next.js 16 project root or single component file (.tsx/.jsx)
  [TARGET_PATH]   Destination directory for the migrated app or component

OPTIONS:
  -t, --target <tauri|vite>    Target platform (default: tauri)
  --name <string>              Target project name (default: migrated-app)
  --m3                         Modernize UI components to authentic @aphrody/m3-primitives (Button, Input, Card, Badge, Tooltip, Collapsible)
  --n2b                        Apply aggressive Node-to-Bun transforms (default: true)
  --scan-only                  Perform analysis/scan and display detected Next.js features without migrating
  --dry-run                    Preview transformations without writing files to disk
  --no-scaffold                Only migrate component files, don't generate project structure (tauri.conf.json, vite.config.ts, etc.)
  --json                       Output report as JSON
  -h, --help                   Show this help message
  -v, --version                Show version

EXAMPLES:
  # Migrate a Next.js 16 app to a Tauri v2 desktop application with authentic M3 components
  next-migrate ./my-next-app ./my-tauri-app --target tauri --m3

  # Migrate a Next.js 16 app to a Vite + Bun web SPA
  next-migrate ./my-next-app ./my-vite-app --target vite --m3

  # Scan a Next.js 16 directory and report Next features & components
  next-migrate ./my-next-app --scan-only

  # Migrate a single component file in place
  next-migrate ./components/Hero.tsx
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  if (args.includes("-v") || args.includes("--version")) {
    console.log("3.3.0");
    process.exit(0);
  }

  let sourcePath = "";
  let targetPath = "";
  let target: "tauri" | "vite" = "tauri";
  let projectName = "migrated-app";
  let scanOnly = false;
  let dryRun = false;
  let scaffold = true;
  let jsonOutput = false;
  let modernizeM3 = false;
  let n2b = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-t" || arg === "--target") {
      target = args[++i] === "vite" ? "vite" : "tauri";
    } else if (arg === "--name") {
      projectName = args[++i] || projectName;
    } else if (arg === "--m3") {
      modernizeM3 = true;
    } else if (arg === "--n2b") {
      n2b = true;
    } else if (arg === "--no-n2b") {
      n2b = false;
    } else if (arg === "--scan-only") {
      scanOnly = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--no-scaffold") {
      scaffold = false;
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (!arg.startsWith("-")) {
      if (!sourcePath) {
        sourcePath = arg;
      } else if (!targetPath) {
        targetPath = arg;
      }
    }
  }

  if (!sourcePath) {
    console.error("Error: <SOURCE_PATH> is required.");
    process.exit(1);
  }

  const resolvedSource = resolve(process.cwd(), sourcePath);

  // Check if source is a single file
  const isSingleFile = /\.(tsx|jsx|ts|js)$/.test(resolvedSource);

  if (isSingleFile) {
    const content = await Bun.file(resolvedSource).text();
    const result = transformComponent(content, { target, modernizeM3, n2b });

    if (jsonOutput) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (dryRun) {
      console.log(`[DRY-RUN] Transformed ${sourcePath}:`);
      console.log(result.code);
    } else if (targetPath) {
      const resolvedTarget = resolve(process.cwd(), targetPath);
      await Bun.write(resolvedTarget, result.code);
      console.log(`Migrated single component to ${resolvedTarget}`);
    } else {
      console.log(result.code);
    }
    return;
  }

  // Scan only mode
  if (scanOnly) {
    const stats = await scanNextDirectory(resolvedSource);
    const hierarchy = buildRouteHierarchy([...stats.layouts, ...stats.pages]);

    if (jsonOutput) {
      console.log(JSON.stringify({ stats, hierarchy }, null, 2));
      return;
    }

    console.log(`\n=== Next.js 16 Scan Audit: ${resolvedSource} ===\n`);
    console.log(`Total files scanned:    ${stats.totalFiles}`);
    console.log(`Client components:     ${stats.clientComponents}`);
    console.log(`Server components:     ${stats.serverComponents}`);
    console.log(`Server actions:        ${stats.serverActions}`);
    console.log(`API routes:            ${stats.apiRoutes}`);
    console.log(`App Router Layouts:    ${stats.layouts.length}`);
    console.log(`App Router Pages:      ${stats.pages.length}`);
    console.log(`Metadata definitions:  ${stats.metadataCount}`);
    console.log(`generateMetadata uses: ${stats.generateMetadataCount}`);
    console.log(`M3 candidate UI calls: ${stats.m3CandidateCount} (${stats.m3DetectedComponents.join(", ") || "none"})`);
    console.log(`next/navigation uses:  ${stats.navigationUsages}`);
    console.log(`next/link uses:        ${stats.linkUsages}`);
    console.log(`next/image uses:       ${stats.imageUsages}`);
    console.log(`next/font uses:        ${stats.fontUsages}`);
    console.log(`next/dynamic uses:     ${stats.dynamicUsages}`);
    console.log(`next/headers uses:     ${stats.headersUsages}`);
    console.log(`next/form uses:        ${stats.formUsages}`);
    console.log(`Public Env Vars:       ${stats.envVars.join(", ") || "(none)"}`);

    if (hierarchy.routes.length > 0) {
      console.log(`\nDetected Route Hierarchy:`);
      for (const r of hierarchy.routes) {
        console.log(`  ${r.routePath.padEnd(24)} -> ${r.pageFile} (layouts: ${r.layouts.length})`);
      }
    }

    console.log(`\nReady to migrate with: next-migrate ${sourcePath} <DEST> --target ${target} --m3\n`);
    return;
  }

  if (!targetPath) {
    targetPath = `${sourcePath}-${target}`;
  }

  const resolvedTarget = resolve(process.cwd(), targetPath);
  console.log(`Starting migration: Next.js 16 -> ${target.toUpperCase()} (${resolvedTarget})...`);

  const report = await migrateProject({
    sourceDir: resolvedSource,
    targetDir: resolvedTarget,
    target,
    projectName,
    scaffold,
    dryRun,
    modernizeM3,
    n2b,
  });

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\n=== Migration Report ===`);
  console.log(`Target Platform:     ${target.toUpperCase()} 2.0 (Bun Native)`);
  console.log(`Files Processed:     ${report.stats.totalFiles}`);
  console.log(`Migrated React:      ${report.migratedFiles}`);
  console.log(`Unmodified:          ${report.unmodifiedFiles}`);
  console.log(`Assets Copied:       ${report.copiedAssets}`);
  console.log(`Scaffolded:          ${scaffold ? "YES" : "NO"}`);
  console.log(`M3 Modernization:    ${modernizeM3 ? "ENABLED" : "DISABLED"}`);
  console.log(`Routes Generated:    ${report.hierarchy.routes.length}`);
  console.log(`Layouts Composed:    ${report.hierarchy.layouts.length}`);
  console.log(`Output Directory:    ${resolvedTarget}\n`);

  if (report.transformDetails.length > 0) {
    console.log(`Details:`);
    for (const item of report.transformDetails.slice(0, 10)) {
      console.log(` - ${item.file} -> ${item.transformations.join(", ")}`);
    }
    if (report.transformDetails.length > 10) {
      console.log(`   ...and ${report.transformDetails.length - 10} more files`);
    }
  }

  console.log(`\nNext Steps:`);
  console.log(`  cd ${targetPath}`);
  console.log(`  bun install`);
  if (target === "tauri") {
    console.log(`  bun run tauri:dev   # Desktop GUI with Tauri v2`);
    console.log(`  bun run dev:bun     # Desktop native backend with Bun.serve`);
  } else {
    console.log(`  bun run dev`);
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

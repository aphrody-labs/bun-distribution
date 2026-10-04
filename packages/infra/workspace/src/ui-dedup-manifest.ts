// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

async function hashFile(path: string): Promise<string> {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

async function collectFiles(
  dir: string,
  base: string = dir,
): Promise<Map<string, { fullPath: string; hash: string; size: number }>> {
  const files = new Map<string, { fullPath: string; hash: string; size: number }>();
  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "dist", "target", "ui-dist"].includes(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        const rel = relative(base, full).replace(/\\/g, "/");
        const h = await hashFile(full);
        const s = (await stat(full)).size;
        files.set(rel, { fullPath: full, hash: h, size: s });
      }
    }
  }
  await walk(dir);
  return files;
}

function fingerprints(files: Map<string, { hash: string; size: number }>) {
  return Object.fromEntries(
    [...files.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, { hash, size }]) => [path, { sha256: hash, size }]),
  );
}

export async function runUiDedupManifest(args: string[]): Promise<number> {
  let root = process.cwd();
  let output: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") root = args[++index] ?? "";
    else if (arg === "--output") output = args[++index] ?? "";
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: aphrody-ops ui-dedup-manifest [--root <aphrody-ui>] [--output <path>]");
      return 0;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!root) throw new Error("--root requires an aphrody-ui repository path");
  root = resolve(root);
  const at = (...parts: string[]) => join(root, ...parts);
  const date = new Date().toISOString().split("T")[0];
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (head.exitCode !== 0) throw new Error("Cannot identify the Git baseline commit");

  // Cluster 1
  const appUiFiles = await collectFiles(at("design/aphrody-m3/packages/app-ui/src"));
  const driveFiles = await collectFiles(at("drive/packages/interface/src"));
  let cluster1Identical = 0;
  const cluster1Divergent: string[] = [];
  const cluster1AppOnly: string[] = [];
  const cluster1DriveOnly: string[] = [];

  for (const [rel, info] of appUiFiles.entries()) {
    if (driveFiles.has(rel)) {
      if (info.hash === driveFiles.get(rel)!.hash) cluster1Identical++;
      else cluster1Divergent.push(rel);
    } else {
      cluster1AppOnly.push(rel);
    }
  }
  for (const [rel] of driveFiles.entries()) {
    if (!appUiFiles.has(rel)) cluster1DriveOnly.push(rel);
  }

  // Cluster 2
  const assetsFiles = await collectFiles(at("packages/assets"));
  const spaceIconsFiles = await collectFiles(at("packages/aphrody-spaceui/packages/icons"));
  let cluster2Identical = 0;
  const cluster2Divergent: string[] = [];
  for (const [rel, info] of spaceIconsFiles.entries()) {
    if (assetsFiles.has(rel)) {
      if (info.hash === assetsFiles.get(rel)!.hash) cluster2Identical++;
      else cluster2Divergent.push(rel);
    }
  }

  // Cluster 3
  // Monorepo layout first (`crates/ui/app`); the legacy aphrody-ui checkout keeps `crates/aphrody-app`.
  const uiDistDir =
    ["crates/ui/app/ui-dist", "crates/aphrody-app/ui-dist"]
      .map((path) => at(path))
      .find((path) => existsSync(path)) ?? at("crates/ui/app/ui-dist");
  const uiDistFiles = await collectFiles(uiDistDir);

  // Cluster 10: the upstream SpaceUI showcase is now a pointer to its M3/Bun port.
  const spaceUiShowcasePointer = await collectFiles(
    at("packages/aphrody-spaceui/examples/showcase"),
  );
  const m3SpaceUiShowcase = await collectFiles(at("examples/m3-spaceui-showcase"));

  const manifest = {
    date,
    repository: "aphrody-ui",
    commit: head.stdout.toString().trim(),
    note: "Fingerprints describe the current working tree, including uncommitted edits; statuses are not release proof.",
    clusters: {
      cluster1_app_ui_vs_drive_interface: {
        status: "overlap-measured",
        decision:
          "Both active hosts import design/aphrody-m3/packages/app-ui. The old @aphrody/drive package metadata is retired; retain its excluded FSL source archive until unique code and provenance are reviewed.",
        identicalCount: cluster1Identical,
        divergentCount: cluster1Divergent.length,
        divergentPaths: cluster1Divergent.sort(),
        appOnlyCount: cluster1AppOnly.length,
        driveOnlyCount: cluster1DriveOnly.length,
        driveOnlyPaths: cluster1DriveOnly.sort(),
        appUiFiles: fingerprints(appUiFiles),
        driveInterfaceFiles: fingerprints(driveFiles),
      },
      cluster2_assets_vs_spaceui_icons: {
        status: "overlap-measured",
        decision:
          "@aphrody/assets is the only production import path; the six SpaceUI differences were classified and the MIT reference remains for provenance.",
        identicalCount: cluster2Identical,
        divergentCount: cluster2Divergent.length,
        divergentFiles: cluster2Divergent.sort(),
        assetFiles: fingerprints(assetsFiles),
        spaceuiIconFiles: fingerprints(spaceIconsFiles),
      },
      cluster3_ui_dist: {
        status: "generated-output-inventory",
        decision:
          "The tracked Tauri output exists; two clean builds and an installed bundle are required to prove reproducibility.",
        totalFiles: uiDistFiles.size,
        files: fingerprints(uiDistFiles),
      },
      cluster4_koharu_internal_controls: {
        status: "counts-stale",
        decision:
          "Earlier imported/unimported control counts predate removal of unused wrappers; remaining candidates need a fresh import and behavior inventory.",
      },
      cluster5_m3_explorer_vs_app_ui: {
        status: "partial-integration",
        decision:
          "design/aphrody-m3/packages/app-ui consumes TagPill, RenameInput, and FileThumb; GridItem and live Files behavior proof remain.",
        integratedComponents: ["TagPill", "RenameInput", "FileThumb"],
      },
      cluster6_forms_primitives_vs_m3_forms: {
        status: "contract-documented",
        decision:
          "@aphrody/m3-forms is the primary form package (FormProvider context, fields, labels). @aphrody/m3-primitives provides FormRoot (HTML form element) with Form compatibility alias.",
      },
      cluster7_lit_react_multi_host: {
        status: "documented",
        matrixDocument: "docs/design/M3-COMPONENT-FAMILY-MATRIX.md",
        familiesCount: 18,
      },
      cluster8_spaceui_facades: {
        status: "import-sampled",
        decision:
          "Production packages import @aphrody/m3-* directly. SpaceUI packages remain isolated upstream reference.",
        productionImportsToSpaceUI: 0,
      },
      cluster9_configuration_dedup: {
        status: "existing-preset",
        decision:
          "Generic tsup wrappers and common TypeScript options already use m3-config; remaining package configs carry distinct entries, scopes or plugin sets.",
      },
      cluster10_spaceui_showcase: {
        status: "migrated-reference-pointer",
        decision:
          "The excluded upstream demo source is retired; its MIT reference directory delegates to the maintained Bun/M3 showcase. Lit, React and Next.js examples remain distinct host fixtures.",
        referencePointerFiles: fingerprints(spaceUiShowcasePointer),
        activeM3Files: fingerprints(m3SpaceUiShowcase),
      },
    },
  };

  const destination = resolve(root, output ?? "docs/design/ui-dedup-baseline.json");
  await Bun.write(destination, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${destination} successfully.`);
  return 0;
}

if (import.meta.main) process.exit(await runUiDedupManifest(process.argv.slice(2)));

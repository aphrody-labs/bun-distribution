// SPDX-License-Identifier: Apache-2.0
// `m3-bun migrate`: MUI React to `@aphrody/m3-react` with the codemods of `@aphrody/m3-codemods` (in place, on the
// app's `.tsx`/`.jsx`), and a Next.js app to a Bun M3 app with `@aphrody/m3-next-migrate` (`--next <source>`).
import type { MigrateProjectReport } from "@aphrody/m3-next-migrate";
import { resolve } from "node:path";
import { loadTool } from "./tools-load.ts";

export type CodemodKind = "mui" | "icons";

export interface MigrateFile {
  /** Path relative to the app directory, `/`-separated. */
  path: string;
  /** `MIGRATION-TODO` notes the codemod left for a human. */
  diagnostics: string[];
}

export interface MigrateReport {
  /** Files the codemod changed (written unless `dryRun`). */
  changed: MigrateFile[];
  scanned: number;
  dryRun: boolean;
}

export interface MigrateOptions {
  dir?: string;
  /** Glob of the files to transform, relative to `dir` (default every `.tsx`/`.jsx` outside node_modules and dist). */
  glob?: string;
  /** `mui` (components, imports, props) or `icons` (MUI icons to Material Symbols). Default `mui`. */
  kind?: CodemodKind;
  /** Report without writing. */
  dryRun?: boolean;
}

const SKIP = /(^|\/)(node_modules|dist|bin|release)\//;

/** Run an `@aphrody/m3-codemods` transform over an app's sources. */
export async function migrateApp(options: MigrateOptions = {}): Promise<MigrateReport> {
  const dir = resolve(options.dir ?? process.cwd());
  const { transformSource } = await loadTool("@aphrody/m3-codemods", () => import("@aphrody/m3-codemods"));
  const kind = options.kind ?? "mui";
  const dryRun = options.dryRun ?? false;
  const paths = (
    await Array.fromAsync(new Bun.Glob(options.glob ?? "**/*.{tsx,jsx}").scan({ cwd: dir, onlyFiles: true }))
  )
    .map(path => path.replaceAll("\\", "/"))
    .filter(path => !SKIP.test(path))
    .toSorted();
  const changed: MigrateFile[] = [];
  for (const path of paths) {
    const file = Bun.file(resolve(dir, path));
    // oxlint-disable-next-line no-await-in-loop -- One source at a time: each is read, transformed and written in turn.
    const source = await file.text();
    const result = transformSource(source, kind);
    if (result.source === source) continue;
    changed.push({ path, diagnostics: result.diagnostics });
    // oxlint-disable-next-line no-await-in-loop -- Written right after its own transform.
    if (!dryRun) await Bun.write(file, result.source);
  }
  return { changed, scanned: paths.length, dryRun };
}

export interface MigrateNextOptions {
  /** The Next.js app. */
  source: string;
  /** Output directory, outside `source`. */
  target: string;
  name?: string;
  /** Also run the MUI to M3 codemods on the migrated components. */
  m3?: boolean;
  /** Write the project (default: dry run, which only scans and transforms in memory). */
  write?: boolean;
}

/**
 * Migrate a Next.js app with `migrateProject` of `@aphrody/m3-next-migrate`, on the native Bun web target. A dry run
 * (the default) returns the scan, routes, transforms and the native requirements without creating files.
 */
export async function migrateNext(options: MigrateNextOptions): Promise<MigrateProjectReport> {
  const { migrateProject } = await loadTool("@aphrody/m3-next-migrate", () => import("@aphrody/m3-next-migrate"));
  const sourceDir = resolve(options.source);
  const targetDir = resolve(options.target);
  return migrateProject({
    sourceDir,
    targetDir,
    target: "vite",
    dryRun: options.write !== true,
    modernizeM3: options.m3 ?? false,
    ...(options.name ? { projectName: options.name } : {}),
  });
}

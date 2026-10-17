// SPDX-License-Identifier: Apache-2.0
// `m3-bun lib [dir]`: build an M3 library package in-process with the shared preset of `@aphrody/m3-config/bun-build`
// (`m3BunBuild`): its `build.config.ts` (`m3Package`), the package's dependencies left external and `'use client'`
// on the emitted modules. Outside the M3 workspace this is the same build `scripts/build.ts` runs inside it.
import type { M3BunBuildOptions, M3PackageConfig } from "@aphrody/m3-config/bun-build";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { loadTool } from "./tools-load.ts";

export interface LibraryOptions extends Omit<M3BunBuildOptions, "cwd"> {
  /** Package directory (default: the working directory). */
  dir?: string;
}

export interface LibraryReport {
  success: boolean;
  outDir: string;
  /** The `build.config.ts` applied, if the package has one. */
  config?: string;
  files: Array<{ path: string; bytes: number; zstdBytes: number }>;
  logs: string[];
}

/** Build a library package with `m3BunBuild`; `options` override its `build.config.ts`. */
export async function buildLibrary(options: LibraryOptions = {}): Promise<LibraryReport> {
  const { dir: dirOption, ...overrides } = options;
  const dir = resolve(dirOption ?? process.cwd());
  const { m3BunBuild } = await loadTool("@aphrody/m3-config", () => import("@aphrody/m3-config/bun-build"));
  const configFile = join(dir, "build.config.ts");
  const config = existsSync(configFile)
    ? (
        (await import(Bun.pathToFileURL(configFile).href)) as {
          default?: M3PackageConfig;
        }
      ).default
    : undefined;
  const result = await m3BunBuild({ ...config, ...overrides, cwd: dir });
  const files = await Promise.all(
    result.outputs.map(async output => {
      const bytes = await Bun.file(output.path).bytes();
      return {
        path: relative(result.outDir, output.path).replaceAll("\\", "/"),
        bytes: bytes.length,
        zstdBytes: Bun.zstdCompressSync(bytes).length,
      };
    }),
  );
  return {
    success: result.success,
    outDir: result.outDir,
    ...(config ? { config: configFile } : {}),
    files: files.toSorted((a, b) => a.path.localeCompare(b.path)),
    logs: result.logs,
  };
}

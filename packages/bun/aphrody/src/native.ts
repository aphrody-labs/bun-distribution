// SPDX-License-Identifier: Apache-2.0

import { dlopen, suffix } from "bun:ffi";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const EXPECTED_BUN_RS_ABI_VERSION = 1;

/** Resolve and load the package's bun_rs library with one consistent search policy. */
export function openBunRs(symbols: Record<string, unknown>): any {
  const override = process.env.APHRODY_BUN_FFI_LIB;
  const here = import.meta.dir;
  const fileNames = process.platform === "win32"
    ? [`bun_rs.${suffix}`, `libbun_rs.${suffix}`]
    : [`libbun_rs.${suffix}`, `bun_rs.${suffix}`];
  const candidates: string[] = [];

  if (override) {
    if (!existsSync(override)) throw new Error(`APHRODY_BUN_FFI_LIB points to a missing file: ${override}`);
    candidates.push(override);
  } else {
    for (const name of fileNames) candidates.push(join(here, "..", "native", name));
    const targetDir = join(here, "..", "..", "..", "..", "target");
    for (const profile of ["release", "debug"]) {
      for (const name of fileNames) candidates.push(join(targetDir, profile, name));
    }
    try {
      for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        for (const profile of ["release", "debug"]) {
          for (const name of fileNames) candidates.push(join(targetDir, entry.name, profile, name));
        }
      }
    } catch {
      // Missing target directory is reported with the same actionable error below.
    }
  }

  const libraryPath = candidates.find(existsSync);
  if (!libraryPath) {
    throw new Error(
      `bun_rs native library not found; build aphrody-bun or set APHRODY_BUN_FFI_LIB${override ? ` (${override})` : ""}`,
    );
  }

  let loaded: any;
  try {
    loaded = dlopen(libraryPath, {
      bun_rs_abi_version: { args: [], returns: "u32" },
      ...symbols,
    } as any);
  } catch (error) {
    throw new Error(`Unable to load bun_rs at ${libraryPath}: ${String(error)}`, { cause: error });
  }
  const actualAbi = loaded.symbols.bun_rs_abi_version();
  if (actualAbi !== EXPECTED_BUN_RS_ABI_VERSION) {
    loaded.close();
    throw new Error(
      `bun_rs ABI mismatch at ${libraryPath}: expected ${EXPECTED_BUN_RS_ABI_VERSION}, found ${actualAbi}`,
    );
  }
  return loaded.symbols;
}

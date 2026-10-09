// SPDX-License-Identifier: Apache-2.0
/**
 * Routes of the FFI explorer: `GET /api/ffi/sources` serves the YOLO runtime C ABI files as they are in the
 * repository, `GET /api/ffi/abi` opens the library resolved by `@aphrody/runtime-sdk` and calls `yolo_abi_version`.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Repository root: apps/web/src/os -> ../../../.. */
export const REPO_ROOT = resolve(import.meta.dir, "../../../..");

export const FFI_SOURCE_PATHS = {
  header: "crates/interop/ffi/include/aphrody.h",
  sdkSymbols: "packages/engine/runtime/src/index.ts",
  rustConsumer: "examples/runtime-rust-extension/src/lib.rs",
} as const;

export interface FfiSources {
  header: string | null;
  rustConsumer: string | null;
  sdkSymbols: string | null;
  /** yolo_* functions declared by aphrody.h and missing from the SDK `SYMBOLS` table, and the reverse. */
  drift: { missingFromSdk: string[]; missingFromHeader: string[] } | null;
}

export type AbiProbe =
  | { available: true; library: string; version: number; major: number; minor: number }
  | { available: false; library: string; error: string };

async function readRepoFile(path: string, root: string): Promise<string | null> {
  const file = Bun.file(resolve(root, path));
  return (await file.exists()) ? file.text() : null;
}

/** Names of the functions declared in a C header (`<type> yolo_x(`). */
export function headerFunctions(header: string): string[] {
  return [...new Set([...header.matchAll(/^\s*[A-Za-z_][\w\s*]*?\b(yolo_\w+)\s*\(/gm)].map(m => m[1]!))].toSorted();
}

/** The `export const SYMBOLS = { ... }` block of the SDK, the part of index.ts that maps the C ABI. */
export function symbolsBlock(source: string): string | null {
  const start = source.indexOf("export const SYMBOLS = {");
  if (start < 0) return null;
  const end = source.indexOf("\n}", start);
  if (end < 0) return null;
  const close = source.indexOf("\n", end + 2);
  return source.slice(start, close < 0 ? undefined : close);
}

export function symbolNames(block: string): string[] {
  return [...new Set([...block.matchAll(/^\s*(yolo_\w+)\s*:/gm)].map(m => m[1]!))].toSorted();
}

export async function ffiSources(root = REPO_ROOT): Promise<FfiSources> {
  const [header, sdk, rustConsumer] = await Promise.all([
    readRepoFile(FFI_SOURCE_PATHS.header, root),
    readRepoFile(FFI_SOURCE_PATHS.sdkSymbols, root),
    readRepoFile(FFI_SOURCE_PATHS.rustConsumer, root),
  ]);
  const sdkSymbols = sdk === null ? null : (symbolsBlock(sdk) ?? sdk);
  let drift: FfiSources["drift"] = null;
  if (header !== null && sdk !== null && symbolsBlock(sdk) !== null) {
    const declared = new Set(headerFunctions(header));
    const mapped = new Set(symbolNames(sdkSymbols!));
    drift = {
      missingFromSdk: [...declared].filter(name => !mapped.has(name)),
      missingFromHeader: [...mapped].filter(name => !declared.has(name)),
    };
  }
  return { header, rustConsumer, sdkSymbols, drift };
}

export async function probeAbi(): Promise<AbiProbe> {
  let library = "";
  try {
    const sdk = await import("@aphrody/runtime-sdk");
    library = sdk.defaultLibraryPath();
    if (!existsSync(library)) {
      return {
        available: false,
        library,
        error: "library not built or installed (cargo build -p aphrody-ffi, or set YOLO_RUNTIME_LIB)",
      };
    }
    const { dlopen } = await import("bun:ffi");
    const lib = dlopen(library, { yolo_abi_version: sdk.SYMBOLS.yolo_abi_version });
    try {
      const version = Number(lib.symbols.yolo_abi_version());
      return { available: true, library, version, major: version >>> 16, minor: version & 0xffff };
    } finally {
      lib.close();
    }
  } catch (error) {
    return { available: false, library, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Answers the /api/ffi/* routes; null for any other path. */
export async function handleFfi(req: Request, url: URL): Promise<Response | null> {
  if (req.method !== "GET") return null;
  if (url.pathname === "/api/ffi/sources") return Response.json(await ffiSources());
  if (url.pathname === "/api/ffi/abi") return Response.json(await probeAbi());
  return null;
}

#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// native.ts: the bun_rs native library behind `@aphrody/bun` (m3Css, icons, Sass, scenes).
//
//   bun scripts/native.ts status [--json]
//   bun scripts/native.ts link [--lib <file>] [--apply] [--json]
//
// `@aphrody/bun` opens its native library when it is imported. The npm build (3.3.x) loads
// `native/bun_rs.<so|dylib|dll>` next to its sources; the aphrody workspace build loads
// `native/libaphrody_ffi.<suffix>`. The library is the `aphrody-ffi` cdylib of the aphrody repository
// (the `bun_rs_*` exports of crates/ui/bun are linked into it); this repository never compiles it.
//
// The library is resolved and verified through the yolo producer SDK loader
// (`@aphrody/runtime-sdk/ffi`, `nativeLibrary`, read from $YOLO_ROOT/packages/runtime): `--lib`, then
// $APHRODY_FFI_LIB / $BUN_RS_LIB, then the executable directory, ~/.local/bin, ~/.local/lib/aphrody and
// the aphrody target directories ($APHRODY_ROOT, default: the enclosing aphrody checkout or ~/aphrody).
// A candidate is accepted only when it dlopens and exports `bun_rs_version`.
// `link` symlinks the verified library into every installed copy of `@aphrody/bun`: a plan unless
// `--apply`. Build it first (integrator, serialized Cargo):
//   scripts/build/rust/cargo-serial.sh build --release --locked -p aphrody-ffi --features gpu
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const REPO = resolve(dirname(import.meta.path), "..");
export const YOLO_ROOT = process.env["YOLO_ROOT"] ?? join(homedir(), "yolo");
/** The producer SDK loader (`@aphrody/runtime-sdk/ffi`) inside the yolo checkout. */
export const RUNTIME_SDK_FFI = join(YOLO_ROOT, "packages/runtime/src/ffi.ts");

export const SUFFIX =
  process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so";
export const BUILD_HINT =
  "Build it in aphrody (integrator): scripts/build/rust/cargo-serial.sh build --release --locked -p aphrody-ffi --features gpu, then `bun scripts/native.ts link --apply`.";

export interface InstalledCopy {
  /** Package directory of one installed `@aphrody/bun`. */
  dir: string;
  version: string;
  /** File this copy dlopens first. */
  nativeFile: string;
  present: boolean;
}

/** The library file an installed `@aphrody/bun` opens, from its loader source. */
export function nativeFileFor(pkgDir: string): string {
  const library = join(pkgDir, "src/library.ts");
  if (existsSync(library) && readFileSync(library, "utf8").includes("aphrody_ffi")) {
    return join(
      pkgDir,
      "native",
      `${process.platform === "win32" ? "" : "lib"}aphrody_ffi.${SUFFIX}`,
    );
  }
  return join(pkgDir, "native", `bun_rs.${SUFFIX}`);
}

/** Every installed `@aphrody/bun` under `root` (isolated store and hoisted layout). */
export function installedCopies(root = REPO): InstalledCopy[] {
  const dirs = new Set<string>();
  const store = join(root, "node_modules/.bun");
  if (existsSync(store)) {
    for (const file of new Bun.Glob(
      "@aphrody+bun@*/node_modules/@aphrody/bun/package.json",
    ).scanSync({ cwd: store, onlyFiles: true })) {
      dirs.add(join(store, dirname(file)));
    }
  }
  const hoisted = join(root, "node_modules/@aphrody/bun");
  if (existsSync(join(hoisted, "package.json"))) dirs.add(hoisted);
  return [...dirs].toSorted().map((dir) => {
    const nativeFile = nativeFileFor(dir);
    return {
      dir,
      version: JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version as string,
      nativeFile,
      present: existsSync(nativeFile),
    };
  });
}

/** The aphrody checkout that builds the library: $APHRODY_ROOT, an enclosing checkout, or ~/aphrody. */
export function aphrodyRoot(start = REPO): string {
  if (process.env["APHRODY_ROOT"]) return resolve(process.env["APHRODY_ROOT"]);
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, "crates/interop/ffi/Cargo.toml"))) return dir;
    if (dirname(dir) === dir) break;
  }
  return join(homedir(), "aphrody");
}

/** Directories searched after the explicit and environment paths. */
export function searchDirs(root = aphrodyRoot(), copies = installedCopies()): string[] {
  const target = process.env["CARGO_TARGET_DIR"]
    ? resolve(root, process.env["CARGO_TARGET_DIR"])
    : join(root, "target");
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  const triple =
    process.platform === "win32"
      ? `${arch}-pc-windows-msvc`
      : process.platform === "darwin"
        ? `${arch}-apple-darwin`
        : `${arch}-unknown-linux-gnu`;
  return [
    join(homedir(), ".local/lib/aphrody"),
    join(target, "release"),
    join(target, triple, "release"),
    join(target, "debug"),
    join(target, triple, "debug"),
    ...copies.map((copy) => dirname(copy.nativeFile)),
  ];
}

/** The part of `@aphrody/runtime-sdk/ffi` this tool uses (see yolo packages/runtime/src/ffi.ts). */
interface RuntimeSdkFfi {
  nativeLibrary(options: {
    name: string;
    fileNames?: readonly string[];
    symbols: Record<string, { args: string[]; returns: string }>;
    path?: string;
    envPaths?: readonly string[];
    searchDirs?: readonly string[];
    buildHint?: string;
  }): { isAvailable(): boolean; loadError(): string | null; libraryPath(): string | null };
}

export interface Resolution {
  path: string | null;
  error: string | null;
  loader: string;
}

/**
 * Resolve and verify the library through `@aphrody/runtime-sdk/ffi`: the first candidate that
 * dlopens and exports `bun_rs_version`. `fileNames` covers both artifact names.
 */
export async function resolveLibrary(
  options: { lib?: string; dirs?: string[]; sdk?: string } = {},
): Promise<Resolution> {
  const sdk = options.sdk ?? RUNTIME_SDK_FFI;
  if (!existsSync(sdk)) {
    return {
      path: null,
      error: `@aphrody/runtime-sdk/ffi not found at ${sdk}; set YOLO_ROOT to the yolo checkout`,
      loader: sdk,
    };
  }
  const { nativeLibrary } = (await import(sdk)) as RuntimeSdkFfi;
  const prefix = process.platform === "win32" ? "" : "lib";
  const library = nativeLibrary({
    name: "aphrody_ffi",
    fileNames: [`${prefix}aphrody_ffi.${SUFFIX}`, `bun_rs.${SUFFIX}`, `libbun_rs.${SUFFIX}`],
    symbols: { bun_rs_version: { args: [], returns: "cstring" } },
    ...(options.lib ? { path: resolve(options.lib) } : {}),
    envPaths: ["APHRODY_FFI_LIB", "BUN_RS_LIB"],
    searchDirs: options.dirs ?? searchDirs(),
    buildHint: BUILD_HINT,
  });
  if (options.lib && !existsSync(resolve(options.lib))) {
    return { path: null, error: `--lib ${options.lib} does not exist`, loader: sdk };
  }
  return library.isAvailable()
    ? { path: library.libraryPath(), error: null, loader: sdk }
    : { path: null, error: library.loadError(), loader: sdk };
}

export interface LinkStep {
  from: string;
  to: string;
  action: "create" | "replace" | "keep";
}

/** Symlinks that make every installed copy open `lib`. */
export function linkPlan(lib: string, copies: InstalledCopy[]): LinkStep[] {
  return copies.map((copy) => {
    let action: LinkStep["action"] = "create";
    try {
      const stat = lstatSync(copy.nativeFile);
      action =
        stat.isSymbolicLink() &&
        resolve(dirname(copy.nativeFile), readlinkSync(copy.nativeFile)) === resolve(lib)
          ? "keep"
          : "replace";
    } catch {
      action = "create";
    }
    return { from: resolve(lib), to: copy.nativeFile, action };
  });
}

export function applyLink(steps: LinkStep[]): void {
  for (const step of steps) {
    if (step.action === "keep") continue;
    mkdirSync(dirname(step.to), { recursive: true });
    if (step.action === "replace") unlinkSync(step.to);
    symlinkSync(step.from, step.to);
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

if (import.meta.main) {
  const [command = "status", ...args] = process.argv.slice(2);
  const json = args.includes("--json");
  const copies = installedCopies();
  if (command === "status") {
    const resolution = await resolveLibrary({ lib: flag(args, "lib") });
    const verifiedCopies = await Promise.all(
      copies.map(async (copy) => ({
        ...copy,
        library: await resolveLibrary({ lib: copy.nativeFile, dirs: [] }),
      })),
    );
    const report = {
      copies: verifiedCopies,
      library: resolution,
      buildHint: resolution.path ? undefined : BUILD_HINT,
    };
    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      for (const c of verifiedCopies)
        console.log(
          `@aphrody/bun@${c.version}  ${c.library.path ? "native verified" : `native unavailable: ${c.library.error}`}  ${c.nativeFile}`,
        );
      console.log(
        resolution.path
          ? `library: ${resolution.path} (verified through ${resolution.loader})`
          : `library: not found: ${resolution.error}`,
      );
    }
    process.exit(
      resolution.path &&
        verifiedCopies.length > 0 &&
        verifiedCopies.every((c) => c.present && c.library.path)
        ? 0
        : 1,
    );
  } else if (command === "link") {
    const resolution = await resolveLibrary({ lib: flag(args, "lib") });
    if (!resolution.path) {
      console.error(`native.ts: ${resolution.error}`);
      process.exit(1);
    }
    const steps = linkPlan(resolution.path, copies);
    const apply = args.includes("--apply");
    if (apply) applyLink(steps);
    if (json)
      console.log(JSON.stringify({ applied: apply, library: resolution.path, steps }, null, 2));
    else {
      for (const s of steps)
        console.log(`${apply ? "" : "plan: "}${s.action} ${s.to} -> ${s.from}`);
      if (!apply) console.log("dry run: pass --apply to link");
    }
  } else {
    console.error("usage: bun scripts/native.ts status|link [--lib <file>] [--apply] [--json]");
    process.exit(2);
  }
}

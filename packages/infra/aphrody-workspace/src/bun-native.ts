// SPDX-License-Identifier: Apache-2.0
/**
 * Build the `bun_rs` native library of `@aphrody/bun` and install it into this Bun workspace.
 *
 * `@aphrody/bun` and its `aphrody-bun` crate live in this repository. Bun workspaces link the
 * package source, whose loader first looks for `native/{lib,}bun_rs.<dll|so|dylib>`. This script
 * builds the crate and installs the library beside that source. The FFI-backed tests of `@aphrody/m3`,
 * `@aphrody/m3-icons`, `@aphrody/m3-theme`, `@aphrody/m3-design` and `@aphrody/material-web` then
 * run against the real Rust code.
 *
 * The build writes to `target/aphrody-bun`. By default it runs with `--locked` so it never
 * rewrites this repository's Cargo.lock.
 *
 * The library is optimized by default (release profile with thin LTO and 16 codegen units, set
 * through `--config` so the build does not depend on the sibling's custom profiles): the Sass
 * compiler behind `@aphrody/material-web`'s build runs through it, and an unoptimized build is an
 * order of magnitude slower than the tests allow.
 *
 * Usage: bun scripts/bun-native.ts [--unlocked] [--gpu] [--debug]
 *   --unlocked  let Cargo refresh this repository's Cargo.lock (CI, on a fresh checkout)
 *   --gpu       build the wgpu renderer (`--features gpu`); the tests only need the CPU path
 *   --debug     dev profile (faster to build, much slower at run time)
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export async function runBunNative(argv: string[]): Promise<number> {
  const args = new Set(argv);
  let repo = process.cwd();
  for (const arg of args) {
    if (arg.startsWith("--root=")) {
      repo = arg.slice("--root=".length);
      args.delete(arg);
      break;
    }
  }
  if (args.has("--root")) throw new Error("use --root=<aphrody-ui> for bun-native");
  repo = resolve(repo);
  for (const arg of args) {
    if (!["--unlocked", "--gpu", "--debug"].includes(arg)) {
      console.error(`bun-native: unknown argument ${arg}`);
      console.error("usage: bun scripts/bun-native.ts [--unlocked] [--gpu] [--debug]");
      return 2;
    }
  }

  const manifest = join(repo, "Cargo.toml");
  if (!existsSync(join(repo, "crates", "aphrody-bun", "Cargo.toml"))) {
    console.error(`bun-native: crate missing: ${join(repo, "crates", "aphrody-bun")}`);
    return 1;
  }

  const libName =
    process.platform === "win32"
      ? "bun_rs.dll"
      : process.platform === "darwin"
        ? "libbun_rs.dylib"
        : "libbun_rs.so";
  const release = !args.has("--debug");
  const targetDir = join(repo, "target", "aphrody-bun");
  const command = [
    "cargo",
    "build",
    "--manifest-path",
    manifest,
    "-p",
    "aphrody-bun",
    "--lib",
    "--target-dir",
    targetDir,
    ...(release
      ? [
          "--release",
          "--config",
          'profile.release.lto="thin"',
          "--config",
          "profile.release.codegen-units=16",
        ]
      : []),
    ...(args.has("--gpu") ? ["--features", "gpu"] : []),
    ...(args.has("--unlocked") ? [] : ["--locked"]),
  ];

  console.log(`[bun-native] ${command.join(" ")}`);
  const build = Bun.spawnSync(command, {
    cwd: repo,
    env: { ...Bun.env, RUSTC_WRAPPER: "" },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (build.exitCode !== 0) {
    console.error(`[bun-native] cargo build failed (exit ${build.exitCode})`);
    if (!args.has("--unlocked")) {
      console.error(
        "[bun-native] if Cargo.lock is outdated, update this repository's lock file first.",
      );
    }
    return build.exitCode ?? 1;
  }

  const library = join(targetDir, release ? "release" : "debug", libName);
  if (!existsSync(library) || !statSync(library).isFile()) {
    console.error(`[bun-native] built library not found: ${library}`);
    return 1;
  }

  const nativeDir = join(repo, "packages", "bun", "native");
  mkdirSync(nativeDir, { recursive: true });
  const destination = join(nativeDir, basename(library));
  copyFileSync(library, destination);
  console.log(`[bun-native] installed ${destination}`);
  return 0;
}

if (import.meta.main) process.exit(await runBunNative(process.argv.slice(2)));

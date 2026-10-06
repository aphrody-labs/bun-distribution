#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Build a wasm-bindgen crate into an npm package directory: cargo (wasm32-unknown-unknown, release),
 * wasm-bindgen --target web, optional wasm-opt -Oz. One owner for every wasm package (rag-core, shell-web).
 *
 *   bun scripts/build/rust/wasm-package.ts --crate <package> --out <dir> [--name <out-name>] [--skip-cargo] [--no-opt]
 *
 * Cloud sessions (CLAUDE_CODE_REMOTE or APHRODY_CLOUD) build locally through cargo-serial.sh; every other host
 * builds on the VPS tunnel (scripts/build/rust/vps-cargo.ts run, then fetch).
 */
import { $ } from "bun";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const triple = "wasm32-unknown-unknown";
const argv = Bun.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};

const crate = flag("--crate");
const outArg = flag("--out");
if (!crate || !outArg)
  throw new Error("usage: wasm-package.ts --crate <package> --out <dir> [--name <n>]");
const out = resolve(root, outArg);
const name = flag("--name") ?? crate.replaceAll("-", "_");
const artifact = `${crate.replaceAll("-", "_")}.wasm`;
const cloud = process.env.CLAUDE_CODE_REMOTE === "true" || process.env.APHRODY_CLOUD === "1";
const stage = join(root, "target/wasm-package-stage", crate);

// The wasm-bindgen CLI and the library must be the same version: use the PATH binary when it matches Cargo.lock,
// else a pinned prebuilt copy in the Aphrody tool cache (installed once with cargo-binstall, no compilation).
const lock = await Bun.file(join(root, "Cargo.lock")).text();
const pinned = /name = "wasm-bindgen"\nversion = "([^"]+)"/.exec(lock)?.[1];
if (!pinned) throw new Error("wasm-bindgen is missing from Cargo.lock");
const versionOf = async (bin: string): Promise<string | null> => {
  const run = await $`${bin} --version`.nothrow().quiet();
  return run.exitCode === 0 ? run.text().trim() : null;
};
let bindgen = "wasm-bindgen";
if ((await versionOf(bindgen)) !== `wasm-bindgen ${pinned}`) {
  const tool = join(homedir(), ".cache/aphrody/tools", `wasm-bindgen-${pinned}`);
  bindgen = join(tool, "wasm-bindgen");
  if ((await versionOf(bindgen)) !== `wasm-bindgen ${pinned}`) {
    await $`cargo binstall --no-confirm --locked --version ${pinned} --install-path ${tool} wasm-bindgen-cli`;
  }
  if ((await versionOf(bindgen)) !== `wasm-bindgen ${pinned}`) {
    throw new Error(`wasm-bindgen ${pinned} (Cargo.lock) is not available`);
  }
}

let wasmFile: string;
if (cloud) {
  if (!argv.includes("--skip-cargo")) {
    await $`${join(root, "scripts/build/rust/cargo-serial.sh")} build -p ${crate} --target ${triple} --release`.cwd(
      root,
    );
  }
  wasmFile = join(
    process.env.CARGO_TARGET_DIR ?? join(root, "target"),
    triple,
    "release",
    artifact,
  );
} else {
  const vps = join(root, "scripts/build/rust/vps-cargo.ts");
  if (!argv.includes("--skip-cargo")) {
    await $`bun ${vps} run -- build -p ${crate} --target ${triple} --release`.cwd(root);
  }
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  // `fetch` copies <targetDir>/<profile>/<bin> and checks the sha256 on both ends; a .wasm file never
  // "runs here", so the helper exits 3 after a verified copy.
  const fetched =
    await $`bun ${vps} fetch --profile ${`${triple}/release`} --bin ${artifact} --dest ${stage}`
      .cwd(root)
      .nothrow();
  if (fetched.exitCode !== 0 && fetched.exitCode !== 3)
    throw new Error("fetching the wasm artifact failed");
  wasmFile = join(stage, artifact);
}

await rm(out, { recursive: true, force: true });
await $`${bindgen} --target web --out-dir ${out} --out-name ${name} ${wasmFile}`;
const wasm = join(out, `${name}_bg.wasm`);
const raw = Bun.file(wasm).size;
let note = "wasm-opt skipped";
if (!argv.includes("--no-opt")) {
  // Explicit features, never --all-features: that enables stringref/GC and Binaryen then emits string imports
  // that JavaScriptCore (Bun, Safari) and older engines cannot parse.
  const features = [
    "--enable-bulk-memory",
    "--enable-bulk-memory-opt",
    "--enable-nontrapping-float-to-int",
    "--enable-sign-ext",
    "--enable-mutable-globals",
    "--enable-multivalue",
    "--enable-reference-types",
  ];
  const opt = await $`wasm-opt -Oz ${features} ${wasm} -o ${wasm}`.nothrow().quiet();
  note = opt.exitCode === 0 ? "after wasm-opt -Oz" : "wasm-opt failed, unoptimised";
}
console.log(`${wasm}: ${raw} bytes from wasm-bindgen, ${Bun.file(wasm).size} bytes ${note}`);

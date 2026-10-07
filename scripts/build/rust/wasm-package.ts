#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Build a wasm-bindgen crate into a web package with locked Cargo/bindgen and wasm-opt -Oz.
 * Cloud sessions use cargo-serial.sh; other hosts use the checksum-verifying VPS factory.
 * Output is replaced only after the staged package passes validation. --no-opt explicitly skips optimization.
 *
 * bun scripts/build/rust/wasm-package.ts --crate <package> --out <dir> [--name <name>] [--skip-cargo] [--no-opt]
 */
import { $ } from "bun";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../..");
const triple = "wasm32-unknown-unknown";
// Never --all-features: stringref/GC imports break JavaScriptCore (Bun/Safari) and older engines.
const optimizerFeatures = [
  "--enable-bulk-memory",
  "--enable-bulk-memory-opt",
  "--enable-nontrapping-float-to-int",
  "--enable-sign-ext",
  "--enable-mutable-globals",
  "--enable-multivalue",
  "--enable-reference-types",
];

export type ToolResult = { exitCode: number; stdout: string; stderr?: string };
export type ToolRunner = (command: string[], cwd: string) => Promise<ToolResult>;
export type BuildOptions = {
  crate: string;
  out: string;
  name?: string;
  skipCargo?: boolean;
  noOpt?: boolean;
};
export type BuildDependencies = {
  root?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  run?: ToolRunner;
};

const runTool: ToolRunner = async (command, cwd) => {
  const result = await $`${command}`.cwd(cwd).nothrow().quiet();
  return { exitCode: result.exitCode, stdout: result.text(), stderr: result.stderr.toString() };
};

export async function buildWasmPackage(
  options: BuildOptions,
  dependencies: BuildDependencies = {},
) {
  const root = dependencies.root ?? repositoryRoot;
  const env = dependencies.env ?? process.env;
  const run = dependencies.run ?? runTool;
  const crate = options.crate;
  const name = options.name ?? crate.replaceAll("-", "_");
  if (!/^[a-zA-Z0-9_-]+$/.test(crate) || !/^[a-zA-Z0-9_-]+$/.test(name))
    throw new Error(
      "crate and output name must contain only letters, digits, underscores or hyphens",
    );
  const out = resolve(root, options.out);
  if (out === root || out === dirname(out) || root.startsWith(`${out}${sep}`))
    throw new Error("output must be a package directory, not the repository or its parent");
  const checked = async (command: string[]) => {
    const result = await run(command, root);
    if (result.exitCode !== 0)
      throw new Error(
        `${command[0]} failed (${result.exitCode}): ${result.stderr || result.stdout}`,
      );
    return result;
  };
  const lock = await Bun.file(join(root, "Cargo.lock")).text();
  const pinned = /name = "wasm-bindgen"\r?\nversion = "([^"]+)"/.exec(lock)?.[1];
  if (!pinned) throw new Error("wasm-bindgen is missing from Cargo.lock");
  const matchesPin = async (bin: string) => {
    const result = await run([bin, "--version"], root);
    return result.exitCode === 0 && result.stdout.trim() === `wasm-bindgen ${pinned}`;
  };
  let bindgen = "wasm-bindgen";
  if (!(await matchesPin(bindgen))) {
    const tool = join(
      dependencies.home ?? homedir(),
      ".cache/aphrody/tools",
      `wasm-bindgen-${pinned}`,
    );
    bindgen = join(tool, "wasm-bindgen");
    if (!(await matchesPin(bindgen))) {
      await checked([
        "cargo",
        "binstall",
        "--no-confirm",
        "--locked",
        "--version",
        pinned,
        "--install-path",
        tool,
        "wasm-bindgen-cli",
      ]);
    }
    if (!(await matchesPin(bindgen)))
      throw new Error(`wasm-bindgen ${pinned} (Cargo.lock) is not available`);
  }

  // Staging on the output filesystem makes publication use rename instead of copying partial files.
  await mkdir(dirname(out), { recursive: true });
  const stage = await mkdtemp(join(dirname(out), `.${basename(out)}-stage-`));
  const packageDir = join(stage, "package");
  const previous = join(stage, "previous");
  let preserveStage = false;
  try {
    const artifact = `${crate.replaceAll("-", "_")}.wasm`;
    let wasmFile: string;
    const cargoArgs = ["build", "--locked", "-p", crate, "--target", triple, "--release"];
    if (env.CLAUDE_CODE_REMOTE === "true" || env.APHRODY_CLOUD === "1") {
      if (!options.skipCargo)
        await checked([join(root, "scripts/build/rust/cargo-serial.sh"), ...cargoArgs]);
      wasmFile = join(resolve(root, env.CARGO_TARGET_DIR ?? "target"), triple, "release", artifact);
    } else {
      const vps = join(root, "scripts/build/rust/vps-cargo.ts");
      if (!options.skipCargo) await checked(["bun", vps, "run", "--", ...cargoArgs]);
      // Exit 3 means a checksum-verified file was fetched but cannot run on the local host (WASM).
      const fetched = await run(
        ["bun", vps, "fetch", "--profile", `${triple}/release`, "--bin", artifact, "--dest", stage],
        root,
      );
      if (fetched.exitCode !== 0 && fetched.exitCode !== 3)
        throw new Error(`fetching the wasm artifact failed (${fetched.exitCode})`);
      wasmFile = join(stage, artifact);
    }
    await checked([
      bindgen,
      "--target",
      "web",
      "--out-dir",
      packageDir,
      "--out-name",
      name,
      wasmFile,
    ]);
    const wasm = join(packageDir, `${name}_bg.wasm`);
    const raw = Bun.file(wasm).size;
    if (!options.noOpt) {
      const optimized = join(stage, "optimized.wasm");
      // An optimizer failure aborts the release; it never replaces the last usable package.
      await checked(["wasm-opt", "-Oz", ...optimizerFeatures, wasm, "-o", optimized]);
      const optimizedBytes = await Bun.file(optimized).arrayBuffer();
      if (!WebAssembly.validate(optimizedBytes))
        throw new Error("wasm-opt produced an invalid module");
      // Keep the original if -Oz makes this particular module larger.
      if (optimizedBytes.byteLength <= raw) await rename(optimized, wasm);
    }
    if (!WebAssembly.validate(await Bun.file(wasm).arrayBuffer()))
      throw new Error("wasm-bindgen produced an invalid module");
    await Promise.all(
      [`${name}.js`, `${name}.d.ts`, `${name}_bg.wasm.d.ts`].map(async (file) => {
        if (!(await Bun.file(join(packageDir, file)).exists()))
          throw new Error(`wasm-bindgen package is missing ${file}`);
      }),
    );
    const bytes = Bun.file(wasm).size;
    let backedUp = false;
    try {
      await rename(out, previous);
      backedUp = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      await rename(packageDir, out);
    } catch (error) {
      if (backedUp) {
        try {
          await rename(previous, out);
        } catch (restoreError) {
          // Retain the previous package even if a filesystem failure prevents rollback.
          preserveStage = true;
          throw new Error(
            `publication and rollback failed (${String(error)}); previous package retained at ${previous}`,
            {
              cause: restoreError,
            },
          );
        }
      }
      throw error;
    }
    return {
      wasm: join(out, `${name}_bg.wasm`),
      rawBytes: raw,
      bytes,
      optimization: options.noOpt
        ? "skipped (--no-opt)"
        : bytes < raw
          ? "optimized (-Oz)"
          : "validated (-Oz; original size retained)",
    };
  } finally {
    if (!preserveStage) await rm(stage, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const at = argv.indexOf(name);
    const value = at >= 0 ? argv[at + 1] : undefined;
    return value?.startsWith("--") ? undefined : value;
  };
  const crate = flag("--crate");
  const out = flag("--out");
  if (!crate || !out)
    throw new Error(
      "usage: wasm-package.ts --crate <package> --out <dir> [--name <n>] [--skip-cargo] [--no-opt]",
    );
  const result = await buildWasmPackage({
    crate,
    out,
    name: flag("--name"),
    skipCargo: argv.includes("--skip-cargo"),
    noOpt: argv.includes("--no-opt"),
  });
  console.log(
    `${result.wasm}: ${result.rawBytes} bytes from wasm-bindgen, ${result.bytes} bytes ${result.optimization}`,
  );
}

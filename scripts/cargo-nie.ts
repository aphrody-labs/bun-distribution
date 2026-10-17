#!/usr/bin/env bun
// Release build of every aphrody-nie-* crate through the serialized native Cargo owner:
// host targets with their default features plus the feature-gated binaries, the browser crates
// for wasm32-unknown-unknown (wasm-bindgen web packages), the emscripten Lua bridge when emcc and
// its Rust target are present, then optional installation of the produced executables.
//
// bun scripts/cargo-nie.ts [--install <dir>] [--web-out <dir>] [-- <extra cargo arguments>]
import { loadConfig, runNative, runNativeResult } from "@aphrody/bun-workspace";
import { chmod, copyFile, mkdir, rename } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const argv = Bun.argv.slice(2);
const separator = argv.indexOf("--");
const extra = separator < 0 ? [] : argv.slice(separator + 1);
const options = separator < 0 ? argv : argv.slice(0, separator);
const option = (name: string) => {
  const index = options.indexOf(name);
  return index < 0 ? undefined : options[index + 1];
};
const installDir = option("--install");
const webOut = resolve(root, option("--web-out") ?? "target/nie-web");
const config = await loadConfig();
const deadline = { timeoutMs: 43_000_000, runtimePolicy: "development" as const };

type Target = { name: string; kind: string[] };
type Package = { name: string; targets: Target[] };
const metadata = await runNativeResult(
  config,
  ["cargo", "metadata", "--no-deps", "--format-version", "1", "--locked"],
  { ...deadline, serialize: false },
  true,
);
if (metadata.code) throw new Error("cargo metadata failed:\n" + metadata.stderr);
const packages = (JSON.parse(metadata.stdout).packages as Package[])
  .filter(pkg => pkg.name.startsWith("aphrody-nie-"))
  .sort((a, b) => a.name.localeCompare(b.name));

const browser = ["aphrody-nie-wasm"];
const emscripten = "aphrody-nie-lua-web";
const featureBuilds: Record<string, string> = {
  "aphrody-nie-bevy": "bevy",
  "aphrody-nie-data": "serde,std",
};
const failures: string[] = [];
const cargo = async (
  label: string,
  args: string[],
  extraOptions: { cwd?: string; env?: Record<string, string> } = {},
) => {
  console.log(`\n== ${label}: cargo ${args.join(" ")}`);
  if (await runNative(config, ["cargo", ...args, ...extra], { ...deadline, ...extraOptions })) failures.push(label);
};

const host = packages.map(pkg => pkg.name).filter(name => !browser.includes(name) && name !== emscripten);
await cargo("host", ["build", "--release", "--locked", "--keep-going", ...host.flatMap(name => ["-p", name])]);
for (const [name, features] of Object.entries(featureBuilds)) {
  await cargo(`${name}+${features}`, ["build", "--release", "--locked", "-p", name, "--features", features]);
}

const installedTargets = await Bun.$`rustup target list --installed`.cwd(root).nothrow().quiet().text();
if (installedTargets.includes("wasm32-unknown-unknown")) {
  await cargo("wasm32-unknown-unknown", [
    "build",
    "--release",
    "--locked",
    "--target",
    "wasm32-unknown-unknown",
    ...browser.flatMap(name => ["-p", name]),
  ]);
  const bindgen = Bun.which("wasm-bindgen");
  for (const name of browser) {
    const artifact = join(root, "target", "wasm32-unknown-unknown", "release", `${name.replaceAll("-", "_")}.wasm`);
    if (!bindgen) {
      console.log(`skip ${name} web package: wasm-bindgen missing`);
    } else if (await Bun.file(artifact).exists()) {
      const out = join(webOut, name);
      const result = await Bun.$`${bindgen} --target web --out-dir ${out} ${artifact}`.nothrow();
      if (result.exitCode) failures.push(`${name} wasm-bindgen`);
    }
  }
} else {
  console.log("skip browser crates: rustup target wasm32-unknown-unknown missing");
}

if (installedTargets.includes("wasm32-unknown-emscripten") && Bun.which("emcc")) {
  // The crate-local .cargo/config.toml carries the standalone-module link flags.
  await cargo(
    emscripten,
    ["build", "--release", "--locked", "--target", "wasm32-unknown-emscripten", "-p", emscripten],
    {
      cwd: join(root, "crates", emscripten),
      env: {
        CC_wasm32_unknown_emscripten: "emcc",
        CXX_wasm32_unknown_emscripten: "em++",
        AR_wasm32_unknown_emscripten: "emar",
      },
    },
  );
} else {
  console.log(`skip ${emscripten}: needs emcc and the wasm32-unknown-emscripten Rust target`);
}

if (installDir) {
  const destination = resolve(installDir);
  await mkdir(destination, { recursive: true });
  const executable = process.platform === "win32" ? ".exe" : "";
  for (const pkg of packages) {
    for (const target of pkg.targets.filter(target => target.kind.includes("bin"))) {
      const built = join(root, "target", "release", target.name + executable);
      if (!(await Bun.file(built).exists())) continue;
      // Rename over the old file so a running service keeps its executable (no ETXTBSY).
      const installed = join(destination, target.name + executable);
      await copyFile(built, installed + ".new");
      await chmod(installed + ".new", 0o755);
      await rename(installed + ".new", installed);
      console.log(`installed ${pkg.name}: ${target.name}`);
    }
  }
}

if (failures.length) {
  console.error(`\nFailed: ${failures.join(", ")}`);
  process.exitCode = 1;
}

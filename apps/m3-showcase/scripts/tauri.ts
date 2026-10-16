// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { tauriShell, TAURI_3, writeFiles, type FileMap } from "@aphrody/scaffold";
import {
  heavyBuildStatus,
  readFactoryConfig,
  routeHeavyBuild,
  type BuildFactoryStatus,
} from "../../../../packages/infra/workspace/src/build-factory";
import { APHRODY_ROOT, SHOWCASE_ROOT, TAURI_ROOT } from "./icons";

export const CARGO_RUNNER = resolve(APHRODY_ROOT, "scripts/build/rust/cargo-serial.sh");
const M3_BUN_CLI = resolve(SHOWCASE_ROOT, "../../packages/m3-bun/bin/m3-bun.ts");
const HEAVY_COMMANDS = new Set(["dev", "build", "bundle", "android", "ios", "sidecar"]);

export function showcaseShellFiles(): FileMap {
  const files = tauriShell({
    name: "Aphrody M3 Showcase",
    crate: "aphrody-m3-showcase",
    identifier: "com.aphrody.m3showcase",
    version: "3.3.3",
    mobile: true,
    build: {
      frontendDist: "../../../m3/apps/m3-showcase/dist",
    },
    window: { mode: "runtime" },
    withGlobalTauri: false,
    permissions: [],
    capabilityDescription: "The loopback UI uses HTTP; no host IPC is granted to its origin.",
    csp: "default-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    externalBin: ["binaries/m3-showcase"],
    runtimePlugin: {
      crate: "aphrody-tauri-wrap",
      path: "../tauri-wrap",
      features: [],
      init: 'aphrody_tauri_wrap::init(include_str!("../wrap.json"))',
    },
  });
  delete files["src-tauri/icons/icon.png"];
  const config = JSON.parse(String(files["src-tauri/tauri.conf.json"]));
  config.bundle.icon = [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico",
  ];
  config.build.beforeDevCommand = "bun run icons && bun scripts/tauri.ts sidecar";
  config.build.beforeBuildCommand = "bun run icons && bun scripts/tauri.ts sidecar";
  files["src-tauri/tauri.conf.json"] = JSON.stringify(config, null, 2) + "\n";
  files["src-tauri/Cargo.toml"] = `# SPDX-License-Identifier: Apache-2.0
[package]
name = "aphrody-m3-showcase"
version = "3.3.3"
description = "Native showcase shell for the canonical Aphrody M3 frontend and API"
edition.workspace = true
rust-version.workspace = true
license.workspace = true
authors.workspace = true
homepage.workspace = true
repository.workspace = true
publish = false

[lib]
name = "aphrody_m3_showcase_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[features]
custom-protocol = ["tauri/custom-protocol"]

[build-dependencies]
tauri-build.workspace = true

[dependencies]
tauri.workspace = true
tauri-runtime-wry.workspace = true
aphrody-tauri-wrap.workspace = true

[lints]
workspace = true
`;
  files["src-tauri/wrap.json"] =
    JSON.stringify(
      {
        schema: "aphrody-web-to-tauri/1",
        name: "Aphrody M3 Showcase",
        identifier: "com.aphrody.m3showcase",
        mode: "sidecar",
        engine: "wry",
        start: "/",
        origins: { app: [], auth: [], embeds: [], external: "system" },
        window: {
          title: "Aphrody M3 Showcase",
          width: 1200,
          height: 800,
          minWidth: 320,
          minHeight: 480,
          syncTitle: true,
          zoomHotkeys: true,
          dragDrop: false,
        },
        userAgent: null,
        bundle: null,
        sidecar: {
          program: "m3-showcase",
          args: [],
          port: 0,
          readyPath: "/healthz",
          readyTimeoutSecs: 30,
          env: {},
        },
      },
      null,
      2,
    ) + "\n";
  files["src-tauri/.gitignore"] = "/target/\n/gen/\n/icons/\n/binaries/\n";
  return Object.fromEntries(
    Object.entries(files).map(([path, content]) => [path.slice("src-tauri/".length), content]),
  );
}

export async function prepareShowcaseHost(root = TAURI_ROOT): Promise<void> {
  const files = showcaseShellFiles();
  const missing: FileMap = {};
  for (const [path, content] of Object.entries(files)) {
    if (!existsSync(resolve(root, path))) missing[path] = content;
  }
  if (Object.keys(missing).length) await writeFiles(root, missing, "merge");
}

/** The canonical compiler embeds both UI and API; the Tauri wrapper owns its child lifecycle. */
export function sidecarCommand(triple: string, root = TAURI_ROOT): string[] {
  const targets: Record<string, string> = {
    "x86_64-unknown-linux-gnu": "linux-x64",
    "aarch64-unknown-linux-gnu": "linux-arm64",
    "x86_64-unknown-linux-musl": "linux-x64-musl",
    "aarch64-unknown-linux-musl": "linux-arm64-musl",
    "x86_64-pc-windows-msvc": "windows-x64",
    "x86_64-apple-darwin": "darwin-x64",
    "aarch64-apple-darwin": "darwin-arm64",
  };
  const target = targets[triple];
  if (!target)
    throw new Error(
      `No native M3 Bun API sidecar target for ${triple}; mobile requires its canonical API host adapter`,
    );
  const suffix = target.startsWith("windows") ? ".exe" : "";
  return [
    "bun",
    M3_BUN_CLI,
    "compile",
    "--target",
    target,
    "--outfile",
    resolve(root, `binaries/m3-showcase-${triple}${suffix}`),
  ];
}

/** Tauri's desktop runner is always the existing Cargo lock/guard owner. */
export function serializedTauriCommand(args: string[], cli: string): string[] {
  if (args.some((arg) => arg.startsWith("-r") || arg === "--runner" || arg.startsWith("--runner=")))
    throw new Error("The Tauri Cargo runner is owned by scripts/build/rust/cargo-serial.sh");
  if (args[0] === "android" || args[0] === "ios")
    throw new Error(
      "Mobile production requires the canonical API host adapter and serialized platform builder; no desktop Bun sidecar is available on Android/iOS",
    );
  if (args[0] !== "build" && args[0] !== "dev") return [cli, ...args];
  if (
    args.some(
      (arg) =>
        arg === "--manifest-path" ||
        arg.startsWith("--manifest-path=") ||
        arg === "-p" ||
        arg === "--package" ||
        arg.startsWith("--package="),
    )
  )
    throw new Error("The Tauri manifest and Cargo package are owned by crates/ui/m3-showcase");
  const separator = args.indexOf("--");
  const before = separator < 0 ? args : args.slice(0, separator);
  const forwarded = separator < 0 ? [] : args.slice(separator + 1);
  const application = forwarded.indexOf("--");
  const runnerArgs = application < 0 ? forwarded : forwarded.slice(0, application);
  const appArgs = application < 0 ? [] : forwarded.slice(application);
  return [
    cli,
    ...before,
    "--runner",
    CARGO_RUNNER,
    "--",
    ...runnerArgs,
    "--manifest-path",
    resolve(TAURI_ROOT, "Cargo.toml"),
    "--package",
    "aphrody-m3-showcase",
    ...appArgs,
  ];
}

export function assertFactoryHost(status: BuildFactoryStatus): void {
  if (
    !status.configured ||
    !status.enabled ||
    status.route !== "local" ||
    status.host !== status.target
  )
    throw new Error(
      "Native host compilation must execute through the configured Workspace build factory; use aphrody-ops build-factory run --repo aphrody --revision <full-sha> -- bun m3/apps/m3-showcase/scripts/tauri.ts build. Local Cargo flags do not authorize host builds.",
    );
}

export interface TauriHostPlan {
  platform: string;
  arch: string;
  expectedCli: string;
  command: string[];
  execution: "workspace-build-factory" | "local";
  hostOwner: string;
  apiOwner: string;
  missing: string[];
}

export function tauriHostPlan(
  args: string[],
  env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform,
  which = Bun.which,
): TauriHostPlan {
  const cli = which("tauri");
  const missing: string[] = [];
  if (!cli) missing.push(`Installed Tauri CLI ${TAURI_3.jsCli} is missing`);
  const nativeBuild = HEAVY_COMMANDS.has(args[0] ?? "info");
  if (nativeBuild && !which("cargo")) missing.push("The Rust Cargo toolchain is missing");
  if (nativeBuild && !which("rustc")) missing.push("The Rust compiler is missing");
  if (args[0] === "android") {
    const sdk = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
    if (!sdk || !existsSync(sdk))
      missing.push("Configure an existing Android SDK with ANDROID_HOME or ANDROID_SDK_ROOT");
    if (!which("java")) missing.push("The Android JDK is missing");
    const ndk = env.NDK_HOME ?? env.ANDROID_NDK_HOME;
    if (!(ndk && existsSync(ndk)) && !(sdk && existsSync(resolve(sdk, "ndk"))))
      missing.push("The Android NDK is missing");
  }
  if (args[0] === "ios" && (platform !== "darwin" || !which("xcodebuild")))
    missing.push("iOS requires the configured macOS/Xcode builder");
  let command: string[] = [];
  if (cli && args[0] !== "sidecar") {
    try {
      command = serializedTauriCommand(args, cli);
    } catch (error) {
      missing.push(error instanceof Error ? error.message : String(error));
    }
  }
  return {
    platform,
    arch: process.arch,
    expectedCli: TAURI_3.jsCli,
    command,
    execution: nativeBuild ? "workspace-build-factory" : "local",
    hostOwner: TAURI_ROOT,
    apiOwner: SHOWCASE_ROOT,
    missing,
  };
}

function explicitTarget(args: string[]): string | undefined {
  const separator = args.indexOf("--");
  const options = separator < 0 ? args : args.slice(0, separator);
  const target = options.find((arg) => arg.startsWith("--target="));
  if (target) return target.slice("--target=".length);
  const short = options.find((arg) => arg.startsWith("-t") && arg.length > 2);
  if (short) return short.slice(2);
  const index = options.findIndex((arg) => arg === "--target" || arg === "-t");
  return index >= 0 ? options[index + 1] : undefined;
}

async function runSidecar(root: string): Promise<void> {
  let triple = process.env.APHRODY_M3_TAURI_TARGET;
  if (!triple) {
    const rust = Bun.spawn(["rustc", "-vV"], { stdout: "pipe", stderr: "inherit" });
    const output = await new Response(rust.stdout).text();
    if ((await rust.exited) !== 0) throw new Error("Cannot qualify the installed Rust host triple");
    triple = output.match(/^host: (.+)$/m)?.[1];
  }
  if (!triple) throw new Error("Missing native Tauri target triple");
  const child = Bun.spawn(sidecarCommand(triple, root), {
    cwd: SHOWCASE_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`Native API sidecar compilation failed with exit ${code}`);
  // An unbundled dev/release app also resolves its sidecar beside its executable.
  // Metadata runs through the same native Cargo owner, after factory admission.
  const metadata = Bun.spawn(
    [
      CARGO_RUNNER,
      "metadata",
      "--format-version",
      "1",
      "--no-deps",
      "--manifest-path",
      resolve(root, "Cargo.toml"),
    ],
    { cwd: APHRODY_ROOT, stdout: "pipe", stderr: "inherit" },
  );
  const output = await new Response(metadata.stdout).text();
  if ((await metadata.exited) !== 0)
    throw new Error("Cannot qualify the native Tauri artifact directory");
  const targetDir = (JSON.parse(output) as { target_directory: string }).target_directory;
  const profile = process.env.APHRODY_M3_TAURI_PROFILE ?? "release";
  if (!["debug", "release"].includes(profile))
    throw new Error("Unsupported native Tauri artifact profile");
  const suffix = triple.includes("windows") ? ".exe" : "";
  const beside = resolve(
    targetDir,
    ...(process.env.APHRODY_M3_TAURI_TARGET ? [triple] : []),
    profile,
    `m3-showcase${suffix}`,
  );
  await mkdir(dirname(beside), { recursive: true });
  await copyFile(sidecarCommand(triple, root).at(-1)!, beside);
}

export async function runTauri(input: string[] = [], root = TAURI_ROOT): Promise<void> {
  const planOnly = input.includes("--plan");
  const args = input.filter((arg) => arg !== "--plan");
  if (args.length === 0) args.push("info");
  if (args[0] === "prepare") {
    if (planOnly)
      console.log(JSON.stringify({ files: Object.keys(showcaseShellFiles()) }, null, 2));
    else await prepareShowcaseHost(root);
    return;
  }
  if (
    !HEAVY_COMMANDS.has(args[0]!) &&
    args[0] !== "info" &&
    !(args.length === 1 && ["--help", "-h", "--version", "-V"].includes(args[0]!))
  )
    throw new Error(
      "Use an explicit owner command: prepare, info, dev, build, bundle, sidecar, android, or ios; global options cannot bypass the build-factory gate",
    );
  const plan = tauriHostPlan(args);
  if (planOnly) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  // Unsupported host APIs and toolchains are diagnosed before dispatch or source writes.
  if (plan.missing.length) throw new Error(plan.missing.join("\n"));
  if (HEAVY_COMMANDS.has(args[0]!)) {
    const dispatched = await routeHeavyBuild(
      ["bun", "m3/apps/m3-showcase/scripts/tauri.ts", ...args],
      APHRODY_ROOT,
    );
    if (dispatched !== undefined) {
      if (dispatched !== 0) throw new Error(`Native build factory failed with exit ${dispatched}`);
      return;
    }
    const factory = await readFactoryConfig(APHRODY_ROOT);
    assertFactoryHost(heavyBuildStatus(factory, process.env, false));
  }
  if (args[0] === "sidecar") {
    await runSidecar(root);
    return;
  }
  const version = Bun.spawn([plan.command[0]!, "--version"], { stdout: "pipe", stderr: "pipe" });
  const installed = (await new Response(version.stdout).text()).trim();
  if ((await version.exited) !== 0 || !installed.endsWith(plan.expectedCli))
    throw new Error(`Tauri CLI pin mismatch: expected ${plan.expectedCli}; observed ${installed}`);
  await prepareShowcaseHost(root);
  const target = explicitTarget(args);
  const child = Bun.spawn(plan.command, {
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      CARGO: CARGO_RUNNER,
      TAURI_APP_PATH: root,
      TAURI_FRONTEND_PATH: SHOWCASE_ROOT,
      ...(target ? { APHRODY_M3_TAURI_TARGET: target } : {}),
      APHRODY_M3_TAURI_PROFILE:
        args[0] === "dev" || args.includes("--debug") || args.includes("-d") ? "debug" : "release",
    },
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`Tauri host command failed with exit ${code}`);
}

if (import.meta.main) {
  try {
    await runTauri(Bun.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

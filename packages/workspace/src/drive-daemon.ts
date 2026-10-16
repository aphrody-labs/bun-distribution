// SPDX-License-Identifier: Apache-2.0
// Build the nested FSL Drive workspace and stage its daemon for Aphrody Tauri.
import { copyFile, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cargoSerialCommand, cargoSerialPath } from "./cargo-serial.ts";

function parseArgs(args: string[]): { repo: string; debug: boolean } {
  let repo = process.cwd();
  let debug = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--root") repo = args[++index] ?? "";
    else if (arg === "--debug") debug = true;
    else if (arg === "--release") debug = false;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: yolo ops drive-daemon [--root <aphrody>] [--debug]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!repo) throw new Error("--root requires an Aphrody monorepo path");
  return { repo: resolve(repo), debug };
}

export async function runDriveDaemon(args: string[]): Promise<number> {
  const { repo, debug } = parseArgs(args);
  if (!(await Bun.file(join(repo, "Cargo.toml")).exists())) {
    throw new Error(`Aphrody monorepo missing: ${repo}`);
  }
  const driveWorkspace = join(repo, "crates", "os", "kernel", "comps", "drive");
  const driveManifest = join(driveWorkspace, "Cargo.toml");
  if (!(await Bun.file(driveManifest).exists())) {
    throw new Error(`Drive workspace missing: ${driveManifest}`);
  }
  const cargoSerial = cargoSerialPath(repo);
  if (!(await Bun.file(cargoSerial).exists())) {
    throw new Error(`serialized Cargo wrapper missing: ${cargoSerial}`);
  }
  const profile = debug ? "debug" : "release";
  const rustc = Bun.spawnSync(["rustc", "-vV"], {
    windowsHide: true,
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (rustc.exitCode !== 0)
    throw new Error(new TextDecoder().decode(rustc.stderr));
  const host = /^host: (.+)$/m.exec(
    new TextDecoder().decode(rustc.stdout),
  )?.[1];
  if (!host) throw new Error("rustc did not report its host target");
  if (!host.includes("windows") && !host.includes("linux")) {
    throw new Error(`Aphrody Drive bundles only Windows and Linux: ${host}`);
  }

  const suffix = host.includes("windows") ? ".exe" : "";
  const driveTarget = join(driveWorkspace, "target");
  const windowsX64 = host === "x86_64-pc-windows-msvc";
  if (windowsX64 && !Bun.which("clang-cl")) {
    throw new Error("clang-cl is required for the Windows Drive daemon build");
  }
  const command = [
    ...cargoSerialCommand(repo),
    ...(windowsX64
      ? ["--config", 'env.CFLAGS_x86_64_pc_windows_msvc.value="-W0 /arch:AVX2"']
      : []),
    "build",
    "--manifest-path",
    driveManifest,
    "-p",
    "sd-core",
    "--bin",
    "sd-daemon",
    "--locked",
    ...(profile === "release" ? ["--release"] : []),
  ];
  const build = Bun.spawnSync(command, {
    windowsHide: true,
    cwd: repo,
    env: {
      ...Bun.env,
      CARGO_TARGET_DIR: driveTarget,
      ...(windowsX64 ? { CC: "clang-cl.exe", CXX: "clang-cl.exe" } : {}),
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (build.exitCode !== 0)
    throw new Error(`Drive daemon build failed (${build.exitCode})`);

  const source = join(driveTarget, profile, `sd-daemon${suffix}`);
  if (!(await stat(source)).isFile())
    throw new Error(`Drive daemon binary missing: ${source}`);
  const binaries = join(repo, "crates", "ui", "app", "binaries");
  await mkdir(binaries, { recursive: true });
  const staged = join(binaries, `sd-daemon-${host}${suffix}`);
  await copyFile(source, staged);

  // cargo run starts an unbundled desktop from the root target directory.
  const appTarget = resolve(repo, Bun.env.CARGO_TARGET_DIR ?? "target");
  await mkdir(join(appTarget, profile), { recursive: true });
  const besideApp = join(appTarget, profile, `sd-daemon${suffix}`);
  if (resolve(source) !== resolve(besideApp)) await copyFile(source, besideApp);
  console.log(`Staged Drive daemon: ${staged}`);

  return 0;
}

if (import.meta.main) process.exit(await runDriveDaemon(process.argv.slice(2)));

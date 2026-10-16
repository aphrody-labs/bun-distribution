// SPDX-License-Identifier: Apache-2.0
/**
 * Native delivery of the showcase. There is no separate Tauri shell: the desktop is `aphrody-app`
 * (`crates/ui/app`), which opens the showcase window with `aphrody-app --showcase` (or its
 * "M3 Showcase" help menu entry). That window loads the compiled Bun sidecar `m3-showcase` of this
 * application on a loopback port: one origin for the UI and the API. This script compiles the
 * sidecar and stages it beside the desktop executable, where the desktop looks for it first.
 */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  heavyBuildStatus,
  readFactoryConfig,
  routeHeavyBuild,
  type BuildFactoryStatus,
} from "../../../../../packages/bun-workspace/src/automation/build-factory";

export const SHOWCASE_ROOT = resolve(import.meta.dir, "..");
export const APHRODY_ROOT = resolve(SHOWCASE_ROOT, "../../../..");
/** The only desktop application; it hosts the showcase window. */
export const DESKTOP_ROOT = resolve(APHRODY_ROOT, "crates/ui/app");
export const CARGO_RUNNER = resolve(
  APHRODY_ROOT,
  "scripts/build/rust/cargo-serial.sh",
);
/** Staging directory of the compiled sidecars, inside the ignored Cargo target directory. */
export const SIDECAR_STAGING = resolve(APHRODY_ROOT, "target/m3-showcase");
/** `yolo m3 bun`: the m3-bun CLI hosted by the repository's one Bun CLI. */
const YOLO_CLI = resolve(APHRODY_ROOT, "packages/engine/yolo/src/index.ts");

/** The canonical compiler embeds both UI and API in one executable. */
export function sidecarCommand(
  triple: string,
  root = SIDECAR_STAGING,
): string[] {
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
    YOLO_CLI,
    "m3",
    "bun",
    "compile",
    "--target",
    target,
    "--outfile",
    resolve(root, `m3-showcase-${triple}${suffix}`),
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
      "Native host compilation must execute through the configured Workspace build factory; use aphrody-ops build-factory run --repo aphrody --revision <full-sha> -- bun m3/packages/app-ui/showcase/scripts/tauri.ts sidecar. Local Cargo flags do not authorize host builds.",
    );
}

export interface ShowcaseHostPlan {
  platform: string;
  arch: string;
  /** The desktop that opens the window. */
  desktopOwner: string;
  /** How the desktop shows the showcase. */
  launch: string;
  apiOwner: string;
  execution: "workspace-build-factory" | "local";
  missing: string[];
}

export function showcaseHostPlan(
  args: string[],
  platform: NodeJS.Platform = process.platform,
  which = Bun.which,
): ShowcaseHostPlan {
  const missing: string[] = [];
  const sidecar = args[0] === "sidecar";
  if (sidecar && !which("cargo"))
    missing.push("The Rust Cargo toolchain is missing");
  if (sidecar && !which("rustc")) missing.push("The Rust compiler is missing");
  return {
    platform,
    arch: process.arch,
    desktopOwner: DESKTOP_ROOT,
    launch: "aphrody-app --showcase",
    apiOwner: SHOWCASE_ROOT,
    execution: sidecar ? "workspace-build-factory" : "local",
    missing,
  };
}

async function runSidecar(): Promise<void> {
  let triple = process.env.APHRODY_M3_TAURI_TARGET;
  if (!triple) {
    const rust = Bun.spawn(["rustc", "-vV"], {
      windowsHide: true,
      stdout: "pipe",
      stderr: "inherit",
    });
    const output = await new Response(rust.stdout).text();
    if ((await rust.exited) !== 0)
      throw new Error("Cannot qualify the installed Rust host triple");
    triple = output.match(/^host: (.+)$/m)?.[1];
  }
  if (!triple) throw new Error("Missing native target triple");
  const command = sidecarCommand(triple);
  await mkdir(SIDECAR_STAGING, { recursive: true });
  const child = Bun.spawn(command, {
    windowsHide: true,
    cwd: SHOWCASE_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0)
    throw new Error(`Native API sidecar compilation failed with exit ${code}`);
  // The desktop resolves its sidecar beside its own executable. Metadata runs through the same
  // native Cargo owner, after factory admission.
  const metadata = Bun.spawn(
    [
      CARGO_RUNNER,
      "metadata",
      "--format-version",
      "1",
      "--no-deps",
      "--manifest-path",
      resolve(DESKTOP_ROOT, "Cargo.toml"),
    ],
    { windowsHide: true, cwd: APHRODY_ROOT, stdout: "pipe", stderr: "inherit" },
  );
  const output = await new Response(metadata.stdout).text();
  if ((await metadata.exited) !== 0)
    throw new Error("Cannot qualify the native desktop artifact directory");
  const targetDir = (JSON.parse(output) as { target_directory: string })
    .target_directory;
  const profile = process.env.APHRODY_M3_TAURI_PROFILE ?? "release";
  if (!["debug", "release"].includes(profile))
    throw new Error("Unsupported native desktop artifact profile");
  const suffix = triple.includes("windows") ? ".exe" : "";
  const beside = resolve(
    targetDir,
    ...(process.env.APHRODY_M3_TAURI_TARGET ? [triple] : []),
    profile,
    `m3-showcase${suffix}`,
  );
  await Bun.write(beside, Bun.file(command.at(-1)!));
}

export async function runTauri(input: string[] = []): Promise<void> {
  const planOnly = input.includes("--plan");
  const args = input.filter((arg) => arg !== "--plan");
  if (args.length === 0) args.push("info");
  if (args[0] !== "info" && args[0] !== "sidecar")
    throw new Error(
      "Use an explicit owner command: info or sidecar. The desktop is aphrody-app (scripts/build/rust/cargo-serial.sh build -p aphrody-app); it opens the showcase with --showcase",
    );
  const plan = showcaseHostPlan(args);
  if (planOnly || args[0] === "info") {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (plan.missing.length) throw new Error(plan.missing.join("\n"));
  const dispatched = await routeHeavyBuild(
    ["bun", "m3/packages/app-ui/showcase/scripts/tauri.ts", ...args],
    APHRODY_ROOT,
  );
  if (dispatched !== undefined) {
    if (dispatched !== 0)
      throw new Error(`Native build factory failed with exit ${dispatched}`);
    return;
  }
  const factory = await readFactoryConfig(APHRODY_ROOT);
  assertFactoryHost(heavyBuildStatus(factory, process.env, false));
  await runSidecar();
}

if (import.meta.main) {
  try {
    await runTauri(Bun.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

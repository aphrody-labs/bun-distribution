// SPDX-License-Identifier: Apache-2.0
/**
 * Cross-platform desktop application builder & packager for Aphrody Tauri.
 * Unified script replacing redundant shell and PowerShell implementations.
 *
 * Usage:
 *   bun scripts/tauri.ts [check|build|run|dev|bundle] [--bundles <bundles>]
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";

const VALID_ACTIONS = ["check", "build", "run", "dev", "bundle"] as const;
const TAURI_CLI_VERSION = "2.11.5";
type Action = (typeof VALID_ACTIONS)[number];

function parseArgs(args: string[]): { action: Action; bundles: string; repo: string } {
  let action: Action = "build";
  let bundles = "";
  let repo = process.cwd();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--bundles") bundles = args[++index] ?? "";
    else if (arg === "--root") repo = args[++index] ?? "";
    else if (!arg.startsWith("--") && VALID_ACTIONS.includes(arg as Action)) action = arg as Action;
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: aphrody-ops tauri [check|build|run|dev|bundle] [--root <aphrody-ui>] [--bundles <bundles>]",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!repo) throw new Error("--root requires an aphrody-ui repository path");
  return { action, bundles, repo: resolve(repo) };
}

export async function runTauri(args: string[]): Promise<number> {
  const { action, bundles, repo } = parseArgs(args);
  const appDir = join(repo, "crates", "aphrody-app");
  const uiDir = join(repo, "packages", "app-ui");
  const isWindows = process.platform === "win32";
  const isLinux = process.platform === "linux";
  if (!isWindows && !isLinux) throw new Error("Aphrody desktop targets Windows and Linux");
  const cleanEnv = { ...Bun.env, RUSTC_WRAPPER: "" };

  function runSync(command: string[], cwd: string, errorMessage: string) {
    console.log(`[tauri] Running: ${command.join(" ")} in ${cwd}`);
    const result = Bun.spawnSync(command, {
      cwd,
      env: cleanEnv,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) {
      throw new Error(`${errorMessage} (exit code ${result.exitCode})`);
    }
  }

  function hostTriple(): string {
    const rustc = Bun.spawnSync(["rustc", "-vV"], { cwd: repo, stdout: "pipe", stderr: "pipe" });
    if (rustc.exitCode !== 0) throw new Error(new TextDecoder().decode(rustc.stderr));
    const host = /^host: (.+)$/m.exec(new TextDecoder().decode(rustc.stdout))?.[1];
    if (!host) throw new Error("rustc did not report its host target");
    return host;
  }

  async function isFile(path: string): Promise<boolean> {
    return stat(path).then(
      (entry) => entry.isFile(),
      () => false,
    );
  }

  /**
   * Stage the `aphrody` CLI as the `binaries/aphrody` sidecar (Tauri appends the target triple
   * to externalBin names, as for the Drive daemon in drive/xtask) and beside the unbundled
   * desktop binary, where broker.rs resolves it before `PATH`.
   *
   * Source: `$APHRODY_SIDECAR_SOURCE` when set (a prebuilt binary), otherwise the sibling
   * `../aphrody-ai` workspace is built with `--locked` and its target directory is read from
   * `cargo metadata`, so no checkout or target path is hard-coded.
   */
  async function stageAphrodySidecar(profile: "debug" | "release") {
    const host = hostTriple();
    const suffix = host.includes("windows") ? ".exe" : "";
    let source = Bun.env.APHRODY_SIDECAR_SOURCE ?? "";
    if (!source) {
      const manifest = join(repo, "..", "aphrody-ai", "Cargo.toml");
      if (!(await isFile(manifest))) {
        throw new Error(
          `aphrody-ai must be checked out beside aphrody-ui (${manifest}) or APHRODY_SIDECAR_SOURCE set`,
        );
      }
      const metadata = Bun.spawnSync(
        ["cargo", "metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifest],
        { cwd: repo, env: cleanEnv, stdout: "pipe", stderr: "inherit" },
      );
      if (metadata.exitCode !== 0) throw new Error("cargo metadata failed for aphrody-ai");
      const targetDir = (
        JSON.parse(new TextDecoder().decode(metadata.stdout)) as { target_directory: string }
      ).target_directory;
      runSync(
        [
          "cargo",
          "build",
          "--manifest-path",
          manifest,
          "-p",
          "aphrody",
          "--bin",
          "aphrody",
          "--locked",
          ...(profile === "release" ? ["--release"] : []),
        ],
        repo,
        "aphrody CLI build failed",
      );
      source = join(targetDir, profile, `aphrody${suffix}`);
    }
    if (!(await isFile(source))) throw new Error(`aphrody sidecar binary missing: ${source}`);

    const binaries = join(appDir, "binaries");
    await mkdir(binaries, { recursive: true });
    const staged = join(binaries, `aphrody-${host}${suffix}`);
    await copyFile(source, staged);

    const appTarget = resolve(repo, Bun.env.CARGO_TARGET_DIR ?? "target");
    await mkdir(join(appTarget, profile), { recursive: true });
    const besideApp = join(appTarget, profile, `aphrody${suffix}`);
    if (resolve(source) !== resolve(besideApp)) await copyFile(source, besideApp);
    console.log(`[tauri] Staged aphrody sidecar: ${staged}`);
  }

  /** Bundle the headless Koharu SDK beside Aphrody; its model runtime stays out of the UI process. */
  async function stageKoharuSidecar(profile: "debug" | "release") {
    const host = hostTriple();
    const suffix = host.includes("windows") ? ".exe" : "";
    let source = Bun.env.KOHARU_SDK_SIDECAR_SOURCE ?? "";
    if (!source) {
      const koharuDir = join(repo, "..", "aphrody-koharu");
      const manifest = join(koharuDir, "Cargo.toml");
      if (!(await isFile(manifest))) {
        throw new Error(
          `aphrody-koharu must be checked out beside aphrody-ui (${manifest}) or KOHARU_SDK_SIDECAR_SOURCE set`,
        );
      }
      const metadata = Bun.spawnSync(
        ["cargo", "metadata", "--format-version", "1", "--no-deps", "--manifest-path", manifest],
        { cwd: koharuDir, env: cleanEnv, stdout: "pipe", stderr: "inherit" },
      );
      if (metadata.exitCode !== 0) throw new Error("cargo metadata failed for aphrody-koharu");
      const targetDir = (
        JSON.parse(new TextDecoder().decode(metadata.stdout)) as { target_directory: string }
      ).target_directory;
      runSync(
        [
          "cargo",
          "build",
          "--manifest-path",
          manifest,
          "-p",
          "koharu-library",
          "--bin",
          "koharu-sdk",
          "--locked",
          ...(profile === "release" ? ["--release"] : []),
        ],
        koharuDir,
        "Koharu SDK build failed",
      );
      source = join(targetDir, profile, `koharu-sdk${suffix}`);
    }
    if (!(await isFile(source))) throw new Error(`Koharu SDK sidecar binary missing: ${source}`);

    const binaries = join(appDir, "binaries");
    await mkdir(binaries, { recursive: true });
    const staged = join(binaries, `koharu-sdk-${host}${suffix}`);
    await copyFile(source, staged);

    const appTarget = resolve(repo, Bun.env.CARGO_TARGET_DIR ?? "target");
    await mkdir(join(appTarget, profile), { recursive: true });
    const besideApp = join(appTarget, profile, `koharu-sdk${suffix}`);
    if (resolve(source) !== resolve(besideApp)) await copyFile(source, besideApp);
    console.log(`[tauri] Staged Koharu SDK sidecar: ${staged}`);
  }

  /**
   * Updater settings injected at bundle time: `APHRODY_UPDATER_ENDPOINT` (the release feed of
   * the aphrody-infra release plane) and `APHRODY_UPDATER_PUBKEY` (minisign public key; the
   * private key stays in `TAURI_SIGNING_PRIVATE_KEY`, never in the repository). Signed updater
   * artifacts are produced only when the signing key is present.
   */
  function updaterConfigArgs(): string[] {
    const endpoint = Bun.env.APHRODY_UPDATER_ENDPOINT ?? "";
    const pubkey = Bun.env.APHRODY_UPDATER_PUBKEY ?? "";
    const signing = Boolean(Bun.env.TAURI_SIGNING_PRIVATE_KEY);
    if (!endpoint && !pubkey && !signing) {
      console.warn(
        "[tauri] Updater not configured (APHRODY_UPDATER_ENDPOINT / APHRODY_UPDATER_PUBKEY unset): in-app update checks will report it.",
      );
      return [];
    }
    if (!endpoint || !pubkey) {
      throw new Error("APHRODY_UPDATER_ENDPOINT and APHRODY_UPDATER_PUBKEY must be set together");
    }
    const overlay = {
      plugins: { updater: { pubkey, endpoints: [endpoint] } },
      ...(signing ? { bundle: { createUpdaterArtifacts: true } } : {}),
    };
    return ["--config", JSON.stringify(overlay)];
  }

  try {
    // Step 1: Build M3 UI unless action is 'check'
    if (action !== "check") {
      console.log("[tauri] Building M3 App UI...");
      runSync(["bun", "run", "build"], uiDir, "Aphrody M3 UI build failed");
    }

    // Step 2: Prepare Drive daemon unless action is 'check'
    if (action !== "check") {
      const profileFlag = action === "dev" ? "--debug" : "--release";
      console.log(`[tauri] Staging Drive daemon (${profileFlag})...`);
      runSync(
        ["aphrody-ops", "drive-daemon", "--root", repo, profileFlag],
        repo,
        "Drive daemon preparation failed",
      );
      console.log(`[tauri] Staging aphrody sidecar (${profileFlag})...`);
      await stageAphrodySidecar(action === "dev" ? "debug" : "release");
      console.log(`[tauri] Staging Koharu SDK sidecar (${profileFlag})...`);
      await stageKoharuSidecar(action === "dev" ? "debug" : "release");
    }

    // Step 3: Run target action in aphrody-app
    console.log(`[tauri] Executing action: ${action}...`);
    switch (action) {
      case "check":
        runSync(["cargo", "check", "--locked"], appDir, "cargo check failed");
        break;
      case "build":
        runSync(
          ["cargo", "build", "--release", "--locked", "--features", "custom-protocol"],
          appDir,
          "cargo build failed",
        );
        break;
      case "run":
        runSync(
          ["cargo", "run", "--release", "--locked", "--features", "custom-protocol"],
          appDir,
          "cargo run failed",
        );
        break;
      case "dev":
        runSync(["cargo", "run", "--locked"], appDir, "cargo dev failed");
        break;
      case "bundle": {
        const selectedBundles = bundles || (isWindows ? "nsis" : "deb,appimage");
        console.log(`[tauri] Packaging bundles: ${selectedBundles}...`);
        runSync(
          [
            "bunx",
            "--bun",
            `@tauri-apps/cli@${TAURI_CLI_VERSION}`,
            "build",
            "--config",
            "tauri.drive.conf.json",
            ...updaterConfigArgs(),
            "--bundles",
            selectedBundles,
            "--",
            "--locked",
          ],
          appDir,
          "tauri bundle failed",
        );
        break;
      }
    }

    console.log(`[tauri] Successfully completed action: ${action}`);
    return 0;
  } catch (error) {
    console.error(`[tauri] Execution failed:`, error instanceof Error ? error.message : error);
    return 1;
  }
}

if (import.meta.main) process.exit(await runTauri(process.argv.slice(2)));

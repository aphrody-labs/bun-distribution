#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Build the uutils multicall `coreutils` and its companions (findutils, diffutils, sed from
 * crates.io; grep and tar from `third_party/uutils-{grep,tar}` when those sources are present) into
 * `<repo>/target/aphrody-uutils/coreutils/bin`, the directory the kernel coreutils subsystem
 * resolves (`APHRODY_COREUTILS_BIN` overrides the multicall path; companions sit next to it).
 *
 * Cargo runs through `scripts/build/rust/cargo-serial.ts` (`--msvc` native context on Windows:
 * shared build lock, MSVC environment captured without a console, build output off the checkout).
 *
 * Usage: bun scripts/build/os/build-uutils-coreutils.ts [--verify] [--json]
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { main as cargoSerial } from "../rust/cargo-serial.ts";

export const repoRoot = resolve(import.meta.dir, "../../../../docs/aphrody");
export const installRoot = join(
  repoRoot,
  "target",
  "aphrody-uutils",
  "coreutils",
);
const WINDOWS = process.platform === "win32";
const EXE = WINDOWS ? ".exe" : "";

export const COREUTILS_VERSION = "0.12.0";
export const REQUIRED_UTILITIES = [
  "cat",
  "cp",
  "ls",
  "rm",
  "sha256sum",
  "sort",
  "whoami",
];

export interface Companion {
  /** Repository name under third_party/ and in the report. */
  repository: string;
  /** crates.io package and version; `undefined` when only a local source tree exists. */
  crate?: { name: string; version: string };
  binary: string;
  verifyArgs: string[];
}

/** Companions of the kernel coreutils subsystem (`COMPANIONS` in crates/os/kernel/core/src/coreutils.rs). */
export const COMPANIONS: Companion[] = [
  {
    repository: "uutils-findutils",
    crate: { name: "findutils", version: "0.10.0" },
    binary: "find",
    verifyArgs: ["--version"],
  },
  {
    repository: "uutils-diffutils",
    crate: { name: "diffutils", version: "0.5.0" },
    binary: "diffutils",
    verifyArgs: [],
  },
  {
    repository: "uutils-sed",
    crate: { name: "sed", version: "0.2.0" },
    binary: "sed",
    verifyArgs: ["--version"],
  },
  { repository: "uutils-grep", binary: "grep", verifyArgs: ["--version"] },
  {
    repository: "uutils-tar",
    binary: "tarapp",
    verifyArgs: ["tar", "--version"],
  },
];

export function coreutilsFeature(
  platform: NodeJS.Platform = process.platform,
): "windows" | "unix" {
  if (platform === "win32") return "windows";
  if (platform === "linux" || platform === "darwin") return "unix";
  throw new Error(
    `uutils/coreutils build is only wired for Windows, Linux and macOS, got: ${platform}`,
  );
}

/** `cargo install` arguments of one crate into the shared install root. */
export function installArgs(
  source: { crate: string; version: string } | { path: string },
  features?: string,
): string[] {
  const args = ["install", "--root", installRoot, "--locked", "--force"];
  if ("path" in source) args.push("--path", source.path);
  else args.push("--version", source.version, source.crate);
  if (features) args.push("--features", features);
  return args;
}

/** Missing required utilities in the `coreutils --list` output. */
export function missingUtilities(
  listing: string,
  required = REQUIRED_UTILITIES,
): string[] {
  const available = new Set(listing.split(/\s+/).filter(Boolean));
  return required.filter((utility) => !available.has(utility));
}

async function cargo(args: string[]): Promise<void> {
  const code = await cargoSerial(WINDOWS ? ["--msvc", ...args] : args);
  if (code !== 0)
    throw new Error(`cargo ${args.join(" ")} failed (exit ${code})`);
}

function run(binary: string, args: string[]): string {
  const result = Bun.spawnSync([binary, ...args], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0)
    throw new Error(
      `${binary} ${args.join(" ")} failed (exit ${result.exitCode}): ${result.stderr.toString()}`,
    );
  return result.stdout.toString();
}

export interface BuildReport {
  coreutils: string;
  feature: string;
  companions: Array<{
    repository: string;
    binary: string;
    status: "ready" | "unavailable";
    reason?: string;
  }>;
}

export async function build(verify: boolean): Promise<BuildReport> {
  const feature = coreutilsFeature();
  await cargo(
    installArgs({ crate: "coreutils", version: COREUTILS_VERSION }, feature),
  );
  const coreutils = join(installRoot, "bin", `coreutils${EXE}`);
  if (!existsSync(coreutils))
    throw new Error(
      `uutils build completed without the expected multicall binary: ${coreutils}`,
    );
  const missing = missingUtilities(run(coreutils, ["--list"]));
  if (missing.length > 0)
    throw new Error(
      `uutils multicall binary is missing required utilities: ${missing.join(", ")}`,
    );
  if (verify) run(coreutils, ["echo", "aphrody"]);

  const companions: BuildReport["companions"] = [];
  for (const companion of COMPANIONS) {
    const local = join(repoRoot, "third_party", companion.repository);
    const binary = join(installRoot, "bin", `${companion.binary}${EXE}`);
    if (existsSync(join(local, "Cargo.toml"))) {
      await cargo(installArgs({ path: local }));
    } else if (companion.crate) {
      await cargo(
        installArgs({
          crate: companion.crate.name,
          version: companion.crate.version,
        }),
      );
    } else {
      companions.push({
        repository: companion.repository,
        binary,
        status: "unavailable",
        reason: `not published on crates.io and third_party/${companion.repository} is absent`,
      });
      continue;
    }
    if (!existsSync(binary))
      throw new Error(
        `uutils companion build completed without expected binary: ${binary}`,
      );
    if (verify && companion.verifyArgs.length > 0)
      run(binary, companion.verifyArgs);
    companions.push({
      repository: companion.repository,
      binary,
      status: "ready",
    });
  }
  return { coreutils, feature, companions };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const unknown = args.filter(
    (arg) => !["--verify", "--json", "--help", "-h"].includes(arg),
  );
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: bun scripts/build/os/build-uutils-coreutils.ts [--verify] [--json]",
    );
  } else if (unknown.length > 0) {
    console.error(`Unknown argument: ${unknown.join(" ")}`);
    process.exitCode = 64;
  } else {
    try {
      const report = await build(args.includes("--verify"));
      if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
      else {
        for (const companion of report.companions)
          console.log(
            companion.status === "ready"
              ? `uutils/${companion.repository.slice(7)} is ready: ${companion.binary}`
              : `uutils/${companion.repository.slice(7)} is unavailable: ${companion.reason}`,
          );
        console.log(
          `uutils/coreutils is ready: ${report.coreutils} (${report.feature} feature set)`,
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}

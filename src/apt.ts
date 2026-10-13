#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
import { runPackageCLI } from "../packages/package-converter/src/cli.ts";
import sourceLock from "../sources.lock.json";
import manifest from "../package.json";

const apt = sourceLock.repositories.find(source => source.id === "apt");
if (!apt) throw new Error("The distribution has no pinned APT source owner");

const usage = `Bun OS APT package bridge
  apt.exe inspect INPUT --format FORMAT --ecosystem ECOSYSTEM
  apt.exe convert INPUT --format FORMAT --ecosystem ECOSYSTEM --package NAME --out NEW_DIRECTORY
  apt.exe upstream
  apt.exe --version

Use inspect --help for source, Windows artifact and runtime dependency options.
Conversion emits Bun package metadata and WinGet manifests for rebuilt PE executables.
The native libapt-pkg installation engine is a separate port qualification.`;

const [action, ...args] = Bun.argv.slice(2);
try {
  if (!action || action === "--help" || action === "help") console.log(usage);
  else if (action === "--version" || action === "version")
    console.log(
      JSON.stringify({
        product: "bun-os-apt",
        version: manifest.version,
        bunVersion: Bun.version,
        bunRevision: Bun.revision,
        platform: process.platform,
        architecture: process.arch,
        capabilities: ["package-inspection", "source-contract", "bun-package", "winget-manifest"],
        nativeLibaptEngine: false,
      }),
    );
  else if (action === "upstream")
    console.log(
      JSON.stringify(
        {
          ...apt,
          officialRepository: "https://salsa.debian.org/apt-team/apt",
        },
        null,
        2,
      ),
    );
  else if (action === "inspect" || action === "convert") await runPackageCLI([action, ...args]);
  else throw new Error(`Unknown APT bridge command ${action}; use --help`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

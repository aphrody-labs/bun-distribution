#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildApp } from "../infra/app-build.ts";
import { command, identity, packageRoot, readLock } from "./distribution.ts";

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      out: { type: "string" },
      config: { type: "string", default: join(packageRoot, "infra/apps.json") },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log(
      "bun src/build-apt.ts --out NEW_DIRECTORY [--config FILE]\nCompile apt.exe through the single app owner and qualify its actual version contract.",
    );
    return;
  }
  if (!values.out) throw new Error("An explicit fresh --out directory is required");
  if (process.platform !== "win32" || process.arch !== "x64")
    throw new Error("Qualify apt.exe with the selected native Windows x64 Bun owner");
  const output = resolve(values.out);
  const receipt = await buildApp(resolve(values.config!), "apt", "windows-x64", output);
  const executable = receipt.artifact.path;
  const before = await identity(executable);
  const version = JSON.parse(await command([executable, "--version"], output, 15_000));
  if (
    version.product !== "bun-os-apt" ||
    version.bunRevision !== receipt.runtime.revision ||
    version.bunVersion !== receipt.runtime.version ||
    version.platform !== "win32" ||
    version.architecture !== "x64" ||
    version.nativeLibaptEngine !== false
  )
    throw new Error("The executing APT artifact differs from its selected runtime or capability contract");
  const after = await identity(executable);
  if (
    before.sha256 !== receipt.artifact.sha256 ||
    before.bytes !== receipt.artifact.bytes ||
    JSON.stringify(before) !== JSON.stringify(after)
  )
    throw new Error("APT artifact changed during native execution qualification");
  receipt.aptSource = (await readLock()).repositories.find(source => source.id === "apt");
  receipt.qualification.nativeExecution = true;
  receipt.appQualification = {
    gates: ["apt-version-contract"],
    version,
    nativeLibaptEngine: false,
    packageConversion: false,
    sourceConversion: false,
  };
  await Bun.write(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify(receipt, null, 2));
}

if (import.meta.main)
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

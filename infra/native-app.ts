// SPDX-License-Identifier: MIT
import { chmod, link, lstat, mkdir, unlink } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";
import { contentIdentity, identity } from "../src/distribution.ts";
import type { NativeLaunchContract } from "./app-build.ts";

declare const __BUN_OS_NATIVE_CONTRACT__: NativeLaunchContract;

async function materialize(contract: NativeLaunchContract) {
  const home = Bun.env.USERPROFILE ?? Bun.env.HOME;
  const base =
    process.platform === "win32"
      ? (Bun.env.LOCALAPPDATA ?? (home ? join(home, "AppData/Local") : undefined))
      : (Bun.env.XDG_CACHE_HOME ?? (home ? join(home, ".cache") : undefined));
  if (!base) throw new Error("Native payload requires a configured user cache directory");
  const root = join(base, "bun-os/native"),
    objects = join(root, "objects/sha256");
  const launchIdentity = (await contentIdentity(new Blob([JSON.stringify(contract)]))).sha256;
  const launch = join(root, "launch", launchIdentity);
  await mkdir(objects, { recursive: true, mode: 0o700 });
  await mkdir(launch, { recursive: true, mode: 0o700 });
  const destinations = [];
  for (const file of contract.files) {
    if (
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !/^[a-zA-Z0-9_.+-]+$/.test(file.name) ||
      file.bytes < 1 ||
      file.bytes > 256 * 1024 * 1024
    )
      throw new Error("Invalid pinned native payload contract");
    const object = join(objects, file.sha256);
    if (!(await Bun.file(object).exists())) {
      let embedded: Blob | undefined;
      for (const candidate of Bun.embeddedFiles) {
        if (candidate.size !== file.bytes) continue;
        if ((await contentIdentity(candidate)).sha256 === file.sha256) {
          embedded = candidate;
          break;
        }
      }
      if (!embedded) throw new Error("Qualified native payload is absent from the standalone binary");
      const temporary = join(objects, "." + file.sha256 + "-" + crypto.randomUUID());
      await Bun.write(temporary, embedded);
      if ((await identity(temporary)).sha256 !== file.sha256)
        throw new Error("Materialized native payload checksum mismatch");
      await chmod(temporary, file.role === "executable" ? 0o700 : 0o600);
      try {
        await link(temporary, object);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      } finally {
        await unlink(temporary);
      }
    }
    const proof = await identity(object);
    if (proof.sha256 !== file.sha256 || proof.bytes !== file.bytes)
      throw new Error("Native object cache integrity failed");
    if (file.role === "executable") await chmod(object, 0o700);
    const destination = join(launch, file.name);
    try {
      await link(object, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const metadata = await lstat(destination);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (await identity(destination)).sha256 !== file.sha256)
      throw new Error("Native loader view integrity failed");
    destinations.push({ ...file, destination });
  }
  const backend = destinations.find(file => file.kind === "backend");
  if (!backend) throw new Error("Native backend has not been qualified");
  if (process.platform === "win32" && !backend.name.toLowerCase().endsWith(".exe"))
    throw new Error("Windows backend needs its actual executable filename");
  return { backend: backend.destination, directory: launch };
}
async function main() {
  if (typeof __BUN_OS_NATIVE_CONTRACT__ === "undefined" || !Bun.isStandaloneExecutable)
    throw new Error("Build this native app through its configured Bun application owner");
  const contract = __BUN_OS_NATIVE_CONTRACT__;
  const actual =
    process.platform === "win32"
      ? "windows-" + process.arch
      : process.platform === "darwin"
        ? "macos-" + process.arch
        : process.platform + "-" + process.arch;
  if (actual !== contract.target) throw new Error("Native app target does not match this execution context");
  if (Bun.argv.slice(2).length === 1 && Bun.argv[2] === "--bun-os-runtime-provenance") {
    console.log(
      JSON.stringify({
        appId: contract.appId,
        target: contract.target,
        version: Bun.version,
        revision: Bun.revision,
        platform: process.platform,
        architecture: process.arch,
        nativePayloads: contract.files.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })),
      }),
    );
    return;
  }
  const selected = await materialize(contract);
  const result = await runProcess([selected.backend, ...Bun.argv.slice(2)], process.cwd(), {
    env: {
      ...Bun.env,
      PATH: selected.directory + delimiter + (Bun.env.PATH ?? ""),
      ...(process.platform === "linux"
        ? { LD_LIBRARY_PATH: selected.directory + delimiter + (Bun.env.LD_LIBRARY_PATH ?? "") }
        : {}),
    },
    timeoutMs: 43_200_000,
    maxOutputBytes: 1,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    forwardSignals: true,
  });
  process.exitCode = result.code;
}
if (import.meta.main)
  main().catch(error => {
    console.error(error instanceof Error ? error.message : "Native app failed");
    process.exitCode = 1;
  });

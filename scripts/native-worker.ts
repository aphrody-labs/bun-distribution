#!/usr/bin/env bun
import { statfsSync } from "node:fs";
import { runProcess } from "@aphrody/bun-workspace/process";

/** The platform wrapper owns admission only; this shared owner controls child lifetime. */
async function main(): Promise<number> {
  const encoded = Bun.env.APHRODY_NATIVE_ARGUMENTS;
  const executable = Bun.env.APHRODY_NATIVE_EXECUTABLE;
  const cwd = Bun.env.APHRODY_NATIVE_CWD;
  const timeoutMs = Number(Bun.env.APHRODY_NATIVE_TIMEOUT_MS);
  if (!encoded || encoded.length > 1024 * 1024 || !executable || !cwd) {
    throw new Error(
      "The native build owner must supply bounded execution metadata.",
    );
  }
  const arguments_: unknown = JSON.parse(encoded);
  if (
    !Array.isArray(arguments_) ||
    arguments_.length > 10_000 ||
    arguments_.some(
      (value) => typeof value !== "string" || value.includes("\0"),
    )
  )
    throw new Error("Invalid native build arguments.");
  // Refuse to start a native build that would fill the volume holding its target directory.
  const minimumFreeBytes = Number(Bun.env.APHRODY_NATIVE_MIN_FREE_GB ?? 15) * 1024 ** 3;
  const volume = statfsSync(Bun.env.CARGO_TARGET_DIR ?? cwd);
  const freeBytes = volume.bavail * volume.bsize;
  if (freeBytes < minimumFreeBytes)
    throw new Error(
      `Only ${(freeBytes / 1024 ** 3).toFixed(1)} GB free for native builds (minimum ${minimumFreeBytes / 1024 ** 3} GB); free disk space first.`,
    );
  const env = { ...Bun.env };
  // Each admitted slot builds in its own Cargo target directory (slot 0 keeps the shared
  // `target/`) with an equal share of the host's cores, so slots never wait on Cargo's
  // directory lock or oversubscribe the CPU.
  const slot = Number(Bun.env.APHRODY_NATIVE_SLOT ?? 0);
  const slots = Math.max(1, Number(Bun.env.APHRODY_NATIVE_SLOTS ?? 3));
  // APHRODY_NATIVE_SLOT_ROOT moves the extra slots to another volume when the system disk is tight.
  if (Number.isSafeInteger(slot) && slot > 0 && env.CARGO_TARGET_DIR) {
    const root = Bun.env.APHRODY_NATIVE_SLOT_ROOT || env.CARGO_TARGET_DIR;
    env.CARGO_TARGET_DIR = `${root}${root.includes("\\") ? "\\" : "/"}slot-${slot}`;
  }
  if (env.CARGO_BUILD_JOBS === "auto")
    env.CARGO_BUILD_JOBS = String(Math.max(1, Math.floor(navigator.hardwareConcurrency / slots)));
  for (const key of Object.keys(env)) {
    if (key.startsWith("APHRODY_NATIVE_")) delete env[key];
  }
  const result = await runProcess([executable, ...arguments_], cwd, {
    timeoutMs,
    maxOutputBytes: 64 * 1024 * 1024,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return result.code;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "The native build failed.",
    );
    process.exitCode = 1;
  }
}

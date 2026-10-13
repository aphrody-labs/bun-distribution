#!/usr/bin/env bun
import { runProcess } from "../packages/workspace/src/process.ts";

/** The platform wrapper owns admission only; this shared owner controls child lifetime. */
async function main(): Promise<number> {
  const encoded = Bun.env.APHRODY_NATIVE_ARGUMENTS;
  const executable = Bun.env.APHRODY_NATIVE_EXECUTABLE;
  const cwd = Bun.env.APHRODY_NATIVE_CWD;
  const timeoutMs = Number(Bun.env.APHRODY_NATIVE_TIMEOUT_MS);
  if (!encoded || encoded.length > 1024 * 1024 || !executable || !cwd) {
    throw new Error("The native build owner must supply bounded execution metadata.");
  }
  const arguments_: unknown = JSON.parse(encoded);
  if (
    !Array.isArray(arguments_) ||
    arguments_.length > 10_000 ||
    arguments_.some(value => typeof value !== "string" || value.includes("\0"))
  )
    throw new Error("Invalid native build arguments.");
  const env = { ...Bun.env };
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
    console.error(error instanceof Error ? error.message : "The native build failed.");
    process.exitCode = 1;
  }
}

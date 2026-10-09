// SPDX-License-Identifier: Apache-2.0
/**
 * Python + uv + PyO3 Polyglot SDK Bridge (@aphrody/yolo-core/python)
 *
 * Bridges the Rust C-ABI, Bun native tooling, and Astral uv/Python environments.
 * Implements zero-copy status inspection, execution dispatch, and model-level bridging.
 */
import { existsSync } from "node:fs";

export interface PythonEnvironmentStatus {
  readonly schema: "yolo.python/1";
  readonly pythonVersion: string | null;
  readonly uvVersion: string | null;
  readonly maturinVersion: string | null;
  readonly ruffVersion: string | null;
  readonly venvActive: boolean;
  readonly ok: boolean;
}

export function detectPythonEnvironment(): PythonEnvironmentStatus {
  const pyBin = Bun.which("python3") ?? Bun.which("python");
  const uvBin = Bun.which("uv");
  const maturinBin = Bun.which("maturin");
  const ruffBin = Bun.which("ruff");

  const pythonVersion = pyBin
    ? Bun.spawnSync([pyBin, "--version"], { windowsHide: true }).stdout.toString().trim() || null
    : null;
  const uvVersion = uvBin
    ? Bun.spawnSync([uvBin, "--version"], { windowsHide: true }).stdout.toString().trim() || null
    : null;
  const maturinVersion = maturinBin
    ? Bun.spawnSync([maturinBin, "--version"], { windowsHide: true }).stdout.toString().trim() ||
      null
    : null;
  const ruffVersion = ruffBin
    ? Bun.spawnSync([ruffBin, "--version"], { windowsHide: true }).stdout.toString().trim() || null
    : null;
  const venvActive = Boolean(process.env.VIRTUAL_ENV && existsSync(process.env.VIRTUAL_ENV));

  return {
    schema: "yolo.python/1",
    pythonVersion,
    uvVersion,
    maturinVersion,
    ruffVersion,
    venvActive,
    ok: Boolean(pythonVersion && uvVersion),
  };
}

export async function runUvCommand(
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const uvBin = Bun.which("uv");
  if (!uvBin) {
    throw new Error(
      "Astral uv binary not found on PATH. Install uv to run native Python operations.",
    );
  }
  const proc = Bun.spawn([uvBin, ...args], {
    windowsHide: true,
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

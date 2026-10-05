// SPDX-License-Identifier: Apache-2.0
import { RuntimeError, Status } from "@aphrody/runtime-sdk";
import { installedArtifactDir, loadArtifact } from "@aphrody/runtime-sdk/artifact";

export interface MeasureOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  diagnostics?: (bytes: Uint8Array) => void;
}

export async function supervise(command: string[], cwd: string, options: MeasureOptions = {}) {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024 * 1024;
  const base = { command, cwd, startedAt, timeoutMs, maxOutputBytes, resourceUsage: null };
  const failure = (exitCode: number, reason: string) => ({
    ...base,
    durationMs: performance.now() - start,
    exitCode,
    processExitCode: null,
    signal: null,
    success: false,
    reason,
  });
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > 2_147_483_647 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes <= 0 ||
    maxOutputBytes > 64 * 1024 * 1024 ||
    !command.length ||
    command.some((arg) => typeof arg !== "string" || arg.includes("\0"))
  ) {
    return failure(2, "invalid_arguments");
  }
  if (options.signal?.aborted) return failure(130, "cancelled");
  if (process.platform !== "linux") return failure(125, "unsupported_platform");
  let phase = "runtime";
  try {
    const artifact = installedArtifactDir();
    if (!artifact) return failure(125, "runtime_unavailable");
    // Hashes, target and ABI are verified by the producer SDK before loading.
    using runtime = loadArtifact(artifact, { maxOperations: 2 });
    phase = "spawn";
    using child = runtime.spawn({
      program: command[0]!,
      args: command.slice(1),
      cwd,
      stdio: "capture-lossless",
      maxOutputBytes,
    });
    phase = "collect";
    const diagnostics =
      options.diagnostics ??
      ((bytes: Uint8Array) => {
        process.stderr.write(bytes);
      });
    const output = await child.collectOutput({
      timeoutMs,
      signal: options.signal,
      onStderr: diagnostics,
    });
    diagnostics(output.stdout);
    const status = output.status;
    return {
      ...base,
      durationMs: performance.now() - start,
      exitCode: status.signal ? 128 + status.signal : status.exitCode,
      processExitCode: status.exitCode,
      signal: status.signal || null,
      pid: status.pid,
      outputBytes: { stdout: output.stdout.length, stderr: output.stderr.length },
      runtime: runtime.buildInfo(),
      success: status.exitCode === 0 && status.signal === 0,
      reason: "exited",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "SuppressedError")
      return failure(125, "cleanup_failed");
    if (options.signal?.aborted) return failure(130, "cancelled");
    if (error instanceof RuntimeError && error.status === Status.Timeout)
      return failure(124, "timeout");
    if (error instanceof RuntimeError && error.status === Status.OutputLimit)
      return failure(125, "output_limit");
    return failure(phase === "spawn" ? 127 : 125, `${phase}_failed`);
  }
}

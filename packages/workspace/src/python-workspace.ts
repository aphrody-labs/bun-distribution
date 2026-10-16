// SPDX-License-Identifier: Apache-2.0
/**
 * Bounded supervisor of the `py/` uv workspace (the former `py/tools/workspace`, plan docs/plans/vu/PLAN.md D15).
 * `yolo py check|locks|distributions|providers|typecheck|format:check|plan` runs here: every command is spawned
 * through the verified Yolo runtime artifact with a timeout, an output budget, cancellation and a JSON receipt.
 */
import { RuntimeError, Status } from "@aphrody/runtime-sdk";
import {
  installedArtifactDir,
  loadArtifact,
} from "@aphrody/runtime-sdk/artifact";

export interface MeasureOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  maxOutputBytes?: number;
  diagnostics?: (bytes: Uint8Array) => void;
}

export async function supervise(
  command: string[],
  cwd: string,
  options: MeasureOptions = {},
) {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;
  const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024 * 1024;
  const base = {
    command,
    cwd,
    startedAt,
    timeoutMs,
    maxOutputBytes,
    resourceUsage: null,
  };
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
      outputBytes: {
        stdout: output.stdout.length,
        stderr: output.stderr.length,
      },
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

/** The supervised actions, with `uv` as the program (replaced by the vu runtime's absolute path by the caller). */
export function pythonWorkspaceCommands(uv = "uv") {
  const python = [
    uv,
    "run",
    "--locked",
    "python",
    "tools/packaging/modernize_workspace.py",
  ];
  return {
    build: [uv, "build", "--wheel", "packages/aphrody", "--out-dir", "dist"],
    check: [...python, "check"],
    locks: [...python, "locks"],
    distributions: [...python, "distributions"],
    providers: [...python, "providers"],
    test: [uv, "run", "--locked", "--no-sync", "pytest"],
    lint: [uv, "run", "--locked", "--no-sync", "ruff", "check", "."],
    fmt: [uv, "run", "--locked", "--no-sync", "ruff", "format", "."],
    "format:check": [
      uv,
      "run",
      "--locked",
      "--no-sync",
      "ruff",
      "format",
      "--check",
      ".",
    ],
    typecheck: [uv, "run", "--locked", "--no-sync", "mypy"],
  } satisfies Record<string, string[]>;
}

export const pythonWorkspaceActions = Object.keys(pythonWorkspaceCommands());

export interface PythonWorkspaceContext {
  /** Absolute directory of the `py/` uv workspace. */
  root: string;
  /** The uv program (absolute path inside the vu runtime, or `uv`). */
  uv?: string;
}

export async function runPythonWorkspace(
  args: string[],
  context: PythonWorkspaceContext,
  options: MeasureOptions = {},
): Promise<number> {
  const commands = pythonWorkspaceCommands(context.uv ?? "uv");
  args = [...args];
  const timeoutFlag = args.indexOf("--timeout-ms");
  if (timeoutFlag >= 0) {
    const timeoutMs = Number(args[timeoutFlag + 1]);
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 2_147_483_647
    ) {
      console.log(
        JSON.stringify({
          schemaVersion: 2,
          success: false,
          error: "Invalid timeout",
        }),
      );
      return 2;
    }
    args.splice(timeoutFlag, 2);
    options = { ...options, timeoutMs };
  }
  let [action, ...extra] = args;
  // Preserve the former CI invocation: fmt -- --check.
  if (
    action === "fmt" &&
    (extra.join(" ") === "-- --check" || extra.join(" ") === "--check")
  ) {
    action = "format:check";
    extra = [];
  }
  if (
    args.length === 0 ||
    action === "plan" ||
    action === "--help" ||
    action === "-h"
  ) {
    if (extra.length) {
      console.log(
        JSON.stringify({
          schemaVersion: 2,
          success: false,
          error: "Unexpected arguments",
        }),
      );
      return 2;
    }
    console.log(
      JSON.stringify(
        {
          schemaVersion: 2,
          usage: "yolo py <plan|command> [--timeout-ms <positive integer>]",
          root: context.root,
          commands,
          success: true,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  if (!action || !Object.hasOwn(commands, action) || extra.length) {
    console.log(
      JSON.stringify({
        schemaVersion: 2,
        success: false,
        error: "Unknown command or unexpected arguments",
      }),
    );
    return 2;
  }
  const result = await supervise(
    commands[action as keyof typeof commands],
    context.root,
    options,
  );
  console.log(JSON.stringify({ schemaVersion: 2, action, ...result }, null, 2));
  return result.exitCode || (result.success ? 0 : 1);
}

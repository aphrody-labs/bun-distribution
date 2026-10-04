// SPDX-License-Identifier: Apache-2.0

export interface CommandOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export interface PipelineExecution extends CommandOutput {
  command: string[];
  status: "executed" | "planned";
}

export interface CommandControls {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** The native owner refuses overflow; capture never silently truncates a pipeline result. */
  maxOutputBytes?: number;
}

export type CommandRunner = (
  command: string[],
  cwd: string,
  controls?: CommandControls,
) => Promise<CommandOutput>;

async function defaultRunner(
  command: string[],
  cwd: string,
  controls: CommandControls = {},
): Promise<CommandOutput> {
  const program = command[0];
  if (!program) throw new Error("A pipeline command requires a program");
  controls.signal?.throwIfAborted();
  if (
    controls.timeoutMs !== undefined &&
    (!Number.isFinite(controls.timeoutMs) || controls.timeoutMs <= 0)
  )
    throw new RangeError("timeoutMs must be a positive finite number");
  // Only the Bun execution surface loads FFI. Pure/server exports remain portable.
  const moduleName = "@aphrody/runtime-sdk/modules";
  const { processes } = (await import(moduleName)) as typeof import("@aphrody/runtime-sdk/modules");
  controls.signal?.throwIfAborted();
  using child = processes.spawn({
    program,
    args: command.slice(1),
    cwd,
    env: process.env,
    stdio: "capture-lossless",
    maxOutputBytes: controls.maxOutputBytes,
  });
  const output = await child.collectOutput({
    // Existing pipelines had no deadline. Explicit caller deadlines remain bounded and cancellable.
    timeoutMs: controls.timeoutMs ?? Number.MAX_SAFE_INTEGER,
    signal: controls.signal,
  });
  const code = output.status.signal > 0 ? 128 + output.status.signal : output.status.exitCode;
  return {
    code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
}

export async function executeCommand(
  command: string[],
  options: {
    cwd: string;
    dryRun?: boolean;
    runner?: CommandRunner;
  } & CommandControls,
): Promise<PipelineExecution> {
  if (options.dryRun) return { command, code: 0, stdout: "", stderr: "", status: "planned" };
  options.signal?.throwIfAborted();
  const controls: CommandControls = {};
  if (options.signal !== undefined) controls.signal = options.signal;
  if (options.timeoutMs !== undefined) controls.timeoutMs = options.timeoutMs;
  if (options.maxOutputBytes !== undefined) controls.maxOutputBytes = options.maxOutputBytes;
  const output = await (options.runner ?? defaultRunner)(command, options.cwd, controls);
  if (output.code !== 0) {
    const detail = output.stderr.trim() || output.stdout.trim() || "aucun diagnostic";
    throw new Error(`Commande échouée (${output.code}): ${command.join(" ")}\n${detail}`);
  }
  return { ...output, command, status: "executed" };
}

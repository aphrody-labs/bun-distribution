import { ProcessError, runProcess, type ProcessLimits } from "@aphrody/bun-workspace";
import { VideoLibraryError, type VideoErrorCode } from "./errors.ts";

export type { ProcessLimits } from "@aphrody/bun-workspace";

export interface ProcessResult {
  code: number;
  stdout: string;
}

const videoErrors: Record<ProcessError["code"], [VideoErrorCode, string]> = {
  INVALID_OPTIONS: ["INVALID_OPTIONS", "Invalid native video process options."],
  INTERRUPTED: ["NATIVE_INTERRUPTED", "The native video operation was interrupted."],
  TIMEOUT: ["NATIVE_TIMEOUT", "The native video operation exceeded its deadline."],
  OUTPUT_LIMIT: ["OUTPUT_LIMIT", "The native video operation exceeded its output limit."],
  START_FAILED: ["NATIVE_START_FAILED", "The native video process could not start."],
  FAILED: ["NATIVE_FAILED", "The native video operation failed."],
};

/** Video retains its public errors and JSON contract; the workspace owns child lifetime. */
export async function runBounded(
  argv: string[],
  cwd: string,
  limits: ProcessLimits,
  input?: Uint8Array,
): Promise<ProcessResult> {
  try {
    const result = await runProcess(argv, cwd, {
      ...limits,
      input,
      stderr: "discard",
    });
    return { code: result.code, stdout: result.stdout };
  } catch (error) {
    if (!(error instanceof ProcessError)) throw error;
    const [code, message] = videoErrors[error.code];
    throw new VideoLibraryError(code, message);
  }
}

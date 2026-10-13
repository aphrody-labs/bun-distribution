import type { NativeJSON } from "./json.ts";

export type VideoErrorCode =
  | "INVALID_OPTIONS"
  | "RUNTIME_MISMATCH"
  | "SOURCE_MISMATCH"
  | "ENGINE_MISSING"
  | "NATIVE_START_FAILED"
  | "NATIVE_FAILED"
  | "NATIVE_TIMEOUT"
  | "NATIVE_INTERRUPTED"
  | "OUTPUT_LIMIT"
  | "INVALID_NATIVE_JSON"
  | "INVALID_JSON_VALUE"
  | "INVALID_TIME";

/** Structured results remain available on failure; native stderr stays private. */
export class VideoLibraryError extends Error {
  readonly code: VideoErrorCode;
  readonly exitCode?: number;
  readonly result?: NativeJSON;

  constructor(code: VideoErrorCode, message: string, exitCode?: number, result?: NativeJSON) {
    super(message);
    this.name = "VideoLibraryError";
    this.code = code;
    this.exitCode = exitCode;
    this.result = result;
  }
}

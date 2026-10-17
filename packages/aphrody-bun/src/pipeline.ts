// SPDX-License-Identifier: Apache-2.0
/** Asynchronous, in-process Web workflows using the one Aphrody native library. */
import { cstr, trackJob, webJobWait, type CapturedResult } from "./engine";
import { loadPipelineSymbols } from "./library";

export interface WebPipelineOptions {
  signal?: AbortSignal;
  /** A native deadline aborts the future; persisted campaign evidence remains. */
  timeoutMs?: number;
}

export interface McpInvocation {
  /** Protected MCP config path; credentials stay in the native owner's env references. */
  config?: string;
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
}

/** Calls the existing native HTTP MCP client, including session/auth handling.
 * Stdio configurations are refused before starting any process. */
export async function mcpTool<T = unknown>(
  request: McpInvocation,
  options: WebPipelineOptions = {},
): Promise<{ server: string; tool: string; result: T }> {
  options.signal?.throwIfAborted();
  if (
    !request.server ||
    !request.tool ||
    request.arguments === null ||
    typeof request.arguments !== "object" ||
    Array.isArray(request.arguments)
  )
    throw new TypeError("MCP workflows require a server, tool and object arguments");
  return submitEncoded(JSON.stringify(request), options, "aphrody_mcp_tool_submit");
}

/** Arguments omit `aphrody web`. The same product owner handles CLI and FFI;
 * input strings are copied before the native submit returns, and all result
 * strings/handles are released by the existing job lifecycle. */
export async function webPipeline<T = unknown>(args: readonly string[], options: WebPipelineOptions = {}): Promise<T> {
  return submit<T>(args, options, "aphrody_web_pipeline_submit");
}

/** Compatibility commands use the same native runtime. Typed workflows above
 * avoid process-wide stdio capture and can execute independently in parallel. */
export async function commandPipeline(
  args: readonly string[],
  options: WebPipelineOptions = {},
): Promise<CapturedResult> {
  const result = await submit<CapturedResult>(args, options, "aphrody_command_submit");
  if (!Number.isInteger(result.code) || typeof result.stdout !== "string" || typeof result.stderr !== "string")
    throw new Error("Native command returned an invalid captured result");
  return result;
}

async function submit<T>(
  args: readonly string[],
  options: WebPipelineOptions,
  symbol: "aphrody_web_pipeline_submit" | "aphrody_command_submit",
): Promise<T> {
  options.signal?.throwIfAborted();
  if (args.length < 1 || args.length > 256 || args.some(arg => typeof arg !== "string" || arg.includes("\0")))
    throw new TypeError("Web workflows require 1..256 string arguments without NUL");
  return submitEncoded<T>(JSON.stringify(args), options, symbol);
}

async function submitEncoded<T>(
  encoded: string,
  options: WebPipelineOptions,
  symbol: "aphrody_web_pipeline_submit" | "aphrody_command_submit" | "aphrody_mcp_tool_submit",
): Promise<T> {
  options.signal?.throwIfAborted();
  const timeoutMs = options.timeoutMs ?? 1_800_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 0xffff_ffff)
    throw new RangeError("Web workflow timeout must be a positive uint32 millisecond value");
  const input = cstr(encoded);
  if (input.byteLength > 1_048_576 + 1) throw new RangeError("Web workflow arguments exceed one MiB");
  const id = trackJob(Number(loadPipelineSymbols()[symbol](input, timeoutMs)));
  const result: unknown = JSON.parse(await webJobWait(id, timeoutMs + 1000, { signal: options.signal }));
  if (result === null || typeof result !== "object") throw new Error("Native Web workflow returned an invalid result");
  if ("error" in result) {
    const message = String(result.error);
    throw new Error(message, {
      cause: message.startsWith("timed out after ") ? "native-deadline" : undefined,
    });
  }
  return result as T;
}

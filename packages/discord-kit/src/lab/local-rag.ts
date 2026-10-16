// SPDX-License-Identifier: Apache-2.0
import { isAbsolute } from "node:path";
import type {
  McpInvocation,
  WebPipelineOptions,
} from "@aphrody/bun/web/pipeline";

export interface NativeRagSelection {
  config: string;
  server: string;
}
export type NativeRagTransport = (
  request: McpInvocation,
  options: WebPipelineOptions,
) => Promise<{ result: unknown }>;

async function nativeMcp(request: McpInvocation, options: WebPipelineOptions) {
  const { mcpTool } = await import("@aphrody/bun/web/pipeline");
  return mcpTool(request, options);
}

export function ragPayload(result: unknown): {
  results: Record<string, unknown>[];
} {
  if (!result || typeof result !== "object")
    throw new Error("Invalid native RAG envelope");
  const call = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: { type: string; text?: string }[];
  };
  if (call.isError) throw new Error("Native RAG tool unavailable");
  let payload = call.structuredContent;
  if (payload === undefined || payload === null) {
    try {
      payload = JSON.parse(
        (call.content ?? [])
          .filter(
            (item) => item.type === "text" && typeof item.text === "string",
          )
          .map((item) => item.text)
          .join("\n"),
      );
    } catch {
      throw new Error("Invalid native RAG JSON envelope");
    }
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    "error" in payload ||
    !("results" in payload) ||
    !Array.isArray(payload.results) ||
    payload.results.some(
      (item: unknown) =>
        !item || typeof item !== "object" || Array.isArray(item),
    )
  )
    throw new Error("Native RAG payload unavailable");
  return payload as { results: Record<string, unknown>[] };
}

export async function searchLocalRag(
  selection: NativeRagSelection,
  query: string,
  limit: number,
  transport: NativeRagTransport = nativeMcp,
): Promise<{ results: Record<string, unknown>[] }> {
  if (!isAbsolute(selection.config) || selection.server !== "shenron-rag")
    throw new Error("Protected Shenron native MCP configuration required");
  if (
    !query.trim() ||
    Buffer.byteLength(query) > 512 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 8
  )
    throw new Error("Native RAG requires a bounded query and limit");
  const result = await transport(
    {
      config: selection.config,
      server: selection.server,
      tool: "aphrody_shenron_rag_search",
      arguments: { q: query, limit },
    },
    { timeoutMs: 30_000 },
  );
  return { results: ragPayload(result.result).results.slice(0, limit) };
}

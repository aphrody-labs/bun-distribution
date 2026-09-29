// SPDX-License-Identifier: Apache-2.0

import { describe, expect, test } from "bun:test";
import { runGrokXResearch, XaiClient, XTools } from "./src/index.ts";

function toolCall(id: string) {
  return {
    id,
    type: "function" as const,
    function: { name: "x_search", arguments: JSON.stringify({ query: "aphrody" }) },
  };
}

function response(content: string | null, id?: string) {
  return {
    id: "response",
    object: "chat.completion",
    created: 0,
    model: "grok-test",
    choices: [{
      index: 0,
      message: { role: "assistant", content, ...(id ? { tool_calls: [toolCall(id)] } : {}) },
    }],
  };
}

describe("runGrokXResearch", () => {
  test("dispatches native X tools and returns the final answer", async () => {
    const client = new XaiClient({ bearer: "test-bearer" });
    const requests: unknown[] = [];
    let calls = 0;
    client.chat = async (request) => {
      requests.push(structuredClone(request));
      calls++;
      return calls === 1 ? response(null, "call-1") : response("Research complete");
    };
    const searches: string[] = [];
    const xTools = new XTools({
      search: async (query: string) => {
        searches.push(query);
        return { tweets: [{ id: "1", text: "Result" }] };
      },
    } as any);

    const result = await runGrokXResearch({ query: "  Aphrody  " }, { client, xTools });

    expect(result).toEqual({ answer: "Research complete", toolRounds: 1, toolCalls: 1, stopReason: "completed" });
    expect(searches).toEqual(["aphrody"]);
    expect((requests[0] as any).messages[0].content).toBe("Aphrody");
    expect((requests[0] as any).tools).toHaveLength(5);
    expect((requests[1] as any).messages.at(-1).role).toBe("tool");
  });

  test("stops a repeated tool loop at the configured bound", async () => {
    const client = new XaiClient({ bearer: "test-bearer" });
    let calls = 0;
    client.chat = async () => response(null, `call-${++calls}`);
    const xTools = new XTools({ search: async () => ({ tweets: [] }) } as any);

    const result = await runGrokXResearch({ query: "Aphrody", maxToolRounds: 1 }, { client, xTools });

    expect(result).toEqual({ answer: null, toolRounds: 1, toolCalls: 1, stopReason: "round_limit" });
    expect(calls).toBe(2);
  });

  test("rejects invalid input before opening a client", async () => {
    expect(runGrokXResearch({ query: " " })).rejects.toThrow("query must be a non-empty string");
    expect(runGrokXResearch({ query: "ok", maxToolRounds: 0 })).rejects.toThrow("maxToolRounds");
  });
});

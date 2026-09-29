// SPDX-License-Identifier: Apache-2.0

import { XaiClient } from "./core/client.ts";
import { XTools, xNativeTools } from "@aphrody/x";

export interface GrokXResearchInput {
  query: string;
  model?: string;
  maxToolRounds?: number;
}

export interface GrokXResearchResult {
  answer: string | null;
  toolRounds: number;
  toolCalls: number;
  stopReason: "completed" | "round_limit";
}

/** Run a bounded Grok conversation with the native X tools. No Actor or kernel runtime is required. */
export async function runGrokXResearch(
  input: GrokXResearchInput,
  dependencies: { client?: XaiClient; xTools?: XTools } = {},
): Promise<GrokXResearchResult> {
  const query = input.query?.trim();
  if (!query) throw new Error("query must be a non-empty string");

  const maxToolRounds = input.maxToolRounds ?? 4;
  if (!Number.isInteger(maxToolRounds) || maxToolRounds < 1 || maxToolRounds > 10) {
    throw new Error("maxToolRounds must be an integer from 1 to 10");
  }

  const client = dependencies.client ?? new XaiClient();
  const chat = client.createChat(input.model ?? "grok-3", {
    tools: [...xNativeTools],
  });
  chat.append(query);

  let response = await chat.sample();
  let toolRounds = 0;
  let toolCalls = 0;
  while (response.choices[0]?.message.tool_calls?.length) {
    if (toolRounds >= maxToolRounds) {
      return { answer: null, toolRounds, toolCalls, stopReason: "round_limit" };
    }
    const pending = response.choices[0].message.tool_calls.length;
    const executed = await chat.executeToolCalls({}, dependencies.xTools);
    if (executed !== pending) {
      throw new Error("Grok requested an X tool that could not be executed");
    }
    toolRounds++;
    toolCalls += executed;
    response = await chat.sample();
  }

  return {
    answer: response.choices[0]?.message.content ?? null,
    toolRounds,
    toolCalls,
    stopReason: "completed",
  };
}

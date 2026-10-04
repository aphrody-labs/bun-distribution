// SPDX-License-Identifier: Apache-2.0
/** Bun-only adapter: the same grounding/AI SDK contract, backed by the resident native engine. */
import { NativeInference, type NativeInferenceOptions } from "@aphrody/inference";
import { createAphrodyChatModel } from "./chat";

export const SHENRON_NATIVE_MODEL = "gemma-4-e2b-it-q4km";
const sessions = new Map<string, Promise<NativeInference>>();
const lifetime = new AbortController();

function session(options: NativeInferenceOptions) {
  lifetime.signal.throwIfAborted();
  const key = JSON.stringify(options);
  let pending = sessions.get(key);
  if (!pending) {
    pending = NativeInference.open(options, { signal: lifetime.signal }).catch((error) => {
      sessions.delete(key);
      throw error;
    });
    sessions.set(key, pending);
  }
  return pending;
}

export function createNativeShenronChatModel(options: Omit<NativeInferenceOptions, "profile">) {
  return createAphrodyChatModel(
    {
      async chat(input) {
        input.signal?.throwIfAborted();
        const engine = await session({ ...options, profile: "dbfr" });
        const systems = input.messages
          .filter((message) => message.role === "system")
          .map((message) => message.content);
        const messages = input.messages
          .filter((message) => message.role !== "system")
          .map((message) => ({
            role: message.role as "user" | "assistant",
            content: message.content,
          }));
        const result = await engine.chat({
          messages,
          system: systems.join("\n\n"),
          signal: input.signal ? AbortSignal.any([input.signal, lifetime.signal]) : lifetime.signal,
        });
        return { ok: true, value: { answer: result.text, model: result.model } };
      },
    },
    { modelId: options.model },
  );
}

/** Called after the bot's active requests have drained. */
export async function closeNativeShenronInference(): Promise<void> {
  lifetime.abort(new DOMException("Bot is shutting down", "AbortError"));
  const pending = [...sessions.values()];
  sessions.clear();
  const loaded = await Promise.allSettled(pending);
  await Promise.all(
    loaded.flatMap((result) => (result.status === "fulfilled" ? [result.value.close()] : [])),
  );
}

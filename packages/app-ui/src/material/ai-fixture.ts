// SPDX-License-Identifier: Apache-2.0
// The labelled AG-UI protocol fixture of the AI page: real package data, protocol events, no model
// call. The page runs it in-process; the standalone Bun host serves the same stream over HTTP.
import { EventEncoder, EventType, type BaseEvent } from "@aphrody/m3-ai/ag-ui";
import { PACKAGES } from "./inventory.ts";

export const FIXTURE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-store",
  "X-M3-Fixture": "true",
  "X-Content-Type-Options": "nosniff",
} as const;

function fixtureEvents(prompt: string): BaseEvent[] {
  const runId = "fixture-" + crypto.randomUUID();
  const messageId = runId + "-message";
  const response =
    "Local protocol fixture: your draft contains " +
    prompt.length +
    " characters. This workspace exposes " +
    PACKAGES.length +
    " packages. The transcript below is rendered from AG-UI events.";
  return [
    { type: EventType.RUN_STARTED, threadId: "material-fixture", runId },
    {
      type: EventType.TOOL_CALL_START,
      toolCallId: "inventory",
      toolCallName: "package_inventory",
    },
    { type: EventType.TOOL_CALL_ARGS, toolCallId: "inventory", delta: "{}" },
    { type: EventType.TOOL_CALL_END, toolCallId: "inventory" },
    {
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: "inventory",
      messageId: runId + "-inventory",
      role: "tool",
      content: JSON.stringify({
        packages: PACKAGES.length,
        source: "build inventory",
      }),
    },
    { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
    ...response.match(/.{1,12}/g)!.map(delta => ({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta,
    })),
    { type: EventType.TEXT_MESSAGE_END, messageId },
    { type: EventType.RUN_FINISHED, threadId: "material-fixture", runId },
  ] as BaseEvent[];
}

/** SSE body of the fixture for `prompt`, one event per tick; `signal` aborts the producer. */
export function fixtureStream(prompt: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new EventEncoder();
  const events = fixtureEvents(prompt);
  let timer: ReturnType<typeof setInterval> | undefined;
  let abort: (() => void) | undefined;
  const cleanup = () => {
    if (timer) clearInterval(timer);
    if (abort) signal.removeEventListener("abort", abort);
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (signal.aborted) {
        controller.error(signal.reason);
        return;
      }
      let index = 0;
      abort = () => {
        cleanup();
        controller.error(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      timer = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(encoder.encodeSSE(events[index++])));
        if (index === events.length) {
          cleanup();
          controller.close();
        }
      }, 45);
    },
    cancel() {
      cleanup();
    },
  });
}

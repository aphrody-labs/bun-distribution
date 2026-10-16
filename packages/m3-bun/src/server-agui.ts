// SPDX-License-Identifier: Apache-2.0
// The server side of the AG-UI protocol (`@aphrody/m3-ai/ag-ui`): `POST /api/m3/ag-ui` takes a `RunAgentInput`, runs
// the agent and streams its events with the AG-UI `EventEncoder`, as server-sent events or, when the client accepts
// `application/vnd.ag-ui.event+proto`, as length-prefixed protobuf. The agent is an `AbstractAgent` (its `run`
// returns an Observable) or a function returning an (async) iterable of events. A failure ends the stream with a
// `RUN_ERROR` event. `HttpAgent` of the same package is the matching client.
import type { M3Route } from "./api.ts";
import { loadOptional } from "./server-optional.ts";

type AgUi = typeof import("@aphrody/m3-ai/ag-ui");
type RunAgentInput = import("@aphrody/m3-ai/ag-ui").RunAgentInput;
type BaseEvent = import("@aphrody/m3-ai/ag-ui").BaseEvent;

interface Observer {
  next(event: BaseEvent): void;
  error(error: unknown): void;
  complete(): void;
}

export type M3AgUiAgent =
  | {
      run(input: RunAgentInput): {
        subscribe(observer: Observer): { unsubscribe(): void };
      };
    }
  | ((
      input: RunAgentInput,
      request: Request,
    ) => Iterable<BaseEvent> | AsyncIterable<BaseEvent>);

const isInput = (value: unknown): value is RunAgentInput => {
  const input = value as Partial<RunAgentInput> | null;
  return (
    typeof input === "object" &&
    input !== null &&
    typeof input.threadId === "string" &&
    typeof input.runId === "string" &&
    Array.isArray(input.messages)
  );
};

/** The `POST` route serving `agent` (mount it at `/api/m3/ag-ui`). */
export function agUiRoute(agent: M3AgUiAgent): M3Route {
  return {
    POST: async (request) => {
      const agUi = await loadOptional<AgUi>(
        "@aphrody/m3-ai/ag-ui",
        "AG-UI endpoint",
      );
      let input: unknown;
      try {
        input = await request.json();
      } catch {
        input = undefined;
      }
      if (!isInput(input))
        return Response.json(
          { error: "body must be a RunAgentInput (threadId, runId, messages)" },
          { status: 400 },
        );
      // Protobuf only when asked for by name: `*/*` (fetch's default) gets server-sent events.
      const accept = request.headers.get("accept") ?? "";
      const encoder = new agUi.EventEncoder({
        accept: accept.includes(agUi.AGUI_MEDIA_TYPE)
          ? accept
          : "text/event-stream",
      });
      const proto = encoder.getContentType() === agUi.AGUI_MEDIA_TYPE;
      const encode = (event: BaseEvent): string | Uint8Array =>
        proto ? encoder.encodeBinary(event) : encoder.encode(event);
      let subscription: { unsubscribe(): void } | undefined;
      const body = new ReadableStream<string | Uint8Array>({
        start(controller) {
          const fail = (error: unknown): void => {
            controller.enqueue(
              encode({
                type: agUi.EventType.RUN_ERROR,
                message: error instanceof Error ? error.message : String(error),
              } as BaseEvent),
            );
            controller.close();
          };
          if (typeof agent === "function") {
            void (async () => {
              try {
                for await (const event of agent(input, request))
                  controller.enqueue(encode(event));
                controller.close();
              } catch (error) {
                fail(error);
              }
            })();
            return;
          }
          subscription = agent.run(input).subscribe({
            next: (event) => controller.enqueue(encode(event)),
            error: fail,
            complete: () => controller.close(),
          });
        },
        cancel: () => subscription?.unsubscribe(),
      });
      return new Response(body, {
        headers: {
          "Content-Type": encoder.getContentType(),
          "Cache-Control": "no-store",
        },
      });
    },
  };
}

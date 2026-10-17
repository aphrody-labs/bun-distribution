// SPDX-License-Identifier: Apache-2.0
// Realtime topics of the m3-bun server on Bun's native WebSockets: `GET /api/m3/ws?topic=a&topic=b` upgrades and
// subscribes the socket to its topics; the server publishes with `publish(server, topic, data)` (`server.publish`,
// fan-out in native code). With `relay`, a client message `{"topic": "a", "data": …}` reaches the other subscribers.
// Every frame is the JSON envelope `{"topic", "data"}`.
import type { Server, ServerWebSocket, WebSocketHandler } from "bun";

export interface M3SocketData {
  topics: string[];
}

export interface M3RealtimeOptions {
  /** Upgrade path (default `/api/m3/ws`). */
  path?: string;
  /** Topics of a connection (default: its `topic` query parameters); `undefined` refuses it with 403. */
  topics?: (request: Request) => string[] | undefined | Promise<string[] | undefined>;
  /** Let clients publish to the topics they subscribed to (default false: the server alone publishes). */
  relay?: boolean;
  /** Every client message, after the relay. */
  message?: (socket: ServerWebSocket<M3SocketData>, message: string | Buffer) => void;
}

const TOPIC = /^[\w.:/-]{1,128}$/;

/** Publish `data` to the subscribers of `topic`; resolves the bytes sent (0 when nobody listens). */
export function publish(server: Pick<Server<M3SocketData>, "publish">, topic: string, data: unknown): number {
  return server.publish(topic, JSON.stringify({ topic, data }));
}

/** The upgrade route and the `websocket` handler `Bun.serve` needs. */
export function realtimeHandlers(options: M3RealtimeOptions = {}): {
  path: string;
  upgrade(request: Request, server: Server<M3SocketData>): Promise<Response | undefined>;
  websocket: WebSocketHandler<M3SocketData>;
} {
  const path = options.path ?? "/api/m3/ws";
  return {
    path,
    async upgrade(request, server) {
      const topics = options.topics ? await options.topics(request) : new URL(request.url).searchParams.getAll("topic");
      if (!topics) return new Response("Forbidden", { status: 403 });
      if (!topics.every(topic => TOPIC.test(topic))) return new Response("Bad Request: invalid topic", { status: 400 });
      if (server.upgrade(request, { data: { topics } })) return undefined;
      return new Response("Upgrade Required", {
        status: 426,
        headers: { Upgrade: "websocket" },
      });
    },
    websocket: {
      open(socket) {
        for (const topic of socket.data.topics) socket.subscribe(topic);
      },
      message(socket, message) {
        if (options.relay && typeof message === "string") {
          let envelope: { topic?: unknown; data?: unknown } | undefined;
          try {
            envelope = JSON.parse(message) as {
              topic?: unknown;
              data?: unknown;
            };
          } catch {
            envelope = undefined;
          }
          const topic = envelope?.topic;
          if (typeof topic === "string" && socket.isSubscribed(topic))
            socket.publish(topic, JSON.stringify({ topic, data: envelope?.data }));
        }
        options.message?.(socket, message);
      },
    },
  };
}

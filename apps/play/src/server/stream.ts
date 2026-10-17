// SPDX-License-Identifier: Apache-2.0
/**
 * Relay between the browser and the packages/bun-gamestream signalling server. The page keeps the
 * unchanged gamestream client, which opens `/ws` on this origin; this server authenticates the
 * upgrade and forwards its JSON messages to the gamestream WebSocket (the stream container binds
 * it on the wg1 address). Media then flows peer to peer: the sender only advertises wg1 ICE
 * candidates, so viewers must be on the Aphrody mesh.
 */
import type { ServerWebSocket } from "bun";
import type { ServerMessage } from "../../../../packages/bun-gamestream/src/protocol";
import { config } from "./config";

export interface StreamSocket {
  upstream: WebSocket | null;
  queue: string[];
}

export type StreamEvent = {
  kind: "open" | "close" | "state";
  user: string;
  detail?: string;
};

export function openRelay(
  ws: ServerWebSocket<{ stream: StreamSocket; user: string }>,
  notify: (event: StreamEvent) => void,
): void {
  const relay = ws.data.stream;
  let upstream: WebSocket;
  try {
    upstream = new WebSocket(config.gamestreamWs);
  } catch (error) {
    ws.send(
      JSON.stringify({ type: "hello", sender: null } satisfies ServerMessage),
    );
    ws.send(
      JSON.stringify({
        type: "error",
        message: `gamestream unavailable: ${String(error)}`,
      } satisfies ServerMessage),
    );
    return;
  }
  relay.upstream = upstream;
  const fail = (message: string) => {
    if (ws.readyState !== 1) return;
    ws.send(
      JSON.stringify({ type: "hello", sender: null } satisfies ServerMessage),
    );
    ws.send(JSON.stringify({ type: "error", message } satisfies ServerMessage));
  };
  const timer = setTimeout(() => {
    if (upstream.readyState !== WebSocket.OPEN) {
      upstream.close();
      fail("gamestream server unreachable (is the stream container up?)");
    }
  }, 4000);
  upstream.onopen = () => {
    clearTimeout(timer);
    for (const message of relay.queue.splice(0)) upstream.send(message);
    notify({ kind: "open", user: ws.data.user });
  };
  upstream.onmessage = (event) => {
    const text = String(event.data);
    if (ws.readyState === 1) ws.send(text);
    try {
      const message = JSON.parse(text) as ServerMessage;
      if (message.type === "state")
        notify({ kind: "state", user: ws.data.user, detail: message.ice });
    } catch {
      /* forwarded unchanged */
    }
  };
  upstream.onerror = () => fail("gamestream connection error");
  upstream.onclose = () => {
    clearTimeout(timer);
    notify({ kind: "close", user: ws.data.user });
    if (ws.readyState === 1) ws.close(1011, "gamestream closed");
  };
}

export function relayMessage(relay: StreamSocket, message: string): void {
  if (message.length > 64 * 1024) return;
  if (relay.upstream?.readyState === WebSocket.OPEN)
    relay.upstream.send(message);
  else if (relay.queue.length < 64) relay.queue.push(message);
}

export function closeRelay(relay: StreamSocket): void {
  relay.upstream?.close();
  relay.upstream = null;
}

export async function gamestreamHealth(): Promise<{
  reachable: boolean;
  sender: unknown;
  viewer: boolean;
}> {
  try {
    const response = await fetch(config.gamestreamHealth, {
      signal: AbortSignal.timeout(2000),
    });
    const body = (await response.json()) as {
      sender?: unknown;
      viewer?: boolean;
    };
    return {
      reachable: response.ok,
      sender: body.sender ?? null,
      viewer: body.viewer === true,
    };
  } catch {
    return { reachable: false, sender: null, viewer: false };
  }
}

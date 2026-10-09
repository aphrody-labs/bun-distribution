// SPDX-License-Identifier: Apache-2.0
/**
 * Server side of the WebOS wasm modules, mounted by server.ts:
 * cross-origin isolation (SharedArrayBuffer for wasip1-threads), and the
 * network relays wasm code uses since a page cannot open raw sockets.
 * Relays only reach hosts listed in WEBOS_NET_ALLOW (comma-separated
 * `host` or `host:port`); default is loopback only.
 */
import type { Server, ServerWebSocket } from "bun";

const ALLOW = (process.env.WEBOS_NET_ALLOW ?? "localhost,127.0.0.1,[::1]")
  .split(",")
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

export function allowed(host: string, port: number): boolean {
  const h = host.toLowerCase();
  return ALLOW.includes(h) || ALLOW.includes(`${h}:${port}`) || ALLOW.includes("*");
}

/** COOP/COEP so the page is crossOriginIsolated; applied to every response. */
export function withIsolation(res: Response): Response {
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return res;
}

export interface TcpRelayData {
  webosTcp: { host: string; port: number; socket?: { write(d: Uint8Array): number; end(): void }; queue: Uint8Array[] };
}

/**
 * `POST /api/webos/fetch` `{url, method?, headers?, body?}` → upstream response,
 * `GET /api/webos/tcp?host=&port=` → WebSocket upgrade relaying bytes to TCP.
 */
export async function handleWebOsNet(req: Request, url: URL, server: Server): Promise<Response | undefined> {
  if (url.pathname === "/api/webos/fetch" && req.method === "POST") {
    const body = (await req.json()) as {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };
    const target = new URL(body.url);
    const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
    if (!/^https?:$/.test(target.protocol) || !allowed(target.hostname, port)) {
      return new Response("host not allowed by WEBOS_NET_ALLOW", { status: 403 });
    }
    const upstream = await fetch(target, {
      method: body.method ?? "GET",
      headers: body.headers,
      body: body.body,
      redirect: "manual",
    });
    return new Response(upstream.body, { status: upstream.status, headers: upstream.headers });
  }
  if (url.pathname === "/api/webos/tcp") {
    const host = url.searchParams.get("host") ?? "";
    const port = Number(url.searchParams.get("port"));
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !allowed(host, port)) {
      return new Response("host not allowed by WEBOS_NET_ALLOW", { status: 403 });
    }
    const data: TcpRelayData = { webosTcp: { host, port, queue: [] } };
    return server.upgrade(req, { data })
      ? new Response(null, { status: 101 })
      : new Response("upgrade failed", { status: 400 });
  }
  return undefined;
}

/** WebSocket handlers for the TCP relay; return false when the socket is not a relay. */
export const webosTcpSocket = {
  open(ws: ServerWebSocket<unknown>): boolean {
    const relay = (ws.data as Partial<TcpRelayData> | undefined)?.webosTcp;
    if (!relay) return false;
    void Bun.connect({
      hostname: relay.host,
      port: relay.port,
      socket: {
        open(socket) {
          relay.socket = socket;
          for (const chunk of relay.queue.splice(0)) socket.write(chunk);
        },
        data(_socket, chunk) {
          ws.sendBinary(chunk);
        },
        close() {
          ws.close();
        },
        error() {
          ws.close(1011, "tcp error");
        },
      },
    }).catch(() => ws.close(1011, "connect failed"));
    return true;
  },
  message(ws: ServerWebSocket<unknown>, message: string | Buffer): boolean {
    const relay = (ws.data as Partial<TcpRelayData> | undefined)?.webosTcp;
    if (!relay) return false;
    const bytes = typeof message === "string" ? new TextEncoder().encode(message) : new Uint8Array(message);
    if (relay.socket) relay.socket.write(bytes);
    else relay.queue.push(bytes);
    return true;
  },
  close(ws: ServerWebSocket<unknown>): boolean {
    const relay = (ws.data as Partial<TcpRelayData> | undefined)?.webosTcp;
    if (!relay) return false;
    relay.socket?.end();
    return true;
  },
};

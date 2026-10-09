// SPDX-License-Identifier: Apache-2.0
/**
 * WebOS routes outside server.ts: network relays of the wasm apps, the FFI explorer, and measured system state.
 *
 * server.ts mounts them with:
 *   import { handleWebOsExtensions, webosTcpSocket, withIsolation } from "./src/os/server-extensions";
 *   // first statement of fetch(req, server):
 *   const ext = await handleWebOsExtensions(req, url, server);
 *   if (ext) return withIsolation(ext);
 *   // every other response goes through withIsolation(...) so the page stays crossOriginIsolated;
 *   // websocket.open/message/close start with `if (webosTcpSocket.open(ws)) return;` (same for message, close).
 */
import type { Server } from "bun";
import { handleFfi } from "./ffi-routes";
import { systemSnapshot } from "./system-metrics";
import { handleWebOsNet } from "./wasm/server-routes";

export { webosTcpSocket, withIsolation } from "./wasm/server-routes";

export async function handleWebOsExtensions(req: Request, url: URL, server: Server<unknown>): Promise<Response | null> {
  if (url.pathname === "/api/webos/system" && req.method === "GET") return Response.json(await systemSnapshot());
  if (url.pathname.startsWith("/api/ffi/")) return handleFfi(req, url);
  return (await handleWebOsNet(req, url, server)) ?? null;
}

// SPDX-License-Identifier: Apache-2.0
import type { Snapshot } from "./model.ts";
import { query } from "./graphql.ts";

/** Mount in any Bun.serve application or supply an in-memory snapshot in tests. */
export function createTimelineHandler(snapshot: () => Snapshot | Promise<Snapshot>) {
  return async (request: Request): Promise<Response> => {
    try {
      const path = new URL(request.url).pathname;
      if (path === "/health") {
        const s = await snapshot();
        return Response.json({
          generation: s.generation,
          mediaTotal: s.mediaTotal,
          ageTotal: s.ageTotal,
          fetchedAt: s.fetchedAt,
        });
      }
      if (path === "/timeline.json") return Response.json(await snapshot());
      if (path !== "/graphql") return new Response("Not found", { status: 404 });
      if (request.method !== "POST")
        return new Response("POST required", { status: 405, headers: { Allow: "POST" } });
      if (Number(request.headers.get("content-length")) > 32768)
        return new Response("Request too large", { status: 413 });
      const text = await request.text();
      if (text.length > 32768) return new Response("Request too large", { status: 413 });
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      if (!body || typeof body.query !== "string" || body.query.length > 16384)
        return new Response("Invalid query", { status: 400 });
      return Response.json(
        await query(await snapshot(), body.query, body.variables, body.operationName),
      );
    } catch {
      return Response.json({ error: "Timeline unavailable" }, { status: 503 });
    }
  };
}

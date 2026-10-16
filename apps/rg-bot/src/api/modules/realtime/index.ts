import { Elysia } from "elysia";

export const realtimeController = new Elysia({ prefix: "/realtime" })
	.get("/health", () => ({
		ok: true,
		service: "rg-realtime-elysia",
		engine: "sse-postgres"
	}))
	.get("/v1/stream", () => {
		return new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("event: connected\ndata: {}\n\n"));
				}
			}),
			{
				headers: {
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
					connection: "keep-alive"
				}
			}
		);
	});

import { afterAll, afterEach, beforeAll } from "bun:test";

import { setupServer } from "msw/node";

import { apiHandlers } from "./server/handlers";
import { resetMockFetch } from "./client";

const server = setupServer(...[...apiHandlers]);

server.events.on("request:start", ({ request }) => {
	console.log("Outgoing:", request.method, request.url);
});

beforeAll(() => {
	server.listen({
		onUnhandledRequest: "error",
	});
});

afterAll(() => {
	server.close();
});

afterEach(() => {
	server.resetHandlers();
	resetMockFetch();
});

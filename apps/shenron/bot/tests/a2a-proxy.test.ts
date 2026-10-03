import "./setup";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { A2A_ENFORCE_ENV } from "@shenron/auth/a2a";
import { A2A_URL_ENV, a2aBaseUrl } from "../src/api/a2a-proxy";
import { a2aAgentCard, a2aEventsStream, a2aJsonRpc } from "../src/api/server";

type Hit = { method: string; path: string; accept: string | null; body: any };
const hits: Hit[] = [];
let upstream: ReturnType<typeof Bun.serve>;
const savedUrl = Bun.env[A2A_URL_ENV];
const savedEnforce = Bun.env[A2A_ENFORCE_ENV];

beforeAll(() => {
	upstream = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			const body = req.method === "POST" ? await req.json() : null;
			hits.push({ method: req.method, path: url.pathname, accept: req.headers.get("accept"), body });
			if (url.pathname === "/.well-known/agent-card.json") return Response.json({ name: "aphrody-a2a" });
			if (url.pathname === "/coord") {
				return new Response("data: {\"id\":\"e1\"}\n\n", { headers: { "content-type": "text/event-stream" } });
			}
			if (body?.method === "SendStreamingMessage") {
				return new Response("data: {\"ok\":true}\n\n", { headers: { "content-type": "text/event-stream" } });
			}
			return Response.json({ jsonrpc: "2.0", id: body?.id ?? null, result: { path: url.pathname, method: body?.method } });
		},
	});
	Bun.env[A2A_URL_ENV] = `http://127.0.0.1:${upstream.port}/`;
	delete Bun.env[A2A_ENFORCE_ENV];
});

afterEach(() => {
	hits.length = 0;
});

afterAll(() => {
	upstream.stop(true);
	if (savedUrl === undefined) delete Bun.env[A2A_URL_ENV];
	else Bun.env[A2A_URL_ENV] = savedUrl;
	if (savedEnforce === undefined) delete Bun.env[A2A_ENFORCE_ENV];
	else Bun.env[A2A_ENFORCE_ENV] = savedEnforce;
});

function rpc(method: string, params: unknown = {}): Request {
	return new Request("http://localhost/api/a2a/jsonrpc", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }),
	});
}

describe("bot A2A proxy to aphrody a2a serve", () => {
	it("base URL defaults to 127.0.0.1:8788 and trims trailing slashes", () => {
		expect(a2aBaseUrl({})).toBe("http://127.0.0.1:8788");
		expect(a2aBaseUrl({ [A2A_URL_ENV]: "http://h:1//" })).toBe("http://h:1");
	});

	it("message/send goes to POST /a2a unchanged", async () => {
		const params = { message: { parts: [{ kind: "text", text: "hi" }] } };
		const res = await a2aJsonRpc(rpc("message/send", params));
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).result).toEqual({ path: "/a2a", method: "message/send" });
		expect(hits[0]?.body.params).toEqual(params);
	});

	it("legacy tasks/* are aliased to the A2A 1.0 root", async () => {
		for (const [legacy, v1] of [
			["tasks/get", "GetTask"],
			["tasks/list", "ListTasks"],
			["tasks/cancel", "CancelTask"],
		]) {
			const res = await a2aJsonRpc(rpc(legacy!, { id: "t1" }));
			expect(((await res.json()) as any).result).toEqual({ path: "/", method: v1 });
		}
	});

	it("tasks/update returns -32601 without calling upstream", async () => {
		const body = (await (await a2aJsonRpc(rpc("tasks/update", { id: "t1" }))).json()) as any;
		expect(body.error.code).toBe(-32601);
		expect(body.error.message).toContain("tasks/update");
		expect(hits).toHaveLength(0);
	});

	it("message/stream pipes the upstream SSE stream", async () => {
		const res = await a2aJsonRpc(rpc("message/stream", { message: { parts: [] } }));
		expect(res.headers.get("content-type")).toContain("text/event-stream");
		expect(await res.text()).toContain('"ok":true');
		expect(hits[0]?.accept).toBe("text/event-stream");
	});

	it("events stream proxies GET /coord as SSE", async () => {
		const res = await a2aEventsStream(new Request("http://localhost/api/a2a/events"));
		expect(await res.text()).toContain('"e1"');
		expect(hits[0]).toMatchObject({ method: "GET", path: "/coord", accept: "text/event-stream" });
	});

	it("agent card is relayed", async () => {
		const res = await a2aAgentCard(new Request("http://localhost/.well-known/agent-card.json"));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ name: "aphrody-a2a" });
	});

	it("upstream down -> 502 a2a_upstream_unreachable", async () => {
		Bun.env[A2A_URL_ENV] = "http://127.0.0.1:1";
		try {
			for (const res of [
				await a2aJsonRpc(rpc("tasks/list")),
				await a2aAgentCard(new Request("http://localhost/.well-known/agent-card.json")),
				await a2aEventsStream(new Request("http://localhost/api/a2a/events")),
			]) {
				expect(res.status).toBe(502);
				expect(((await res.json()) as any).error).toBe("a2a_upstream_unreachable");
			}
		} finally {
			Bun.env[A2A_URL_ENV] = `http://127.0.0.1:${upstream.port}`;
		}
	});
});

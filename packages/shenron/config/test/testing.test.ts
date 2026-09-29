// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { createRecordingFetch } from "../src/testing";

describe("createRecordingFetch", () => {
	test("records method, url, headers and body, and answers from routes", async () => {
		const { fetch, calls } = createRecordingFetch({
			"POST /v1/embeddings": async (req) => Response.json({ echo: await req.json() }),
			"GET http://127.0.0.1:8794/health": () => new Response("ok"),
		});
		const posted = await fetch("http://127.0.0.1:8794/v1/embeddings?x=1", {
			method: "post",
			headers: { authorization: "Bearer t", "content-type": "application/json" },
			body: JSON.stringify({ input: ["a"] }),
		});
		expect(await posted.json()).toEqual({ echo: { input: ["a"] } });
		expect(await (await fetch(new URL("http://127.0.0.1:8794/health"))).text()).toBe("ok");

		expect(calls).toHaveLength(2);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.url).toBe("http://127.0.0.1:8794/v1/embeddings?x=1");
		expect(calls[0]?.headers.get("authorization")).toBe("Bearer t");
		expect(calls[0]?.body).toBe('{"input":["a"]}');
		expect(calls[1]).toMatchObject({
			method: "GET",
			url: "http://127.0.0.1:8794/health",
			body: null,
		});
	});

	test("unmatched routes are recorded then rejected like a network error", async () => {
		const { fetch, calls } = createRecordingFetch({});
		await expect(fetch("http://127.0.0.1/none")).rejects.toBeInstanceOf(TypeError);
		expect(calls).toHaveLength(1);
	});

	test("the catch-all route honours abort signals", async () => {
		const { fetch } = createRecordingFetch({ "*": () => new Promise<Response>(() => {}) });
		const controller = new AbortController();
		const pending = fetch("http://127.0.0.1/slow", { signal: controller.signal });
		controller.abort(new Error("stop"));
		await expect(pending).rejects.toThrow("stop");
	});
});

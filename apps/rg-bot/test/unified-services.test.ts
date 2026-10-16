import { describe, expect, test } from "bun:test";
import { app } from "../src/api/server";

describe("Unified RG Services in @rosegriffon/api", () => {
	test("GET /health -> rg-api responds healthy", async () => {
		const res = await app.handle(new Request("http://localhost/health"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
		expect(body.service).toBe("rg-api");
	});

	test("GET /storage/v1/health -> rg-storage responds healthy through rg-api", async () => {
		const res = await app.handle(new Request("http://localhost/storage/v1/health"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.service).toBe("rg-storage");
	});

	test("GET /realtime/v1/health -> rg-realtime responds healthy through rg-api", async () => {
		const res = await app.handle(new Request("http://localhost/realtime/v1/health"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.service).toBe("rg-realtime");
	});

	test("GET /cdn/health -> rg-cdn responds healthy through rg-api", async () => {
		const res = await app.handle(new Request("http://localhost/cdn/health"));
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
	});

	test("POST /upload without API key -> returns 401 unauthorized", async () => {
		const res = await app.handle(new Request("http://localhost/upload", { method: "POST" }));
		expect(res.status).toBe(401);
	});

	test("DELETE /images/invalid-id without API key -> returns 401", async () => {
		const res = await app.handle(new Request("http://localhost/images/non-existent-id", { method: "DELETE" }));
		expect(res.status).toBe(401);
	});
});

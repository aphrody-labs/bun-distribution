import "./setup";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { A2A_ENFORCE_ENV, A2A_OPEN_WARNING, A2A_TOKEN_ENV, resetA2AOpenWarning } from "@shenron/auth/a2a";
import { A2A_WRITE_METHODS, a2aWriteGuard } from "../src/api/request-guards";
import { a2aJsonRpc } from "../src/api/server";

const TOKEN = "bot-a2a-token-0123456789abcdef";

/** `message/send` without parts: passes the guard then fails validation (no `.coord` write). */
function rpc(method: string, headers: Record<string, string> = {}): Request {
	return new Request("http://localhost/api/a2a/jsonrpc", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: { message: { parts: [] } } }),
	});
}

const saved = { enforce: Bun.env[A2A_ENFORCE_ENV], token: Bun.env[A2A_TOKEN_ENV] };

function setEnv(enforce: string | undefined, token: string | undefined): void {
	if (enforce === undefined) delete Bun.env[A2A_ENFORCE_ENV];
	else Bun.env[A2A_ENFORCE_ENV] = enforce;
	if (token === undefined) delete Bun.env[A2A_TOKEN_ENV];
	else Bun.env[A2A_TOKEN_ENV] = token;
}

beforeEach(() => resetA2AOpenWarning());
afterEach(() => setEnv(saved.enforce, saved.token));

describe("S5 — bot A2A write guard", () => {
	it("guards exactly message/send and tasks/cancel", () => {
		expect([...A2A_WRITE_METHODS].toSorted()).toEqual(["message/send", "tasks/cancel"]);
	});

	it("enforce unset: response identical to today plus one warning", async () => {
		const warnings: string[] = [];
		expect(a2aWriteGuard(rpc("message/send"), {}, (m) => warnings.push(m))).toBeNull();
		expect(a2aWriteGuard(rpc("message/send"), {}, (m) => warnings.push(m))).toBeNull();
		expect(warnings).toEqual([A2A_OPEN_WARNING]);

		setEnv(undefined, undefined);
		const res = await a2aJsonRpc(rpc("message/send"));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			jsonrpc: "2.0",
			id: 1,
			error: { code: -32602, message: "params.message.parts required" },
		});
	});

	it("enforce on, token unset -> 503 a2a_not_configured", async () => {
		setEnv("1", undefined);
		const res = await a2aJsonRpc(rpc("message/send", { authorization: `Bearer ${TOKEN}` }));
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: "a2a_not_configured" });
	});

	it("enforce on -> 401 on missing or wrong Bearer", async () => {
		setEnv("true", TOKEN);
		for (const headers of [{}, { authorization: "Bearer wrong" }]) {
			const res = await a2aJsonRpc(rpc("tasks/cancel", headers));
			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({ error: "a2a_unauthorized" });
		}
		const send = await a2aJsonRpc(rpc("message/send"));
		expect(send.status).toBe(401);
	});

	it("enforce on -> right Bearer passes the guard (200)", async () => {
		setEnv("1", TOKEN);
		const res = await a2aJsonRpc(rpc("message/send", { authorization: `Bearer ${TOKEN}` }));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { error?: { code: number } };
		expect(body.error?.code).toBe(-32602);
	});
});

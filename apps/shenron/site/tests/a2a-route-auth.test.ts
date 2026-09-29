/**
 * S5 (docs/STACK.md D14) : garde d'écriture de `/api/a2a`.
 * Le hub `.coord` est simulé : aucun fichier n'est lu ni écrit.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	A2A_ENFORCE_ENV,
	A2A_OPEN_WARNING,
	A2A_TOKEN_ENV,
	resetA2AOpenWarning,
} from "@shenron/auth/a2a";

const calls: string[] = [];
mock.module("@shenron/pipeline/aphrody/a2a", () => ({
	ShenronA2AHub: {
		configure: () => {},
		getAgentCard: (origin: string) => ({ name: "Shenron", url: `${origin}/api/a2a` }),
		listEnvelopes: () => {
			calls.push("listEnvelopes");
			return [];
		},
		handleJsonRpc: async (body: { id?: unknown }) => {
			calls.push("handleJsonRpc");
			return { jsonrpc: "2.0", id: body.id ?? null, result: { ok: true } };
		},
		handleMsgEnvelope: async () => {
			calls.push("handleMsgEnvelope");
			return { kind: "ack" };
		},
	},
}));

const { GET, POST, OPTIONS } = await import("../src/app/api/a2a/route");

const TOKEN = "site-a2a-token-0123456789abcdef";
const URL_BASE = "https://dragonballfr.com/api/a2a";
const saved = { enforce: process.env[A2A_ENFORCE_ENV], token: process.env[A2A_TOKEN_ENV] };

function setEnv(enforce: string | undefined, token: string | undefined): void {
	if (enforce === undefined) delete process.env[A2A_ENFORCE_ENV];
	else process.env[A2A_ENFORCE_ENV] = enforce;
	if (token === undefined) delete process.env[A2A_TOKEN_ENV];
	else process.env[A2A_TOKEN_ENV] = token;
}

function post(headers: Record<string, string> = {}): Request {
	return new Request(URL_BASE, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "message/send", params: {} }),
	});
}

let warnings: unknown[] = [];
const originalWarn = console.warn;
beforeEach(() => {
	calls.length = 0;
	warnings = [];
	resetA2AOpenWarning();
	console.warn = (...args: unknown[]) => {
		warnings.push(...args);
	};
});
afterEach(() => {
	console.warn = originalWarn;
	setEnv(saved.enforce, saved.token);
});

describe("S5 — enforce inactif", () => {
	test("POST et boîte aux lettres inchangés, un seul avertissement", async () => {
		setEnv(undefined, undefined);
		const res = await POST(post());
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ jsonrpc: "2.0", id: 7, result: { ok: true } });
		const mailbox = await GET(new Request(`${URL_BASE}?envelopes=1`));
		expect(mailbox.status).toBe(200);
		expect(await mailbox.json()).toEqual({ envelopes: [], total: 0 });
		expect(calls).toEqual(["handleJsonRpc", "listEnvelopes"]);
		expect(warnings).toEqual([A2A_OPEN_WARNING]);
	});
});

describe("S5 — enforce actif", () => {
	test("jeton absent -> 503 a2a_not_configured", async () => {
		setEnv("1", undefined);
		const res = await POST(post({ authorization: `Bearer ${TOKEN}` }));
		expect(res.status).toBe(503);
		expect(await res.json()).toEqual({ error: "a2a_not_configured" });
		expect(calls).toEqual([]);
	});

	test("Bearer absent ou faux -> 401 (POST, envelopes=1, view=mailbox)", async () => {
		setEnv("true", TOKEN);
		const requests = [
			post(),
			post({ authorization: "Bearer wrong" }),
			new Request(`${URL_BASE}?envelopes=1`),
			new Request(`${URL_BASE}?view=mailbox`, { headers: { authorization: "Bearer wrong" } }),
		];
		for (const r of requests) {
			const res = r.method === "POST" ? await POST(r) : await GET(r);
			expect(res.status).toBe(401);
			expect(await res.json()).toEqual({ error: "a2a_unauthorized" });
		}
		expect(calls).toEqual([]);
		expect(warnings).toEqual([]);
	});

	test("bon Bearer -> 200", async () => {
		setEnv("1", TOKEN);
		const auth = { authorization: `Bearer ${TOKEN}` };
		expect((await POST(post(auth))).status).toBe(200);
		const mailbox = await GET(new Request(`${URL_BASE}?view=mailbox`, { headers: auth }));
		expect(mailbox.status).toBe(200);
		expect(calls).toEqual(["handleJsonRpc", "listEnvelopes"]);
	});

	test("AgentCard et OPTIONS restent publics", async () => {
		setEnv("1", TOKEN);
		const card = await GET(new Request(URL_BASE));
		expect(card.status).toBe(200);
		expect(await card.json()).toEqual({ name: "Shenron", url: "https://dragonballfr.com/api/a2a" });
		expect((await OPTIONS()).status).toBe(204);
		setEnv("1", undefined);
		expect((await GET(new Request(URL_BASE))).status).toBe(200);
	});
});

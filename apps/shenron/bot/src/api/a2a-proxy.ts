// SPDX-License-Identifier: Apache-2.0
/**
 * a2a-proxy.ts — the bot no longer implements A2A; it forwards to the Rust
 * server served by `aphrody a2a serve` (crates/os/a2a-coord listener +
 * crates/os/a2a-server routers). Same approach as the site's
 * `apps/shenron/site/src/lib/a2a-hub.ts` (copied, not imported across apps).
 *
 * Upstream routes used:
 * - GET  /.well-known/agent-card.json  agent card
 * - GET  /coord                        mailbox snapshot (JSONL, or SSE with `accept: text/event-stream`)
 * - POST /msg                          raw `.coord` envelope
 * - POST /a2a                          legacy JSON-RPC `message/send` bridge
 * - POST /                             A2A 1.0 JSON-RPC (SendMessage, GetTask, ListTasks, ...)
 *
 * Base URL: `APHRODY_A2A_URL`, default `http://127.0.0.1:8788`. Read per call.
 */

export const A2A_URL_ENV = "APHRODY_A2A_URL";
export const A2A_DEFAULT_URL = "http://127.0.0.1:8788";
export const LEGACY_SEND_METHOD = "message/send";

/** Legacy pre-1.0 method names still sent by older peers, renamed for the A2A 1.0 root. */
export const LEGACY_METHOD_ALIASES: Readonly<Record<string, string>> = {
	"tasks/get": "GetTask",
	"tasks/list": "ListTasks",
	"tasks/cancel": "CancelTask",
	"message/stream": "SendStreamingMessage",
	"tasks/resubscribe": "SubscribeToTask",
	"agent/getAuthenticatedExtendedCard": "GetExtendedAgentCard",
};

/** Methods answered by an SSE stream upstream. */
export const STREAMING_METHODS: ReadonlySet<string> = new Set(["message/stream", "tasks/resubscribe"]);

export function a2aBaseUrl(env: Record<string, string | undefined> = process.env): string {
	const raw = env[A2A_URL_ENV]?.trim();
	return (raw || A2A_DEFAULT_URL).replace(/\/+$/, "");
}

export interface UpstreamReply {
	status: number;
	body: unknown;
}

async function readBody(res: Response): Promise<unknown> {
	const text = await res.text();
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return { error: "upstream_non_json", status: res.status, body: text.slice(0, 2000) };
	}
}

export function unreachable(err: unknown): UpstreamReply {
	return {
		status: 502,
		body: { error: "a2a_upstream_unreachable", message: err instanceof Error ? err.message : String(err) },
	};
}

async function call(path: string, init?: RequestInit): Promise<UpstreamReply> {
	try {
		const res = await fetch(`${a2aBaseUrl()}${path}`, init);
		return { status: res.status, body: await readBody(res) };
	} catch (err) {
		return unreachable(err);
	}
}

function postJson(path: string, body: unknown): Promise<UpstreamReply> {
	return call(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

/** Agent card of the upstream server. */
export function fetchAgentCard(): Promise<UpstreamReply> {
	return call("/.well-known/agent-card.json");
}

/** Last `limit` mailbox envelopes from the upstream JSONL snapshot. */
export async function fetchEnvelopes(limit = 100): Promise<UpstreamReply> {
	try {
		const res = await fetch(`${a2aBaseUrl()}/coord`, { headers: { accept: "application/x-ndjson" } });
		if (!res.ok) return { status: res.status, body: await readBody(res) };
		const envelopes: unknown[] = [];
		for (const line of (await res.text()).split("\n")) {
			if (!line.trim()) continue;
			try {
				envelopes.push(JSON.parse(line));
			} catch {
				/* skip malformed line */
			}
		}
		return { status: 200, body: envelopes.slice(-limit) };
	} catch (err) {
		return unreachable(err);
	}
}

/** Raw `.coord` envelope → upstream `/msg`. */
export function postEnvelope(envelope: unknown): Promise<UpstreamReply> {
	return postJson("/msg", envelope);
}

function upstreamMethod(body: unknown): { method: unknown; payload: unknown } {
	const method = body && typeof body === "object" ? (body as { method?: unknown }).method : undefined;
	const alias = typeof method === "string" ? LEGACY_METHOD_ALIASES[method] : undefined;
	return { method, payload: alias ? { ...(body as object), method: alias } : body };
}

/** JSON-RPC: legacy `message/send` → `/a2a`, every other method → A2A 1.0 root (aliased). */
export function postJsonRpc(body: unknown): Promise<UpstreamReply> {
	const { method, payload } = upstreamMethod(body);
	if (method === LEGACY_SEND_METHOD) return postJson("/a2a", body);
	return postJson("/", payload);
}

/**
 * Streaming JSON-RPC (message/stream, tasks/resubscribe) → root with
 * `accept: text/event-stream`; returns the raw upstream Response so the SSE
 * body can be piped, or an UpstreamReply when upstream is unreachable.
 */
export async function postJsonRpcStream(body: unknown): Promise<Response | UpstreamReply> {
	const { payload } = upstreamMethod(body);
	try {
		return await fetch(`${a2aBaseUrl()}/`, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "text/event-stream" },
			body: JSON.stringify(payload),
		});
	} catch (err) {
		return unreachable(err);
	}
}

/** Mailbox as SSE (`GET /coord` with `accept: text/event-stream`). */
export async function fetchCoordStream(): Promise<Response | UpstreamReply> {
	try {
		return await fetch(`${a2aBaseUrl()}/coord`, { headers: { accept: "text/event-stream" } });
	} catch (err) {
		return unreachable(err);
	}
}

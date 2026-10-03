// SPDX-License-Identifier: Apache-2.0
/**
 * a2a-hub.ts — client of the Rust A2A server served by `aphrody a2a serve`
 * (crates/os/a2a-coord listener + crates/os/a2a-server routers).
 *
 * Upstream routes used:
 * - GET  /.well-known/agent-card.json  agent card
 * - GET  /coord                        mailbox snapshot (JSONL)
 * - POST /msg                          raw `.coord` envelope
 * - POST /a2a                          legacy JSON-RPC `message/send` bridge
 * - POST /                             A2A 1.0 JSON-RPC (SendMessage, GetTask, ListTasks, ...)
 *
 * Base URL: `APHRODY_A2A_URL`, default `http://127.0.0.1:8788` (the `serve --bind`
 * default). Read per call, never at module load.
 */

import { ShenronA2AHub, type AdminNotifier } from "@shenron/pipeline/aphrody/a2a";

export const A2A_URL_ENV = "APHRODY_A2A_URL";
export const A2A_DEFAULT_URL = "http://127.0.0.1:8788";
export const LEGACY_SEND_METHOD = "message/send";

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

function unreachable(err: unknown): UpstreamReply {
	return {
		status: 502,
		body: { error: "a2a_upstream_unreachable", message: err instanceof Error ? err.message : String(err) },
	};
}

async function call(path: string, init?: RequestInit): Promise<UpstreamReply> {
	try {
		const res = await fetch(`${a2aBaseUrl()}${path}`, { cache: "no-store", ...init });
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
		const res = await fetch(`${a2aBaseUrl()}/coord`, {
			cache: "no-store",
			headers: { accept: "application/x-ndjson" },
		});
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

/** JSON-RPC: legacy `message/send` → `/a2a`, every other method → A2A 1.0 root. */
/** Legacy pre-1.0 method names still sent by older peers, renamed for the A2A 1.0 root. */
export const LEGACY_METHOD_ALIASES: Readonly<Record<string, string>> = {
	"tasks/get": "GetTask",
	"tasks/list": "ListTasks",
	"tasks/cancel": "CancelTask",
};

export function postJsonRpc(body: unknown): Promise<UpstreamReply> {
	const method = body && typeof body === "object" ? (body as { method?: unknown }).method : undefined;
	if (method === LEGACY_SEND_METHOD) return postJson("/a2a", body);
	const alias = typeof method === "string" ? LEGACY_METHOD_ALIASES[method] : undefined;
	return postJson("/", alias ? { ...(body as object), method: alias } : body);
}

// ---------------------------------------------------------------------------
// In-process hub, still read by `api/admin/dashboard-live` (envelopes/tasks
// from `.coord`). The public `/api/a2a` route no longer uses it.
// ---------------------------------------------------------------------------

let configured = false;

const siteAdminNotifier: AdminNotifier = async (message) => {
	const { sendAdminLabMessage } = await import("@/lib/admin-lab");
	return sendAdminLabMessage(message);
};

/** Returns the in-process hub, configured once per process with the site admin notifier. */
export function getA2AHub(): typeof ShenronA2AHub {
	if (!configured) {
		ShenronA2AHub.configure({ notifier: siteAdminNotifier });
		configured = true;
	}
	return ShenronA2AHub;
}

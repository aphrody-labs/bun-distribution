#!/usr/bin/env bun
/**
 * Bridge A2A Unix socket — variante low-latency du endpoint HTTP /api/a2a/*
 * pour les agents tournant sur le même host. Sert exactement le même payload
 * JSON-RPC 2.0 mais via Unix domain socket → 0 hop réseau, <0.5ms RTT typique.
 *
 * Lancement :
 *   bun scripts/a2a-broker.ts &
 *
 * Test côté client :
 *   curl --unix-socket /tmp/dbfr-a2a.sock http://localhost/.well-known/agent-card.json
 *   curl --unix-socket /tmp/dbfr-a2a.sock -X POST http://localhost/jsonrpc \
 *     -H 'Content-Type: application/json' \
 *     -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"messageId":"x","role":"user","kind":"message","parts":[{"kind":"text","text":"ping"}]}}}'
 *
 * Le socket file est créé en mode 0666 pour que les 2 agents y accèdent.
 */
import {
	existsSync,
	unlinkSync,
	chmodSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	appendFileSync,
} from "node:fs";
import { dirname } from "node:path";

export const SOCKET = Bun.env.A2A_SOCKET ?? "/tmp/dbfr-a2a.sock";
export const COORD_DIR =
	Bun.env.COORD_DIR ?? `${process.cwd().replace(/\/apps\/bot\/?$/, "")}/.coord`;
export const MESSAGES = `${COORD_DIR}/messages.jsonl`;
export const TASKS = `${COORD_DIR}/tasks.json`;
export const LOCK = "/tmp/dbfr-tasks.lock";

/**
 * Assure que le répertoire de coordination existe sur disque.
 */
export function ensureCoordDir(dir: string = COORD_DIR): void {
	try {
		mkdirSync(dir, { recursive: true });
	} catch (e) {
		console.error(`[a2a-broker] mkdir failed on ${dir}:`, e);
	}
}

/**
 * Initialise le fichier de tâches s'il n'existe pas ou s'il est vide.
 */
export function initTasksFile(tasksPath: string = TASKS, force: boolean = false): void {
	try {
		const dir = dirname(tasksPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		if (force || !existsSync(tasksPath)) {
			writeFileSync(tasksPath, JSON.stringify({ tasks: [] }, null, 2) + "\n", "utf-8");
			return;
		}
		const content = readFileSync(tasksPath, "utf-8").trim();
		if (!content) {
			writeFileSync(tasksPath, JSON.stringify({ tasks: [] }, null, 2) + "\n", "utf-8");
		}
	} catch (e) {
		console.error(`[a2a-broker] initTasksFile failed on ${tasksPath}:`, e);
	}
}

// Initialisation au démarrage
ensureCoordDir(COORD_DIR);
initTasksFile(TASKS);

const subs = new Set<(e: unknown) => void>();
export const broadcast = (e: unknown) => {
	for (const sub of subs) {
		try {
			sub(e);
		} catch {
			/* sub closed mid-iteration */
		}
	}
};

export function appendMessage(msg: Record<string, unknown>, messagesPath: string = MESSAGES): void {
	const dir = dirname(messagesPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	// appendFile uses the OS append flag; no shell interpolation or Unix utility dependency.
	appendFileSync(messagesPath, JSON.stringify(msg) + "\n", "utf-8");
}

export function readTasks(tasksPath: string = TASKS): { tasks: any[] } {
	try {
		const dir = dirname(tasksPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		if (!existsSync(tasksPath)) {
			initTasksFile(tasksPath);
			return { tasks: [] };
		}
		const out = readFileSync(tasksPath, "utf-8").trim();
		if (!out) {
			initTasksFile(tasksPath);
			return { tasks: [] };
		}
		const parsed = JSON.parse(out);
		if (!parsed || !Array.isArray(parsed.tasks)) {
			initTasksFile(tasksPath, true);
			return { tasks: [] };
		}
		return parsed as { tasks: any[] };
	} catch (e) {
		console.error(`[a2a-broker] readTasks error on ${tasksPath}:`, e);
		try {
			initTasksFile(tasksPath, true);
		} catch {
			/* ignore */
		}
		return { tasks: [] };
	}
}

export function rpcError(id: unknown, code: number, message: string) {
	return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

export function sseStream(): ReadableStream {
	let cleanup: (() => void) | null = null;
	return new ReadableStream({
		start(controller) {
			const enc = new TextEncoder();
			const sub = (e: unknown) => {
				try {
					controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
				} catch {
					cleanup?.();
				}
			};
			subs.add(sub);
			const ping = setInterval(() => {
				try {
					controller.enqueue(enc.encode(`: ping\n\n`));
				} catch {
					cleanup?.();
				}
			}, 30_000);
			cleanup = () => {
				subs.delete(sub);
				clearInterval(ping);
			};
			controller.enqueue(
				enc.encode(`data: ${JSON.stringify({ kind: "ready", ts: new Date().toISOString() })}\n\n`)
			);
		},
		cancel() {
			cleanup?.();
		},
	});
}

export function createBrokerServer(
	socketPath: string = SOCKET,
	tasksPath: string = TASKS,
	messagesPath: string = MESSAGES
) {
	if (existsSync(socketPath)) unlinkSync(socketPath);

	const server = Bun.serve({
		unix: socketPath,
		async fetch(req: Request) {
			const url = new URL(req.url);

			if (url.pathname === "/.well-known/agent-card.json") {
				return Response.json({
					name: "shenron-coord-unix",
					description: "Bridge A2A via Unix socket (low-latency)",
					version: "1.0.0",
					protocolVersion: "0.3.0",
					url: `unix://${socketPath}/jsonrpc`,
					capabilities: { streaming: true, pushNotifications: false },
					defaultInputModes: ["text"],
					defaultOutputModes: ["text"],
				});
			}

			if (url.pathname === "/events") {
				return new Response(sseStream(), {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
					},
				});
			}

			if (url.pathname !== "/jsonrpc" || req.method !== "POST") {
				return new Response("Not Found", { status: 404 });
			}

			let body: any;
			try {
				body = await req.json();
			} catch {
				return rpcError(null, -32700, "Parse error");
			}
			const { id = null, method, params } = body ?? {};

			try {
				switch (method) {
					case "message/send": {
						const incoming = params?.message;
						if (!incoming?.parts?.length) return rpcError(id, -32602, "parts required");
						const text = incoming.parts
							.filter((p: any) => p.kind === "text")
							.map((p: any) => p.text)
							.join("\n");
						const msg = {
							id: incoming.messageId ?? crypto.randomUUID(),
							from: incoming.role === "agent" ? "agent" : "user",
							to: params.to ?? "all",
							type: "request",
							contextId: incoming.contextId ?? null,
							content: text,
							ts: new Date().toISOString(),
						};
						appendMessage(msg, messagesPath);
						broadcast({ kind: "message", message: msg });
						return Response.json({
							jsonrpc: "2.0",
							id,
							result: {
								kind: "message",
								messageId: msg.id,
								role: "agent",
								parts: [{ kind: "text", text: "ack" }],
								contextId: msg.contextId,
							},
						});
					}
					case "message/stream":
						return new Response(sseStream(), {
							headers: {
								"Content-Type": "text/event-stream",
								"Cache-Control": "no-cache",
							},
						});
					case "tasks/list": {
						const { tasks } = readTasks(tasksPath);
						const filtered = tasks.filter((t: any) => {
							if (params?.status && t.status !== params.status) return false;
							if (params?.agent && t.agent !== params.agent) return false;
							return true;
						});
						return Response.json({
							jsonrpc: "2.0",
							id,
							result: { tasks: filtered },
						});
					}
					case "tasks/get": {
						const { tasks } = readTasks(tasksPath);
						return Response.json({
							jsonrpc: "2.0",
							id,
							result: tasks.find((t: any) => t.id === params?.id) ?? null,
						});
					}
					case "ping":
						return Response.json({ jsonrpc: "2.0", id, result: { pong: true } });
					default:
						return rpcError(id, -32601, `Method not found: ${method}`);
				}
			} catch (e: any) {
				return rpcError(id, -32000, e?.message ?? "Internal error");
			}
		},
	});

	// Permissions socket 0666 — les 2 agents (Claude + Gemini) doivent pouvoir l'ouvrir
	try {
		chmodSync(socketPath, 0o666);
	} catch (e) {
		console.error("chmod socket failed:", e);
	}

	console.error(`[a2a-broker] listening on unix:${socketPath}`);
	return server;
}

if (import.meta.main) {
	createBrokerServer(SOCKET, TASKS, MESSAGES);
	// Boucle de keep-alive : sinon Bun ferme le process quand le main termine
	await new Promise(() => {});
}

import { NextRequest, NextResponse } from "next/server";
import net from "node:net";
import { sql } from "drizzle-orm";
import { getA2AHub } from "@/lib/a2a-hub";
import { API_URL } from "@/lib/config";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isAdminOrToken } from "@/lib/admin-guard";
import { resolveRedisUrl } from "@shenron/config/services";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServiceState = "ok" | "degraded" | "down" | "unknown";

type ServiceProbe = {
	id: "api" | "database" | "redis" | "backOffice";
	label: string;
	state: ServiceState;
	latencyMs: number | null;
	detail: string;
};

type LivePayload = {
	services: ServiceProbe[];
	agents: {
		activePeers: string[];
		recentActivity: number;
		activeTasks: number;
		latestActivityAt: string | null;
	};
	sampledAt: string;
	refreshAfterMs: number;
};

// Cache in-memory avec TTL pour éviter de refaire 4 sondes lourdes (HTTP, DB, TCP)
// à chaque appel si plusieurs requêtes rapprochées ou concurrentes arrivent.
let cachedPayload: { data: LivePayload; expiresAt: number } | null = null;
const CACHE_TTL_MS = 6_000;

const timeout = async <T>(work: Promise<T>, milliseconds = 1_500): Promise<T> =>
	await Promise.race([
		work,
		new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Délai de réponse dépassé")), milliseconds)),
	]);

async function probeHttp(
	id: ServiceProbe["id"],
	label: string,
	url: string,
	headers?: HeadersInit,
	timeoutMs = 1_500
): Promise<ServiceProbe> {
	const started = performance.now();
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const response = await fetch(url, { cache: "no-store", headers, signal: controller.signal })
			.finally(() => clearTimeout(timer));
		const latencyMs = Math.round(performance.now() - started);
		return {
			id,
			label,
			state: response.ok ? "ok" : "degraded",
			latencyMs,
			detail: response.ok ? "Réponse reçue" : `HTTP ${response.status}`,
		};
	} catch (error) {
		return {
			id,
			label,
			state: "down",
			latencyMs: Math.round(performance.now() - started),
			detail: error instanceof Error ? error.message : "Sonde indisponible",
		};
	}
}

async function probeDatabase(): Promise<ServiceProbe> {
	const started = performance.now();
	try {
		await timeout(db.execute(sql`select 1`), 1_500);
		return { id: "database", label: "PostgreSQL", state: "ok", latencyMs: Math.round(performance.now() - started), detail: "Requête de contrôle réussie" };
	} catch (error) {
		return { id: "database", label: "PostgreSQL", state: "down", latencyMs: Math.round(performance.now() - started), detail: error instanceof Error ? error.message : "Connexion indisponible" };
	}
}

function parseRedisHostPort(): { host: string; port: number } {
	const raw = resolveRedisUrl(process.env);
	try {
		const u = new URL(raw);
		return {
			host: u.hostname || "127.0.0.1",
			port: u.port ? Number(u.port) : 6379,
		};
	} catch {
		return { host: "127.0.0.1", port: 6379 };
	}
}

async function probeRedis(): Promise<ServiceProbe> {
	const started = performance.now();
	// 1. Test TCP net rapide sans importer bun dynamiquement en runtime nodejs
	try {
		const { host, port } = parseRedisHostPort();
		await new Promise<void>((resolve, reject) => {
			const socket = net.connect({ host, port });
			socket.setTimeout(1_000);
			socket.on("connect", () => {
				socket.end();
				resolve();
			});
			socket.on("timeout", () => {
				socket.destroy();
				reject(new Error("Timeout connexion Redis (1000ms)"));
			});
			socket.on("error", (err) => {
				socket.destroy();
				reject(err);
			});
		});
		return {
			id: "redis",
			label: "Redis",
			state: "ok",
			latencyMs: Math.round(performance.now() - started),
			detail: "Port TCP accessible",
		};
	} catch (error) {
		// 2. Repli si Bun.RedisClient est disponible ou mocké (ex: tests unitaires bun test)
		try {
			const bun = (await import("bun")) as unknown as {
				RedisClient?: new (url: string, options?: Record<string, unknown>) => { send(command: string, args: string[]): Promise<unknown> };
			};
			if (bun?.RedisClient) {
				const client = new bun.RedisClient(resolveRedisUrl(process.env), { enableOfflineQueue: false, maxRetries: 0 });
				await timeout(client.send("PING", []), 1_000);
				return {
					id: "redis",
					label: "Redis",
					state: "ok",
					latencyMs: Math.round(performance.now() - started),
					detail: "PING reçu",
				};
			}
		} catch {
			// Ignorer l'erreur du repli
		}

		return {
			id: "redis",
			label: "Redis",
			state: "down",
			latencyMs: Math.round(performance.now() - started),
			detail: error instanceof Error ? error.message : "Connexion indisponible",
		};
	}
}

export async function GET(req: NextRequest) {
	if (!(await isAdminOrToken(req))) {
		return NextResponse.json({ error: "Accès réservé aux administrateurs." }, { status: 403 });
	}

	const now = Date.now();
	if (cachedPayload && now < cachedPayload.expiresAt) {
		return NextResponse.json(cachedPayload.data, {
			headers: { "cache-control": "private, no-store, max-age=0" },
		});
	}

	const token = env.SHENRON_ADMIN_TOKEN;
	const [api, database, redis, backOffice] = await Promise.all([
		probeHttp("api", "API bot", `${API_URL}/health`),
		probeDatabase(),
		probeRedis(),
		token
			? probeHttp("backOffice", "Back-office bot", `${API_URL}/api/health/monitoring`, { authorization: `Bearer ${token}` })
			: Promise.resolve<ServiceProbe>({ id: "backOffice", label: "Back-office bot", state: "unknown", latencyMs: null, detail: "Jeton d’administration non configuré" }),
	]);

	const envelopes = getA2AHub().listEnvelopes(100);
	const recentEnvelopes = envelopes.filter((envelope) => {
		const timestamp = Date.parse(envelope.ts);
		return Number.isFinite(timestamp) && now - timestamp <= 5 * 60_000;
	});
	const peers = [...new Set(recentEnvelopes.flatMap((envelope) => [envelope.from, envelope.to]).filter((peer) => peer && peer !== "broadcast" && peer !== "shenron-dragonball"))];
	const tasks = await getA2AHub().listTasks().catch(() => []);
	const activeTasks = tasks.filter((task) => task.status === "submitted" || task.status === "working");

	const payload: LivePayload = {
		services: [api, database, redis, backOffice],
		agents: {
			activePeers: peers,
			recentActivity: recentEnvelopes.length,
			activeTasks: activeTasks.length,
			latestActivityAt: recentEnvelopes[0]?.ts ?? null,
		},
		sampledAt: new Date().toISOString(),
		refreshAfterMs: 10_000,
	};

	cachedPayload = {
		data: payload,
		expiresAt: now + CACHE_TTL_MS,
	};

	return NextResponse.json(payload, {
		headers: { "cache-control": "private, no-store, max-age=0" },
	});
}

/**
 * Client admin pour les routes API privées du bot Shenron.
 * Utilise SHENRON_ADMIN_TOKEN côté server uniquement (jamais exposé client).
 *
 * Les Server Components / Route Handlers consomment directement `botRequest(path)`.
 * Pour le browser, passer par le proxy `/api/bot-admin/[...path]` (forwarde + auth).
 *
 * B11 (docs/STACK.md §2.2) : `stats`, `services`, `tables`, `table`, `wikiStats`
 * et `economyStats` passent par le client typé `@shenron/api/client` et sont
 * VALIDÉS par les schémas du contrat (forme réelle du bot). Une réponse non
 * conforme lève `BotAdminError` au lieu d'être castée silencieusement.
 * Les autres alias restent des lectures JSON non validées (`botRequest`),
 * migrées au fil de SH-API-4.
 */
import "server-only";
import { createShenronApiClient, type ApiResult } from "@shenron/api/client";
import { API_URL as API, botApiBaseUrl } from "@/lib/config";

const TOKEN = process.env.SHENRON_ADMIN_TOKEN ?? "";

/** Base serveur du bot (`BOT_INTERNAL_URL` d'abord, cf. `botApiBaseUrl`). */
const BOT_BASE = botApiBaseUrl();

export class BotAdminError extends Error {
	constructor(
		public status: number,
		public path: string,
		body?: string
	) {
		super(`bot-admin ${path} → ${status}${body ? `: ${body}` : ""}`);
	}
}

type BotRequestInit = RequestInit & { revalidate?: number; tags?: string[] };

/** Lecture JSON NON validée (le paramètre de type n'est qu'une assertion). */
async function botRequest<T = unknown>(path: string, init?: BotRequestInit): Promise<T> {
	const res = await fetch(`${BOT_BASE}${path}`, {
		...init,
		headers: {
			accept: "application/json",
			authorization: `Bearer ${TOKEN}`,
			...(init?.body ? { "content-type": "application/json" } : {}),
			...init?.headers,
		},
		next: {
			revalidate: init?.revalidate ?? 30,
			tags: init?.tags,
		},
	});
	if (!res.ok) {
		throw new BotAdminError(res.status, path, await res.text().catch(() => undefined));
	}
	return res.json() as Promise<T>;
}

/**
 * Client du contrat pour une durée de revalidation Next donnée. `fetchImpl`
 * est injectable (tests de dérive) ; par défaut, le `fetch` global du
 * process (patché par Next pour `next.revalidate`).
 */
export function createBotAdminContractClient(o: {
	revalidate: number;
	baseUrl?: string;
	token?: string;
	fetchImpl?: typeof fetch;
}) {
	const token = o.token ?? TOKEN;
	const withRevalidate = ((input: RequestInfo | URL, init?: RequestInit) =>
		(o.fetchImpl ?? globalThis.fetch)(input, {
			...init,
			next: { revalidate: o.revalidate },
		} as RequestInit)) as typeof fetch;
	return createShenronApiClient({
		baseUrl: o.baseUrl ?? BOT_BASE,
		fetch: withRevalidate,
		adminToken: () => token || null,
	});
}

/** Valeur validée, ou `BotAdminError` (statut HTTP, 502 si injoignable/non conforme). */
export function unwrapBotResult<T>(result: ApiResult<T>): T {
	if (result.ok) return result.value;
	if (result.kind === "http") throw new BotAdminError(result.status, result.path, result.detail);
	throw new BotAdminError(502, result.path, `${result.kind}: ${result.detail}`);
}

const contract = (revalidate: number) => createBotAdminContractClient({ revalidate });

export const botAdmin = {
	fetch: botRequest,

	// Aliases typés pour les endpoints les plus utilisés
	bots: () =>
		botRequest<{
			bots: Array<{
				id: string;
				name: string;
				username: string;
				avatar: string;
				online: boolean;
				uptime: number;
				wsPing: number;
				intents: number;
				guildCount: number;
				commandCount: number;
			}>;
		}>("/api/bots", { revalidate: 10 }),
	bot: (id: string) =>
		botRequest<{
			id: string;
			name: string;
			username: string;
			avatar: string;
			online: boolean;
			uptime: number;
			wsPing: number;
			guildCount: number;
			commandCount: number;
			commands: unknown[];
		}>(`/api/bots/${id}`, { revalidate: 10 }),
	commands: (botId: string) =>
		botRequest<{
			commands: Array<{
				name: string;
				description: string;
				type: number;
				options?: unknown[];
			}>;
		}>(`/api/bots/${botId}/commands`, { revalidate: 60 }),
	expanded: (botId: string) =>
		botRequest<unknown>(`/api/bots/${botId}/expanded`, { revalidate: 60 }),
	roles: (botId: string) =>
		botRequest<{
			roles: Array<{
				id: string;
				name: string;
				color: number;
				hexColor: string;
				position: number;
				managed: boolean;
			}>;
		}>(`/api/bots/${botId}/guild/roles`, { revalidate: 60 }),

	cron: () =>
		botRequest<{
			jobs: Array<{
				name: string;
				intervalMs: number;
				lastRunAt: number | null;
				lastDurationMs: number | null;
				runCount: number;
				lastError: string | null;
				nextRunAt: number | null;
			}>;
		}>("/api/cron", { revalidate: 5 }),
	cronTrigger: (name: string) =>
		botRequest(`/api/cron/${encodeURIComponent(name)}/trigger`, {
			method: "POST",
			body: "{}",
		}),

	/** `{ actions: [{ service, action, description }] }` (contrat `BotServices`). */
	services: async () => unwrapBotResult(await contract(60).admin.services()),
	serviceCall: (service: string, action: string, body?: unknown) =>
		botRequest(`/api/services/${service}/${action}`, {
			method: "POST",
			body: JSON.stringify(body ?? {}),
		}),

	/** `{ tables: [{ name, pk, readonly, mutableColumns, description }] }` (contrat `BotTables`). */
	tables: async () => unwrapBotResult(await contract(300).admin.tables()),
	/** `{ rows, total, limit, offset }` (contrat `BotTableRows`). */
	table: async (table: string, limit = 100, offset = 0) =>
		unwrapBotResult(await contract(10).admin.table(table, { limit, offset })),

	health: () =>
		botRequest<{ online: boolean; uptime: number; version: string }>("/api/health/check", {
			revalidate: 5,
		}),
	healthUsage: () => botRequest<unknown>("/api/health/usage", { revalidate: 10 }),
	healthHost: () => botRequest<unknown>("/api/health/host", { revalidate: 30 }),
	healthLogs: (lines = 100) =>
		botRequest<{
			logs: Array<{
				time?: string;
				host?: string;
				unit?: string;
				message?: string;
				raw?: string;
			}>;
			count: number;
		}>(`/api/health/logs?lines=${lines}`, { revalidate: 5 }),

	/** `{ stats: { totalUsers, totalGuilds, totalActiveUsers, totalCommands } }` (contrat `BotAdminStats`). */
	stats: async () => unwrapBotResult(await contract(30).admin.stats()),

	auditLogs: (limit = 50, offset = 0) =>
		botRequest<{ logs: unknown[]; total?: number }>(
			`/api/audit/logs?limit=${limit}&offset=${offset}`,
			{ revalidate: 10 }
		),
	auditDiscord: (limit = 50, actionType?: string) =>
		botRequest<{ audit_logs?: unknown[]; entries?: unknown[] }>(
			`/api/discord/audit-logs?limit=${limit}${actionType ? `&action_type=${actionType}` : ""}`,
			{ revalidate: 30 }
		),

	/** `{ zeni: { total, avg, max, users, rich, zero }, fusions, … }` (contrat `BotEconomyStats`). */
	economyStats: async () => unwrapBotResult(await contract(30).admin.economyStats()),
	economyLeaderboard: (limit = 50) =>
		botRequest<{ leaderboard: unknown[] }>(`/api/economy/leaderboard?limit=${limit}`, {
			revalidate: 30,
		}),
	economyTransactions: (limit = 50) =>
		botRequest<{ transactions: unknown[] }>(`/api/economy/transactions?limit=${limit}`, {
			revalidate: 30,
		}),
	economyGive: (userId: string, amount: number, reason?: string) =>
		botRequest("/api/economy/give", {
			method: "POST",
			body: JSON.stringify({ userId, amount, reason }),
		}),

	discord: {
		channels: () =>
			botRequest<{
				channels: Array<{ id: string; name: string; type: number }>;
			}>("/api/discord/channels", { revalidate: 300 }),
		roles: () =>
			botRequest<{ roles: unknown[] }>("/api/discord/roles", {
				revalidate: 300,
			}),
		members: () =>
			botRequest<{ members: unknown[] }>("/api/discord/members", {
				revalidate: 60,
			}),
		guild: () => botRequest<unknown>("/api/discord/guild", { revalidate: 60 }),
	},

	canvas: {
		profileUrl: (userId: string, theme?: string) =>
			`${API}/api/canvas/profile/${userId}${theme ? `?theme=${encodeURIComponent(theme)}` : ""}`,
		leaderboardUrl: () => `${API}/api/canvas/leaderboard`,
		scoutUrl: (userId: string) => `${API}/api/canvas/scouter/${userId}`,
		list: () =>
			botRequest<{
				canvases: Array<{ name: string; description: string; path: string }>;
			}>("/api/canvas/list", { revalidate: 300 }),
		themes: () =>
			botRequest<{
				rows: Array<{
					id: string;
					name: string;
					accent: string;
					aura: string;
					bgGrad1: string;
					bgGrad2: string;
					bgGrad3: string;
					bgFile: string | null;
					textShadow: string;
					enabled: boolean;
				}>;
			}>("/api/card-themes", { revalidate: 30 }),
		themeCreate: (body: {
			id: string;
			name: string;
			accent: string;
			aura: string;
			bgGrad1: string;
			bgGrad2: string;
			bgGrad3: string;
			bgFile?: string | null;
			textShadow: string;
			enabled?: boolean;
		}) =>
			botRequest("/api/card-themes", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		themeUpdate: (id: string, patch: Record<string, unknown>) =>
			botRequest(`/api/card-themes/${encodeURIComponent(id)}`, {
				method: "PUT",
				body: JSON.stringify(patch),
			}),
		themeRemove: (id: string) =>
			botRequest(`/api/card-themes/${encodeURIComponent(id)}`, {
				method: "DELETE",
			}),
	},

	giveaways: () =>
		botRequest<{
			giveaways: Array<{
				id: number;
				messageId: string;
				channelId: string;
				hostId: string;
				title: string;
				reward: string;
				description: string | null;
				winners: number;
				endsAt: number;
				ended: boolean;
				winnerIds: string | null;
			}>;
		}>("/api/giveaways", { revalidate: 30 }),
	giveawayEnd: (id: number) =>
		botRequest(`/api/giveaways/${id}/end`, { method: "POST", body: "{}" }),

	levels: {
		config: () => botRequest<unknown>("/api/levels/config", { revalidate: 60 }),
		distribution: () =>
			botRequest<{ distribution: Array<{ level: number; count: number }> }>(
				"/api/levels/distribution",
				{ revalidate: 60 }
			),
		rewards: () =>
			botRequest<{
				rewards: Array<{
					level: number;
					roleId: string;
					zeniBonus: number;
					xpThreshold: number;
					bannerUrl: string | null;
				}>;
			}>("/api/levels/rewards", { revalidate: 60 }),
		top: (limit = 50) =>
			botRequest<{ top: unknown[] }>(`/api/levels/top?limit=${limit}`, {
				revalidate: 30,
			}),
	},

	messages: () =>
		botRequest<{
			events: Array<{
				event: string;
				enabled: boolean;
				channelId: string | null;
				template?: string | null;
				channelKey?: string | null;
				embed?: unknown;
			}>;
		}>("/api/messages", { revalidate: 60 }),
	messagesUpsert: (
		event: string,
		body: {
			template?: string | null;
			channelKey?: string | null;
			enabled?: boolean;
		}
	) =>
		botRequest(`/api/messages/${encodeURIComponent(event)}`, {
			method: "POST",
			body: JSON.stringify(body),
		}),
	messagesRemove: (event: string) =>
		botRequest(`/api/messages/${encodeURIComponent(event)}`, {
			method: "DELETE",
		}),
	messagesPreview: (event: string, params?: Record<string, unknown>) =>
		botRequest<{
			rendered?: string;
			preview?: string;
			[k: string]: unknown;
		}>(`/api/messages/${encodeURIComponent(event)}/preview`, {
			method: "POST",
			body: JSON.stringify(params ?? {}),
		}),

	// NB : pas de client `commandPerms` ici. Il en a existé un, typé
	// `{ rows: [{ command, scope, allow }] }` — une forme que l'API n'a jamais
	// renvoyée (elle répond `{ rules: [{ name, enabled, allowedRoles, deniedRoles,
	// deniedUsers }] }`). Le paramètre de type de `fetch()` n'est qu'une assertion :
	// il a fait passer la fiction au type-check, et la page ne cassait qu'à
	// l'exécution. Les permissions se pilotent depuis `/admin/commands`, côté
	// client, via le proxy `/api/bot-admin` — un seul appelant, une seule forme.

	economyGiveBulk: (body: {
		mode: "user" | "role" | "all";
		userId?: string;
		roleId?: string;
		amount: number;
		reason?: string;
	}) =>
		botRequest<{ ok: boolean; applied?: number; amount?: number }>("/api/economy/give", {
			method: "POST",
			body: JSON.stringify(body),
		}),

	levelsTop: (metric: "xp" | "zeni" | "voice" | "streak" | "messages" = "xp", limit = 50) =>
		botRequest<{
			top: Array<{
				rank: number;
				discordId: string;
				username?: string;
				avatarUrl?: string;
				value: number;
				level?: number;
			}>;
		}>(`/api/levels/top?metric=${metric}&limit=${limit}`, { revalidate: 30 }),

	moderation: {
		hierarchy: () =>
			botRequest<{
				tiers: Array<{ name: string; roleIds: string[]; level: number }>;
			}>("/api/moderation/hierarchy", { revalidate: 60 }),
		recent: () =>
			botRequest<{ actions: unknown[] }>("/api/moderation/recent", {
				revalidate: 10,
			}),
		stats: () =>
			botRequest<{
				warns: number;
				jails: number;
				bans: number;
				kicks: number;
				mutes: number;
			}>("/api/moderation/stats", { revalidate: 30 }),
		warns: () =>
			botRequest<{
				warns: Array<{
					id: number;
					userId: string;
					moderatorId: string;
					reason: string | null;
					active: boolean;
					createdAt: number;
				}>;
			}>("/api/moderation/warns", { revalidate: 10 }),
		jails: () =>
			botRequest<{
				jails: Array<{
					id: number;
					userId: string;
					moderatorId: string;
					reason: string | null;
					expiresAt: number | null;
					releasedAt: number | null;
					createdAt: number;
				}>;
			}>("/api/moderation/jails", { revalidate: 10 }),
	},

	settings: () =>
		botRequest<{
			keys: Array<{
				key: string;
				type: string;
				default: unknown;
				current: unknown;
				description: string | null;
			}>;
		}>("/api/settings/schema", { revalidate: 60 }),

	tickets: () =>
		botRequest<{
			tickets: Array<{
				id: number;
				channelId: string;
				ownerId: string;
				kind: string;
				context: string | null;
				closed: boolean;
				closedAt: number | null;
				createdAt: number;
			}>;
		}>("/api/tickets", { revalidate: 30 }),

	webhooks: () =>
		botRequest<{
			webhooks: Array<{
				id: string;
				name: string;
				channelId: string;
				url?: string;
				type: number;
			}>;
		}>("/api/webhooks", { revalidate: 60 }),

	/** `{ counts: Record<string, number>, isSeeded }` (contrat `BotWikiStats`). */
	wikiStats: async () => unwrapBotResult(await contract(300).admin.wikiStats()),

	// ─── Mutations (utilisées via Server Actions) ────────────────────────
	shop: {
		list: () =>
			botRequest<{
				items: Array<{
					key: string;
					type: "card" | "badge" | "color" | "title" | "banner";
					name: string;
					description: string | null;
					price: number;
					roleId: string | null;
					meta: string | null;
					enabled: boolean;
				}>;
			}>("/api/shop", { revalidate: 30 }),
		create: (
			body: Record<string, unknown>
		): Promise<{ ok: boolean; key?: string; error?: string }> =>
			botRequest("/api/shop", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		update: (key: string, patch: Record<string, unknown>) =>
			botRequest(`/api/shop/${encodeURIComponent(key)}`, {
				method: "PUT",
				body: JSON.stringify(patch),
			}),
		toggle: (key: string) =>
			botRequest<{ ok: boolean; enabled: boolean }>(`/api/shop/${encodeURIComponent(key)}`, {
				method: "PATCH",
				body: "{}",
			}),
		remove: (key: string) =>
			botRequest(`/api/shop/${encodeURIComponent(key)}`, {
				method: "DELETE",
			}),
	},

	settingsSet: (key: string, value: unknown) =>
		botRequest(`/api/settings/${encodeURIComponent(key)}`, {
			method: "POST",
			body: JSON.stringify({ value }),
		}),
	settingsUnset: (key: string) =>
		botRequest(`/api/settings/${encodeURIComponent(key)}`, {
			method: "DELETE",
		}),

	triggers: {
		list: () =>
			botRequest<{
				rows: Array<{
					code: string;
					description: string | null;
					pattern: string;
					flags: string | null;
					enabled: boolean;
				}>;
			}>("/api/triggers", { revalidate: 30 }),
		create: (body: {
			code: string;
			description?: string | null;
			pattern: string;
			flags?: string;
			enabled?: boolean;
		}) =>
			botRequest("/api/triggers", {
				method: "POST",
				body: JSON.stringify(body),
			}),
		update: (code: string, patch: Record<string, unknown>) =>
			botRequest(`/api/triggers/${encodeURIComponent(code)}`, {
				method: "PUT",
				body: JSON.stringify(patch),
			}),
		remove: (code: string) =>
			botRequest(`/api/triggers/${encodeURIComponent(code)}`, {
				method: "DELETE",
			}),
	},

	moderationActions: {
		deleteWarn: (id: number) => botRequest(`/api/moderation/warns/${id}`, { method: "DELETE" }),
		clearWarns: (userId: string) =>
			botRequest(`/api/moderation/warns/clear/${encodeURIComponent(userId)}`, {
				method: "POST",
				body: "{}",
			}),
		unjail: (userId: string) =>
			botRequest(`/api/moderation/jails/${encodeURIComponent(userId)}`, {
				method: "DELETE",
			}),
		updateHierarchy: (levels: string[][]) =>
			botRequest("/api/moderation/hierarchy", {
				method: "PUT",
				body: JSON.stringify({ levels }),
			}),
	},

	ticketsClose: (channelId: string) =>
		botRequest(`/api/tickets/${encodeURIComponent(channelId)}/close`, {
			method: "POST",
			body: "{}",
		}),

	cronSetInterval: (name: string, intervalMs: number) =>
		botRequest(`/api/cron/${encodeURIComponent(name)}/interval`, {
			method: "POST",
			body: JSON.stringify({ intervalMs }),
		}),

	webhooksCreate: (body: { channel_id: string; name: string; avatar?: string | null }) =>
		botRequest("/api/webhooks/create", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	webhooksDelete: (id: string) =>
		botRequest(`/api/webhooks/${encodeURIComponent(id)}`, {
			method: "DELETE",
		}),
	webhooksExecute: (body: {
		url: string;
		content?: string;
		username?: string;
		avatar_url?: string;
		embeds?: unknown[];
	}) =>
		botRequest("/api/webhooks/execute", {
			method: "POST",
			body: JSON.stringify(body),
		}),

	levelsRewardUpsert: (body: {
		level: number;
		roleId: string;
		xpThreshold: number;
		zeniBonus?: number;
	}) =>
		botRequest("/api/levels/rewards", {
			method: "POST",
			body: JSON.stringify(body),
		}),
	levelsRewardRemove: (level: number) =>
		botRequest(`/api/levels/rewards/${level}`, { method: "DELETE" }),
};

const BOT_API_URL = API;

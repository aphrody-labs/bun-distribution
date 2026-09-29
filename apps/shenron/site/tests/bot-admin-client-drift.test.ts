import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// B11 : le client admin du site lit les réponses RÉELLES du bot via le contrat.
mock.module("server-only", () => ({}));

const { BotAdminError, createBotAdminContractClient, unwrapBotResult } =
	await import("../src/lib/bot-admin");

/**
 * Réponses enregistrées du bot, dans la forme des handlers de
 * apps/shenron/bot/src/api/server.ts : `/api/stats/totals` → `{ stats }`,
 * `/api/services` → `{ actions }`, `/api/database/tables` → `{ tables }`,
 * `/api/database/:table` → `listRows(...)`, `/api/wiki/stats` →
 * `{ counts, isSeeded }`, `/api/economy/stats` → agrégats zéni.
 */
const RECORDED: Record<string, unknown> = {
	"/api/stats/totals": {
		stats: {
			totalUsers: 5757,
			totalGuilds: 1,
			totalActiveUsers: 2210,
			totalCommands: 118,
			extra: 3,
		},
	},
	"/api/services": {
		actions: [
			{ service: "economy", action: "grant-zeni", description: "Octroi manuel de zénis" },
			{ service: "rag", action: "reindex", description: "Réindexation RAG" },
		],
	},
	"/api/database/tables": {
		tables: [
			{
				name: "users",
				pk: "id",
				readonly: false,
				mutableColumns: ["xp", "zeni"],
				description: "Profils",
			},
			{ name: "guild_settings", pk: "key", readonly: false, mutableColumns: [], description: null },
		],
	},
	"/api/database/users": {
		rows: [{ id: "1", xp: 10, zeni: 200 }],
		total: 5757,
		limit: 50,
		offset: 0,
	},
	"/api/wiki/stats": {
		counts: { characters: 312, planets: 41, transformations: 88 },
		isSeeded: true,
	},
	"/api/economy/stats": {
		zeni: { total: 90412000, avg: 15704.7, max: 4000000, users: 5757, rich: 811, zero: 1203 },
		fusions: 17,
		inventoryItems: 3310,
		shopItemsActive: 42,
	},
};

const seen: Array<{ url: string; auth: string | null; revalidate: unknown }> = [];
const recordedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const url = new URL(String(input));
	seen.push({
		url: url.pathname + url.search,
		auth: new Headers(init?.headers).get("authorization"),
		revalidate: (init as { next?: { revalidate?: number } } | undefined)?.next?.revalidate,
	});
	const body = RECORDED[url.pathname];
	return body === undefined
		? Response.json({ ok: false, error: "Table inconnue" }, { status: 404 })
		: Response.json(body);
}) as typeof fetch;

const client = (revalidate = 30) =>
	createBotAdminContractClient({
		revalidate,
		baseUrl: "http://127.0.0.1:5006",
		token: "test-admin-token",
		fetchImpl: recordedFetch,
	});

describe("bot-admin — dérive du contrat (B11)", () => {
	test("les six lectures parsent la forme réelle du bot", async () => {
		seen.length = 0;
		const stats = unwrapBotResult(await client().admin.stats());
		expect(stats.stats.totalUsers).toBe(5757);
		const services = unwrapBotResult(await client(60).admin.services());
		expect(services.actions.map((a) => a.action)).toEqual(["grant-zeni", "reindex"]);
		const tables = unwrapBotResult(await client(300).admin.tables());
		expect(tables.tables[1]).toMatchObject({ name: "guild_settings", description: null });
		const page = unwrapBotResult(await client(10).admin.table("users", { limit: 50, offset: 0 }));
		expect(page).toMatchObject({ total: 5757, limit: 50, offset: 0 });
		const wiki = unwrapBotResult(await client(300).admin.wikiStats());
		expect(wiki).toEqual({
			counts: { characters: 312, planets: 41, transformations: 88 },
			isSeeded: true,
		});
		const economy = unwrapBotResult(await client().admin.economyStats());
		expect(economy.zeni.users).toBe(5757);

		expect(seen.map((s) => s.url)).toEqual([
			"/api/stats/totals",
			"/api/services",
			"/api/database/tables",
			"/api/database/users?limit=50&offset=0",
			"/api/wiki/stats",
			"/api/economy/stats",
		]);
		expect(seen.every((s) => s.auth === "Bearer test-admin-token")).toBe(true);
		expect(seen.map((s) => s.revalidate)).toEqual([30, 60, 300, 10, 300, 30]);
	});

	test("l'ancienne forme fictive est refusée au lieu d'être castée", async () => {
		const fiction = (async () =>
			Response.json({ users: 1, guilds: 1, commands: 1 })) as unknown as typeof fetch;
		const result = await createBotAdminContractClient({
			revalidate: 30,
			baseUrl: "http://127.0.0.1:5006",
			fetchImpl: fiction,
		}).admin.stats();
		expect(result.ok).toBe(false);
		expect(() => unwrapBotResult(result)).toThrow(BotAdminError);
	});

	test("une erreur HTTP du bot garde son statut et son message", async () => {
		const result = await client().admin.table("absente");
		let caught: unknown = null;
		try {
			unwrapBotResult(result);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(BotAdminError);
		expect((caught as InstanceType<typeof BotAdminError>).status).toBe(404);
		expect((caught as Error).message).toContain("Table inconnue");
	});

	test("bot-admin.ts n'a plus aucun cast `fetch<T>`", () => {
		const source = readFileSync(path.resolve(import.meta.dir, "../src/lib/bot-admin.ts"), "utf8");
		expect(source.includes("fetch<")).toBe(false);
	});
});

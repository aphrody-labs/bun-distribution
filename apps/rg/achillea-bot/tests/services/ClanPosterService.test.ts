/**
 * Tests ClanPosterService — T-4.3
 *
 * Run: bun test tests/services/ClanPosterService.test.ts
 *
 * Strategie : on ne passe pas par Mikro-ORM/DI (cycle ESM + tsyringe lourd
 * en environnement de test, cf. LicenseService.test.ts). On instancie le
 * service avec un `Database` mocke qui retourne directement les fixtures
 * via `em.findOne` / `em.find`. Les helpers de rendu (canvas + fonts
 * fallback `sans-serif`) sont exerces telles quelles.
 *
 * Tests :
 *   1. generatePoster() retourne un Buffer non vide
 *   2. Premier byte est 0x89 (signature PNG)
 *   3. generateAndSave() ecrit bien le fichier sur disque
 *   4. generatePoster() throw NotFound si clanId inexistant
 */

import "reflect-metadata";

import { existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

// IMPORTANT : mocks AVANT tout import dynamique du service. Coupe la chaine
// d'imports lourde (Logger -> ora -> restore-cursor manquant dans le cache
// Bun, MikroORM init, discord client, etc.) : on ne teste ici que le rendu
// canvas + la logique de chargement orchestree par le service.
mock.module("@aphrody/discordx", () => ({
	Client: class MockClient {},
	singleton: () => (target: unknown) => target,
}));

mock.module("@/services/Database", () => ({
	Database: class MockDatabase {},
}));

mock.module("@/entities/Clan", () => ({
	Clan: class Clan {},
}));

mock.module("@/entities/ClanMember", () => ({
	ClanMember: class ClanMember {},
}));

mock.module("@/entities/UserElo", () => ({
	UserElo: class UserElo {},
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type ClanPosterServiceCtor = typeof import("@/services/ClanPosterService").ClanPosterService;
let ClanPosterService: ClanPosterServiceCtor;
const canvasAvailable = await import("@aphrody/canvas").then(() => true).catch(() => false);

const STORAGE_ROOT = join(process.cwd(), "storage", "clans");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_CLAN_ID = 999_001;
const FAKE_CLAN = {
	id: FAKE_CLAN_ID,
	name: "Test Astra",
	shortenedName: "TST",
	normalizedShortName: "tst",
	normalizedName: "test-astra",
	clanAvatarUrl: null,
};

const FAKE_MEMBERS = [
	{
		user: {
			id: "910000000000000001",
			displayName: "Alpha",
			username: "alpha",
			avatar: null,
		},
	},
	{
		user: {
			id: "910000000000000002",
			displayName: "Bravo",
			username: "bravo",
			avatar: null,
		},
	},
	{
		user: { id: "910000000000000003", displayName: "Charlie", username: "c", avatar: null },
	},
];

const FAKE_ELOS = [
	{ user: { id: "910000000000000001" }, elo: 2300 },
	{ user: { id: "910000000000000002" }, elo: 1750 },
	{ user: { id: "910000000000000003" }, elo: 950 },
];

// ---------------------------------------------------------------------------
// Mock Database — duck-typed pour eviter d'instancier MikroORM
// ---------------------------------------------------------------------------

function buildMockDb(opts: { clanExists: boolean }) {
	const clanQuery = {
		select: () => clanQuery,
		where: () => clanQuery,
		executeTakeFirst: async () => opts.clanExists ? {
			id: FAKE_CLAN.id,
			name: FAKE_CLAN.name,
			shortenedName: FAKE_CLAN.shortenedName,
			clanAvatarUrl: FAKE_CLAN.clanAvatarUrl,
			normalizedShortName: FAKE_CLAN.normalizedShortName,
			normalizedName: FAKE_CLAN.normalizedName,
		} : undefined,
	};
	const membersQuery = {
		innerJoin: () => membersQuery,
		leftJoin: () => membersQuery,
		select: () => membersQuery,
		where: () => membersQuery,
		execute: async () => FAKE_MEMBERS.map((member) => ({
			userId: member.user.id,
			displayName: member.user.displayName,
			username: member.user.username,
			avatarUrl: member.user.avatar,
			elo: FAKE_ELOS.find((elo) => elo.user.id === member.user.id)?.elo ?? null,
		})),
	};
	return { selectFrom: (table: string) => table === "clan" ? clanQuery : membersQuery } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const writtenFiles: string[] = [];

beforeAll(async () => {
	if (!canvasAvailable) return;
	const mod = await import("@/services/ClanPosterService");
	ClanPosterService = mod.ClanPosterService;
});

afterAll(() => {
	for (const f of writtenFiles) {
		try {
			if (existsSync(f)) unlinkSync(f);
		} catch {}
	}
});

describe.skipIf(!canvasAvailable)("ClanPosterService — generatePoster()", () => {
	test("retourne un Buffer non vide", async () => {
		const svc = new ClanPosterService().withDatabase(buildMockDb({ clanExists: true }));
		const buf = await svc.generatePoster(FAKE_CLAN_ID);
		expect(Buffer.isBuffer(buf)).toBe(true);
		expect(buf.length).toBeGreaterThan(1024);
	});

	test("premier byte vaut 0x89 (signature PNG)", async () => {
		const svc = new ClanPosterService().withDatabase(buildMockDb({ clanExists: true }));
		const buf = await svc.generatePoster(FAKE_CLAN_ID);
		expect(buf[0]).toBe(0x89);
		expect(buf[1]).toBe(0x50); // P
		expect(buf[2]).toBe(0x4e); // N
		expect(buf[3]).toBe(0x47); // G
	});

	test("throw NotFound si clanId inexistant", async () => {
		const svc = new ClanPosterService().withDatabase(buildMockDb({ clanExists: false }));
		let caught: unknown = null;
		try {
			await svc.generatePoster(FAKE_CLAN_ID);
		} catch (e) {
			caught = e;
		}
		expect(caught).not.toBeNull();
		expect((caught as { status?: number }).status).toBe(404);
	});
});

describe.skipIf(!canvasAvailable)("ClanPosterService — generateAndSave()", () => {
	test("ecrit bien un PNG sur disque dans storage/clans/", async () => {
		const svc = new ClanPosterService().withDatabase(buildMockDb({ clanExists: true }));
		const path = await svc.generateAndSave(FAKE_CLAN_ID);
		writtenFiles.push(path);

		expect(path.startsWith(STORAGE_ROOT)).toBe(true);
		expect(existsSync(path)).toBe(true);
		expect(statSync(path).size).toBeGreaterThan(1024);

		const head = new Uint8Array(await Bun.file(path).arrayBuffer()).slice(0, 4);
		expect(head[0]).toBe(0x89);
		expect(head[1]).toBe(0x50);
		expect(head[2]).toBe(0x4e);
		expect(head[3]).toBe(0x47);
	});
});

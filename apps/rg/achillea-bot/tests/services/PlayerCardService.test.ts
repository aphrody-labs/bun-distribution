/**
 * Tests PlayerCardService — T-4.1
 *
 * Run: bun test tests/services/PlayerCardService.test.ts
 *
 * Strategie : meme approche que ClanPosterService.test.ts. On instancie le
 * service avec un Database mocke (em.findOne) pour eviter MikroORM/tsyringe
 * en environnement de test. Le rendu canvas (sans-serif fallback) est exerce
 * tel quel.
 *
 * Tests :
 *   1. generateCard() retourne un Buffer non vide
 *   2. Premier byte = 0x89 (signature PNG)
 *   3. generateCard() throw NotFound si userId inexistant
 *   4. generateAndSave() ecrit storage/cards/<userId>.png sur disque
 */

import "reflect-metadata";

import { existsSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

// IMPORTANT : mocks AVANT import dynamique du service pour couper la chaine
// Logger -> ora -> restore-cursor / MikroORM init / discord client.
mock.module("@aphrody/discordx", () => ({
	Client: class MockClient {},
	singleton: () => (target: unknown) => target,
}));

mock.module("@/services/Database", () => ({
	Database: class MockDatabase {},
}));

mock.module("@/entities/User", () => ({
	User: class User {},
}));

mock.module("@/entities/UserElo", () => ({
	UserElo: class UserElo {},
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type PlayerCardServiceCtor = typeof import("@/services/PlayerCardService").PlayerCardService;
let PlayerCardService: PlayerCardServiceCtor;
const canvasAvailable = await import("@aphrody/canvas").then(() => true).catch(() => false);

const STORAGE_ROOT = join(process.cwd(), "storage", "cards");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_USER_ID = "910000000000000010";
const FAKE_USER = {
	id: FAKE_USER_ID,
	displayName: "Achilles",
	normalizedDisplayName: "achilles",
	username: "achilles",
	avatar: null,
};

const FAKE_ELO = {
	user: { id: FAKE_USER_ID },
	mode: 2,
	elo: 1850,
	wins: 42,
	losses: 18,
};

// ---------------------------------------------------------------------------
// Mock Database — duck-typed
// ---------------------------------------------------------------------------

function buildMockDb(opts: { userExists: boolean; withElo?: boolean }) {
	const query = {
		leftJoin: () => query,
		select: () => query,
		where: () => query,
		executeTakeFirst: async () => opts.userExists ? {
			id: FAKE_USER.id,
			display_name: FAKE_USER.displayName,
			normalized_display_name: FAKE_USER.normalizedDisplayName,
			username: FAKE_USER.username,
			avatar: FAKE_USER.avatar,
			elo: opts.withElo === false ? null : FAKE_ELO.elo,
			wins: opts.withElo === false ? null : FAKE_ELO.wins,
			losses: opts.withElo === false ? null : FAKE_ELO.losses,
		} : undefined,
	};
	return { selectFrom: () => query } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const writtenFiles: string[] = [];

beforeAll(async () => {
	if (!canvasAvailable) return;
	const mod = await import("@/services/PlayerCardService");
	PlayerCardService = mod.PlayerCardService;
});

afterAll(() => {
	for (const f of writtenFiles) {
		try {
			if (existsSync(f)) unlinkSync(f);
		} catch {
			/* noop */
		}
	}
});

describe.skipIf(!canvasAvailable)("PlayerCardService — generateCard()", () => {
	test("retourne un Buffer non vide", async () => {
		const svc = new PlayerCardService().withDatabase(buildMockDb({ userExists: true }));
		const buf = await svc.generateCard(FAKE_USER_ID);
		expect(Buffer.isBuffer(buf)).toBe(true);
		expect(buf.length).toBeGreaterThan(1024);
	});

	test("premier byte = 0x89 (signature PNG)", async () => {
		const svc = new PlayerCardService().withDatabase(buildMockDb({ userExists: true }));
		const buf = await svc.generateCard(FAKE_USER_ID);
		expect(buf[0]).toBe(0x89);
		expect(buf[1]).toBe(0x50); // P
		expect(buf[2]).toBe(0x4e); // N
		expect(buf[3]).toBe(0x47); // G
	});

	test("rend aussi sans UserElo (fallback ELO=0)", async () => {
		const svc = new PlayerCardService().withDatabase(buildMockDb({ userExists: true, withElo: false }));
		const buf = await svc.generateCard(FAKE_USER_ID);
		expect(buf[0]).toBe(0x89);
		expect(buf.length).toBeGreaterThan(1024);
	});

	test("expose les W/L et winrate de UserElo (plus de fallback 0)", async () => {
		const svc = new PlayerCardService().withDatabase(buildMockDb({ userExists: true }));
		const data = await (
			svc as unknown as {
				loadCardData: (id: string) => Promise<{ wins: number; losses: number; winrate: number }>;
			}
		).loadCardData(FAKE_USER_ID);
		expect(data.wins).toBe(42);
		expect(data.losses).toBe(18);
		expect(data.winrate).toBe(70);
	});

	test("throw NotFound si userId inexistant", async () => {
		const svc = new PlayerCardService().withDatabase(buildMockDb({ userExists: false }));
		let caught: unknown = null;
		try {
			await svc.generateCard(FAKE_USER_ID);
		} catch (e) {
			caught = e;
		}
		expect(caught).not.toBeNull();
		expect((caught as { status?: number }).status).toBe(404);
	});
});

describe.skipIf(!canvasAvailable)("PlayerCardService — generateAndSave()", () => {
	test("ecrit bien storage/cards/<userId>.png sur disque", async () => {
		const svc = new PlayerCardService().withDatabase(buildMockDb({ userExists: true }));
		const path = await svc.generateAndSave(FAKE_USER_ID);
		writtenFiles.push(path);

		expect(path.startsWith(STORAGE_ROOT)).toBe(true);
		expect(path.endsWith(`${FAKE_USER_ID}.png`)).toBe(true);
		expect(existsSync(path)).toBe(true);
		expect(statSync(path).size).toBeGreaterThan(1024);

		const head = new Uint8Array(await Bun.file(path).arrayBuffer()).slice(0, 4);
		expect(head[0]).toBe(0x89);
		expect(head[1]).toBe(0x50);
		expect(head[2]).toBe(0x4e);
		expect(head[3]).toBe(0x47);
	});
});

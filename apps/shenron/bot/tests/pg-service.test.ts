// SPDX-License-Identifier: Apache-2.0
/**
 * B2 : PgService paresseux et nullable, un seul pool `shenron-bot` partagé par
 * EpisodesService et BxcBridgeService. Aucune connexion n'est ouverte : Bun.SQL
 * ne se connecte qu'à la première requête.
 */
import "./setup";
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseService } from "../src/db";
import {
	BOT_PG_APPLICATION_NAME,
	BOT_PG_POOL_MAX,
	PgService,
	resolveBotDatabaseUrl,
} from "../src/db/pg";
import { BxcBridgeService } from "../src/services/BxcBridgeService";
import { EpisodesService } from "../src/services/EpisodesService";

const dir = mkdtempSync(join(tmpdir(), "shenron-bot-pg-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const ABSENT = join(dir, "absent.env");
const URL_TEST = "postgres://bot:secret@127.0.0.1:1/shenron_test";

describe("PgService", () => {
	it("sans DATABASE_URL ni fichier de repli : get() renvoie null", () => {
		const pg = PgService.withEnv({ SHENRON_PG_ENV: ABSENT });
		expect(pg.get()).toBeNull();
		expect(pg.get()).toBeNull();
	});

	it("EpisodesService et BxcBridgeService dégradent comme avant sans base", async () => {
		const pg = PgService.withEnv({ SHENRON_PG_ENV: ABSENT });
		const episodes = new EpisodesService(pg);
		expect(await episodes.parId(1)).toBeNull();
		expect(await episodes.parId(1)).toBeNull();
		const bxc = new BxcBridgeService({} as DatabaseService, pg);
		await expect(bxc.syncChapterPagesToPg("0-10-1", "dragon-ball", 1)).rejects.toThrow(
			"Connexion PostgreSQL indisponible pour synchroniser les pages"
		);
	});

	it("une erreur à la création du pool dégrade à null sans retenter", () => {
		let calls = 0;
		const pg = PgService.withEnv({ DATABASE_URL: URL_TEST, SHENRON_PG_ENV: ABSENT }, () => {
			calls += 1;
			throw new Error("invalid connection string");
		});
		expect(pg.get()).toBeNull();
		expect(pg.get()).toBeNull();
		expect(calls).toBe(1);
	});

	it("un seul pool, application_name shenron-bot, max 2, partagé par Drizzle et le SQL brut", async () => {
		const pg = PgService.withEnv({ DATABASE_URL: URL_TEST, SHENRON_PG_ENV: ABSENT });
		const a = pg.get();
		const b = pg.get();
		expect(a).not.toBeNull();
		expect(a).toBe(b);
		const options = (a!.sql as unknown as { options: { query: string; max: number; database: string } })
			.options;
		expect(options.query).toContain(`application_name\u0000${BOT_PG_APPLICATION_NAME}\u0000`);
		expect(options.max).toBe(BOT_PG_POOL_MAX);
		expect(options.database).toBe("shenron_test");
		expect((a!.db as unknown as { $client: unknown }).$client).toBe(a!.sql);
		await pg.close(0);
	});

	it("repli : fichier SHENRON_PG_ENV, dernière ligne active gagnante", () => {
		const file = join(dir, "neon.env");
		writeFileSync(
			file,
			`DATABASE_URL=postgresql://old:x@decommissioned.invalid/neondb\nDATABASE_URL="${URL_TEST}"\n`
		);
		expect(resolveBotDatabaseUrl({ SHENRON_PG_ENV: file })).toBe(URL_TEST);
		expect(resolveBotDatabaseUrl({ SHENRON_PG_ENV: ABSENT })).toBeNull();
		expect(resolveBotDatabaseUrl({ DATABASE_URL: URL_TEST, SHENRON_PG_ENV: file })).toBe(URL_TEST);
	});
});

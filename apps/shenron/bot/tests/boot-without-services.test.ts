// SPDX-License-Identifier: Apache-2.0
/**
 * Démarrage du bot sans services (W5-TOOL-02) : dans un process `bun` enfant
 * dont l'environnement ne contient ni `APHRODY_*`, ni `DATABASE_URL`, ni
 * `REDIS_URL`, ni `EMBED_URL`, les modules qui parlent à ces services
 * s'importent sans erreur (aucune lecture d'environnement fatale au niveau
 * module, aucune connexion ouverte) et `PgService` renvoie `null`. La connexion
 * Discord n'est jamais lancée : seuls les modules sont importés.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const BOT_DIR = resolve(import.meta.dir, "..");
const dir = mkdtempSync(join(tmpdir(), "shenron-bot-boot-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const REMOVED = /^(APHRODY_|DATABASE_URL$|REDIS_URL$|EMBED_URL$)/;

function reducedEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && !REMOVED.test(key)) env[key] = value;
	}
	// Le fichier de repli systemd historique ne doit pas fournir d'URL.
	env.SHENRON_PG_ENV = join(dir, "absent.env");
	// Identité Discord minimale exigée par le schéma d'environnement du bot
	// (valeurs factices : aucune connexion Discord n'est lancée).
	env.NODE_ENV = "test";
	env.DISCORD_TOKEN = "test-token";
	env.GUILD_ID = "1497167233280118896";
	env.OWNER_ID = "11111111111111111";
	env.DATABASE_PATH = join(dir, "bot.db");
	env.LOG_LEVEL = "error";
	return env;
}

const SCRIPT = `
import "reflect-metadata";
const modules = [
	"./src/lib/rag.ts",
	"./src/lib/llm.ts",
	"./src/lib/semantic-cache.ts",
	"./src/services/TrainingService.ts",
	"./src/db/pg.ts",
];
for (const m of modules) await import(m);
const { PgService } = await import("./src/db/pg.ts");
const pg = new PgService();
const handle = pg.get();
console.log(JSON.stringify({ imported: modules.length, pg: handle === null ? null : "handle" }));
process.exit(0);
`;

describe("boot without services", () => {
	it("imports rag, llm, semantic-cache, TrainingService and pg with no service env", async () => {
		const env = reducedEnv();
		for (const key of Object.keys(env)) expect(REMOVED.test(key)).toBe(false);
		const proc = Bun.spawn([process.execPath, "-e", SCRIPT], {
			cwd: BOT_DIR,
			env,
			stdout: "pipe",
			stderr: "pipe",
		});
		const timer = setTimeout(() => proc.kill(), 60_000);
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		clearTimeout(timer);
		if (code !== 0) console.error(stderr);
		expect(code).toBe(0);
		const line = stdout.trim().split("\n").at(-1) ?? "";
		expect(JSON.parse(line)).toEqual({ imported: 5, pg: null });
	}, 90_000);
});

/**
 * Pont IPC bot ↔ cron, de bout en bout sur une VRAIE socket UNIX.
 *
 * Ce test monte le serveur de `packages/cron/src/lib/ipc-unix.ts` et
 * l'interroge avec le client du bot : c'est le seul moyen de vérifier sans
 * redémarrer `rg-cron.service` que la liste noire côté serveur, le verrou
 * d'unicité et la diffusion aux abonnés fonctionnent réellement.
 *
 * La socket est créée dans un dossier temporaire : `RG_CRON_SOCKET` est posé
 * AVANT le premier import des deux modules, qui figent le chemin à l'import.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dossier = mkdtempSync(join(tmpdir(), "rg-ipc-"));
const chemin = join(dossier, "cron.sock");
Bun.env.RG_CRON_SOCKET = chemin;

/**
 * Contrat MINIMAL du pont, redéclaré ici plutôt qu'importé.
 *
 * ⚠ Le spécificateur d'import ci-dessous est volontairement calculé, pas
 * littéral : `packages/cron/src/lib/ipc-unix.ts` route désormais les verbes de
 * scraping vers `tasks/ie-crawl/scrape-service.ts`, qui utilise Aphrody Web CDP
 * et `@aphrody/x`. Avec un chemin littéral, `tsc -p apps/bot` suivait la chaîne
 * et type-vérifiait les SOURCES de ces deux dépendances (elles supposent le DOM
 * et ont leurs propres erreurs) : le bot héritait de 14 erreurs qui ne lui
 * appartiennent pas. Un spécificateur calculé arrête la traversée ; le test,
 * lui, charge exactement le même module au même chemin.
 */
interface PontIpcTest {
	arreter(): void;
	abonnes(): number;
	diffuser(evenement: { event: string; [cle: string]: unknown }): void;
}

interface DependancesIpcTest {
	metriques(): unknown;
	telemetrie(): unknown;
	catalogue(): { taches: string[]; schedules: Record<string, string> };
	lancerTache(nom: string): Promise<{ success: boolean; error?: string }> | null;
}

const cheminIpcUnix = new URL("../../../../../packages/rg-cron/src/lib/ipc-unix.ts", import.meta.url)
	.href;
const { demarrerIpcUnix } = (await import(cheminIpcUnix)) as {
	demarrerIpcUnix: (deps: DependancesIpcTest) => PontIpcTest;
};
const { abonnerCron, appelerCron, cronDisponible, cheminSocketCron } =
	await import("./cron-ipc.ts");

/** Tâche factice : se termine quand le test le décide. */
let terminerTache: ((resultat: { success: boolean; error?: string }) => void) | null = null;
const lancements: string[] = [];

const pont = demarrerIpcUnix({
	metriques: () => ({
		startedAt: "2026-08-12T17:00:00.000Z",
		tasksTriggered: 3,
		lastExecution: {
			"discord:messages": { time: "2026-08-12T22:00:00.000Z", durationMs: 3030, success: true },
		},
	}),
	telemetrie: () => ({ membres: 1984 }),
	catalogue: () => ({ taches: ["warm", "db"], schedules: { warm: "*/30 * * * *" } }),
	lancerTache: (nom) => {
		if (nom !== "warm") {
			return null;
		}
		lancements.push(nom);
		return new Promise((resoudre) => {
			terminerTache = resoudre;
		});
	},
});

beforeAll(() => {
	expect(cheminSocketCron()).toBe(chemin);
});

afterAll(() => {
	pont.arreter();
	rmSync(dossier, { recursive: true, force: true });
});

describe("verbes de lecture", () => {
	test("health répond et le pont se déclare disponible", async () => {
		const reponse = await appelerCron({ cmd: "health" });
		expect(reponse.success).toBe(true);
		expect(await cronDisponible()).toBe(true);
	});

	test("tasks.list rend le catalogue du démon", async () => {
		const reponse = await appelerCron<{
			success: boolean;
			taches: string[];
			schedules: Record<string, string>;
		}>({
			cmd: "tasks.list",
		});
		expect(reponse.taches).toEqual(["warm", "db"]);
		expect(reponse.schedules.warm).toBe("*/30 * * * *");
	});

	test("metrics et task.status exposent la dernière exécution réelle", async () => {
		const metriques = await appelerCron<{
			success: boolean;
			metrics: { tasksTriggered: number };
		}>({ cmd: "metrics" });
		expect(metriques.metrics.tasksTriggered).toBe(3);

		const statut = await appelerCron<{
			success: boolean;
			derniere: { time: string; durationMs: number; success: boolean } | null;
		}>({
			cmd: "task.status",
			nom: "discord:messages",
		});
		expect(statut.derniere).toEqual({
			time: "2026-08-12T22:00:00.000Z",
			durationMs: 3030,
			success: true,
		});
	});

	test("un verbe inconnu est refusé, pas ignoré", async () => {
		const reponse = await appelerCron({ cmd: "rm -rf /" });
		expect(reponse.success).toBe(false);
		expect(reponse.code).toBe("verbe_inconnu");
	});
});

describe("garde serveur sur task.run", () => {
	test("la liste noire s'applique côté CRON, pas seulement côté bot", async () => {
		const reponse = await appelerCron({ cmd: "task.run", nom: "db" });
		expect(reponse.success).toBe(false);
		expect(reponse.code).toBe("interdit");
		expect(lancements).not.toContain("db");
	});

	test("elle n'est pas contournable par l'autre écriture du nom", async () => {
		const reponse = await appelerCron({ cmd: "task.run", nom: "discord-backfill" });
		expect(reponse.success).toBe(false);
		expect(reponse.code).toBe("interdit");
	});

	test("une tâche inconnue du démon est refusée", async () => {
		const reponse = await appelerCron({ cmd: "task.run", nom: "seo:llms-txt" });
		expect(reponse.success).toBe(false);
		expect(reponse.code).toBe("inconnue");
	});
});

describe("verrou d'unicité et task.done", () => {
	test("un second lancement de la même tâche est refusé tant qu'elle tourne", async () => {
		const evenements: Array<Record<string, unknown>> = [];
		const couper = abonnerCron((evenement) => evenements.push(evenement));
		// Laisse l'abonnement s'établir avant de déclencher.
		await Bun.sleep(120);

		const premier = await appelerCron({ cmd: "task.run", nom: "warm" });
		expect(premier.success).toBe(true);

		const second = await appelerCron({ cmd: "task.run", nom: "warm" });
		expect(second.success).toBe(false);
		expect(second.code).toBe("deja_en_cours");
		expect(lancements).toEqual(["warm"]);

		// La tâche se termine : le verdict part vers l'abonné.
		terminerTache?.({ success: true });
		await Bun.sleep(150);

		const fini = evenements.find((e) => e.event === "task.done");
		expect(fini).toBeDefined();
		expect(fini?.nom).toBe("warm");
		expect(fini?.success).toBe(true);

		// Verrou relâché : un nouveau lancement repasse.
		const troisieme = await appelerCron({ cmd: "task.run", nom: "warm" });
		expect(troisieme.success).toBe(true);
		terminerTache?.({ success: false, error: "test" });
		await Bun.sleep(120);
		couper();
	});
});

describe("diffusion aux abonnés", () => {
	test("tweets.signal arrive au bot abonné", async () => {
		const recus: Array<Record<string, unknown>> = [];
		const couper = abonnerCron((evenement) => recus.push(evenement));
		await Bun.sleep(120);
		expect(pont.abonnes()).toBeGreaterThan(0);

		pont.diffuser({ event: "tweets.signal", total: 12_998 });
		await Bun.sleep(120);

		expect(recus.some((e) => e.event === "tweets.signal" && e.total === 12_998)).toBe(true);
		couper();
	});
});

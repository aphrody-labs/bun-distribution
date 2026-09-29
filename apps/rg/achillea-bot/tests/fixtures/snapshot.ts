/**
 * Accès au snapshot SQLite local de la DB Supabase (`supabase-snapshot.sqlite`).
 *
 * Source de données OFFLINE, déterministe et 100% Bun-natif (`bun:sqlite`) pour les
 * tests locaux : aucune dépendance réseau ni credentials Postgres. Le fichier est
 * reconstructible à tout moment via `bun scripts/dump-supabase-sqlite.ts`
 * (lecture PostgREST avec la clé publishable). Il n'est PAS versionné (PII réelle +
 * artefact reproductible) → les suites qui en dépendent se *skippent* gracieusement
 * quand il est absent (clone frais / CI sans réseau).
 *
 *   import { describeWithSnapshot, openSnapshot } from "../fixtures/snapshot";
 *   describeWithSnapshot("intégrité", (db) => {
 *     test("...", () => { db().query("SELECT ...").all(); });
 *   });
 */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, beforeAll, afterAll } from "bun:test";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Chemin absolu du snapshot (surchargeable par env pour pointer une autre extraction). */
export const SNAPSHOT_PATH = process.env.SUPABASE_SNAPSHOT_PATH
	? resolve(process.env.SUPABASE_SNAPSHOT_PATH)
	: resolve(HERE, "supabase-snapshot.sqlite");

/** Le snapshot est-il présent sur le disque ? */
export function hasSnapshot(): boolean {
	return existsSync(SNAPSHOT_PATH);
}

/** Ouvre le snapshot en lecture seule. Lève si absent — préférer `describeWithSnapshot`. */
export function openSnapshot(): Database {
	if (!hasSnapshot()) {
		throw new Error(
			`Snapshot Supabase absent : ${SNAPSHOT_PATH}\n` +
				"Regénérez-le avec : bun scripts/dump-supabase-sqlite.ts"
		);
	}
	return new Database(SNAPSHOT_PATH, { readonly: true });
}

/**
 * Bloc `describe` qui n'exécute ses tests que si le snapshot existe (sinon `describe.skip`),
 * et fournit un accesseur `db()` vers une connexion lecture seule partagée (ouverte/fermée
 * automatiquement autour de la suite).
 */
export function describeWithSnapshot(label: string, body: (db: () => Database) => void): void {
	if (!hasSnapshot()) {
		describe.skip(`${label} (snapshot absent — bun scripts/dump-supabase-sqlite.ts)`, () => {
			body(() => {
				throw new Error("snapshot absent");
			});
		});
		return;
	}

	describe(label, () => {
		let conn: Database | null = null;
		beforeAll(() => {
			conn = new Database(SNAPSHOT_PATH, { readonly: true });
		});
		afterAll(() => {
			conn?.close();
			conn = null;
		});
		body(() => {
			if (!conn) throw new Error("connexion snapshot non initialisée");
			return conn;
		});
	});
}

/** Compte de lignes d'une relation (table ou vue). */
export function countRows(db: Database, relation: string): number {
	return (db.query(`SELECT count(*) AS n FROM "${relation}"`).get() as { n: number }).n;
}

/** Liste des relations présentes dans le snapshot (tables + vues matérialisées en table). */
export function listRelations(db: Database): string[] {
	return db
		.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
		.all()
		.map((r) => (r as { name: string }).name);
}

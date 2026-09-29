/**
 * Sauvegarde et restauration de la colonne `visible` du wiki (`bot.*`).
 *
 * Pourquoi ce script existe : une bascule « tout masquer » depuis
 * `/admin/visibilite` passait par un `UPDATE … SET visible` sans clause `WHERE`
 * dont le route handler répondait AVANT d'écrire l'audit. Résultat constaté en
 * production le 2026-08-21 : 2 309 lignes masquées (1 322 personnages,
 * 825 techniques, 81 transformations, 62 planètes, 18 races) sans aucune trace
 * dans `public.wiki_revisions`, donc sans retour arrière possible depuis
 * `/admin/wiki/history`. Le bug est corrigé (`lib/wiki-admin.ts`,
 * `lib/wiki-revisions.ts`) ; ce script répare l'état déjà en base.
 *
 * Il écrit TOUJOURS une sauvegarde JSON horodatée avant de modifier quoi que ce
 * soit, et n'écrit rien sans `--apply`.
 *
 *   bun apps/site/scripts/restore-wiki-visibility.ts                  # état + sauvegarde, aucune écriture
 *   bun apps/site/scripts/restore-wiki-visibility.ts --apply          # republie les lignes masquées
 *   bun apps/site/scripts/restore-wiki-visibility.ts --apply --tables db_techniques,db_races
 *   bun apps/site/scripts/restore-wiki-visibility.ts --undo <fichier> # réapplique une sauvegarde
 *
 * `DATABASE_URL` vient de `apps/site/.env` ou de l'environnement.
 */
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

/** Tables `bot.*` portant une colonne `visible` (miroir de `VISIBILITY_TABLES`). */
const DEFAULT_TABLES = [
	"db_characters",
	"db_techniques",
	"db_transformations",
	"db_planets",
	"db_races",
] as const;

type Snapshot = {
	takenAt: string;
	tables: Record<string, Array<{ id: string; visible: boolean }>>;
};

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
const valueOf = (flag: string): string | null => {
	const i = argv.indexOf(flag);
	return i >= 0 && argv[i + 1] ? argv[i + 1]! : null;
};

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL requis (Postgres du site).");

	const tables = (valueOf("--tables")
		?.split(",")
		.map((t) => t.trim())
		.filter(Boolean) ?? [...DEFAULT_TABLES]) as string[];

	// Garde-fou : le nom de table est interpolé dans le SQL (postgres-js ne
	// paramètre pas les identifiants). On n'accepte que des tables connues.
	for (const t of tables) {
		if (!/^db_[a-z_]+$/.test(t)) throw new Error(`Nom de table refusé : ${t}`);
	}

	const sql = postgres(url, { max: 1 });
	try {
		const undoFile = valueOf("--undo");
		if (undoFile) return await undo(sql, undoFile);

		// ── 1. état courant + sauvegarde ────────────────────────────────────────
		const snapshot: Snapshot = { takenAt: new Date().toISOString(), tables: {} };
		let hiddenTotal = 0;

		for (const t of tables) {
			const rows = await sql.unsafe<Array<{ id: unknown; visible: boolean | null }>>(
				`SELECT id, visible FROM bot.${t} ORDER BY id`
			);
			snapshot.tables[t] = rows.map((r) => ({ id: String(r.id), visible: r.visible !== false }));
			const hidden = snapshot.tables[t]!.filter((r) => !r.visible).length;
			hiddenTotal += hidden;
			console.log(
				`  ${t.padEnd(22)} ${String(rows.length - hidden).padStart(5)} visibles / ${String(rows.length).padStart(5)}` +
					(hidden ? `  → ${hidden} masquées` : "")
			);
		}

		const dir = join(import.meta.dir, "..", "..", "..", "data", "backups", "wiki-visibility");
		await mkdir(dir, { recursive: true });
		const stamp = snapshot.takenAt.replace(/[:.]/g, "-");
		const file = join(dir, `visibility-${stamp}.json`);
		await writeFile(file, JSON.stringify(snapshot, null, 2));
		console.log(`\nSauvegarde : ${file}`);

		if (hiddenTotal === 0) {
			console.log("Aucune ligne masquée — rien à faire.");
			return;
		}
		if (!has("--apply")) {
			console.log(`\n${hiddenTotal} lignes masquées. Relancer avec --apply pour les republier.`);
			return;
		}

		// ── 2. republication ────────────────────────────────────────────────────
		let restored = 0;
		for (const t of tables) {
			const res = await sql.unsafe(
				`UPDATE bot.${t} SET visible = true WHERE visible IS DISTINCT FROM true RETURNING id`
			);
			if (res.length > 0) console.log(`  ${t.padEnd(22)} +${res.length} republiées`);
			restored += res.length;
		}
		console.log(`\n${restored} lignes republiées.`);
		console.log(`Retour arrière : --undo ${file}`);
	} finally {
		await sql.end({ timeout: 5 });
	}
}

/** Réapplique une sauvegarde ligne à ligne (deux UPDATE par table, pas un par ligne). */
async function undo(sql: postgres.Sql, file: string) {
	const snap = JSON.parse(await readFile(file, "utf8")) as Snapshot;
	console.log(`Sauvegarde du ${snap.takenAt}`);
	let touched = 0;
	for (const [t, rows] of Object.entries(snap.tables)) {
		if (!/^db_[a-z_]+$/.test(t)) throw new Error(`Nom de table refusé : ${t}`);
		for (const want of [true, false]) {
			const ids = rows.filter((r) => r.visible === want).map((r) => r.id);
			if (ids.length === 0) continue;
			const res = await sql.unsafe(
				`UPDATE bot.${t} SET visible = $1 WHERE id = ANY($2::bigint[]) RETURNING id`,
				[want, ids] as never
			);
			touched += res.length;
		}
		console.log(`  ${t.padEnd(22)} restaurée`);
	}
	console.log(`\n${touched} lignes remises dans leur état d'origine.`);
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});

/**
 * fix-ki-noncanon.ts — Purge les « niveaux de ki » NON CANONIQUES de db_characters.
 *
 * Contexte : la colonne `ki`/`max_ki` (héritée d'un ancien import de wiki de fans)
 * contient des valeurs
 * inventées par les fans en unités cosmiques (« 19.84 Septillion », « 969
 * Googolplex », « 100 Trillion »…) et des « unknown ». Or les niveaux de combat
 * (戦闘力) ne sont CANON que jusqu'à l'arc Freezer (Akira Toriyama les a abandonnés
 * ensuite) et n'ont jamais dépassé l'échelle ~120 000 000 dans le manga/Daizenshuu.
 * Tout ce qui est en Billion+ ou en unité fan est donc de la désinformation pour un
 * wiki factuel centré manga/databook → on le met à NULL (la page masque alors le
 * bloc ki, ce qui est honnête : « pas de niveau de combat canonique »).
 *
 * On NE fabrique AUCUN chiffre : on retire seulement le non-sourçable. La curation
 * des vrais niveaux Daizenshuu (ère Saiyan-Freezer) fera l'objet d'une passe sourcée.
 *
 * Usage :
 *   bun apps/bot/scripts/fix-ki-noncanon.ts            # dry-run
 *   bun apps/bot/scripts/fix-ki-noncanon.ts --apply
 * Env : DATABASE_URL = PG du site (source de vérité ; propagé au SQLite par reverse-sync).
 */
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("✗ DATABASE_URL requis.");
	process.exit(1);
}
const APPLY = process.argv.includes("--apply");

// Unités/valeurs jamais attestées dans le manga ou les databooks officiels.
const FAN =
	/\b(billion|trillion|quadrillion|quintillion|sextillion|septillion|octillion|googol|googolplex)\b/i;
const isNonCanon = (v: string | null): boolean => {
	if (!v) return false;
	const s = v.trim().toLowerCase();
	if (!s) return false;
	if (s === "unknown" || s === "inconnu" || s === "n/a" || s === "?") return true;
	return FAN.test(s);
};

const pg = postgres(DATABASE_URL, { max: 1, prepare: false });
const rows = (await pg.unsafe(
	`SELECT id, name, ki, max_ki FROM bot.db_characters WHERE ki IS NOT NULL OR max_ki IS NOT NULL`
)) as unknown as { id: number; name: string; ki: string | null; max_ki: string | null }[];

let kiCleared = 0,
	maxCleared = 0,
	rowsTouched = 0;
for (const r of rows) {
	const clrKi = isNonCanon(r.ki);
	const clrMax = isNonCanon(r.max_ki);
	if (!clrKi && !clrMax) continue;
	rowsTouched++;
	if (clrKi) kiCleared++;
	if (clrMax) maxCleared++;
	console.log(
		`#${r.id} ${String(r.name).padEnd(18)} ` +
			`ki:${clrKi ? `「${r.ki}」→NULL` : "ok"}  max_ki:${clrMax ? `「${r.max_ki}」→NULL` : "ok"}`
	);
	if (APPLY) {
		await pg.unsafe(
			`UPDATE bot.db_characters SET ki = ${clrKi ? "NULL" : "ki"}, max_ki = ${clrMax ? "NULL" : "max_ki"} WHERE id = ${r.id}`
		);
	}
}
console.log(
	`\n${APPLY ? "APPLY" : "DRY-RUN"} · lignes touchées=${rowsTouched} · ki vidés=${kiCleared} · max_ki vidés=${maxCleared}` +
		(APPLY ? "" : "  (relancer avec --apply)")
);
await pg.end();

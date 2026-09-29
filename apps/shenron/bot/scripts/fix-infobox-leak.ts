/**
 * fix-infobox-leak.ts — nettoie les champs `db_characters` pollués par une FUITE
 * d'infobox laissés par un ancien import de wiki de fans.
 *
 * Symptôme (vu via wiki_search) : des champs courts contiennent le séparateur de
 * paramètre d'infobox `|`, et/ou la fermeture de template `}}` suivie de texte de
 * corps qui a débordé. Exemples réels :
 *   name_ja      "|Décès = An 737"            "ギラン|Alias = Guilan"
 *   race         "Terrien}}"                  "Terrien|Poids = 33kg|…}}Chaozu (餃子)…"
 *   affiliation  "Soldat de Freezer|Voix Japonaise = …"   "|Race= Inconnue"
 *   name_romaji  "Alpha 1|Famille=|…}}Alpha N°1 (アルファ１号)…"
 *
 * La VRAIE valeur est TOUJOURS le préfixe avant le 1er `|` ou `}}`. On le garde
 * (trimé), sinon NULL. Cas particulier `name_ja` : on n'accepte le préfixe QUE
 * s'il contient des caractères japonais (un préfixe latin y serait erroné) ; et
 * `マジ=カーヨ` (id 768, `=` légitime, pas de `|`) n'est PAS touché.
 *
 * Source de vérité = Postgres `bot.*`. Après correction → propager au replica
 * SQLite : `sudo systemctl start shenron-neon-pull.service`.
 *
 * Idempotent. Usage :
 *   DATABASE_URL=… bun apps/shenron/bot/scripts/fix-infobox-leak.ts [--dry-run]
 */
import { SQL } from "bun";

const DRY = process.argv.includes("--dry-run");
const sql = new SQL(process.env.DATABASE_URL);

const HAS_JP = /[぀-ヿ一-鿿ｦ-ﾟ]/;

/** Colonnes courtes de bot.db_characters touchées. `requireJP` ⇒ name_ja. */
const COLUMNS: { col: string; requireJP?: boolean }[] = [
	{ col: "name_ja", requireJP: true },
	{ col: "name_romaji" },
	{ col: "race" },
	{ col: "affiliation" },
];

/** Préfixe avant le 1er `|` ou `}}`, nettoyé. NULL si vide (ou non-JP en name_ja). */
function clean(raw: string, requireJP: boolean): string | null {
	const prefix = raw
		.split(/\||\}\}/)[0]
		.replace(/[\s,、]+$/u, "")
		.trim();
	if (!prefix) return null;
	if (requireJP && !HAS_JP.test(prefix)) return null;
	return prefix;
}

let grand = 0;
for (const { col, requireJP } of COLUMNS) {
	const c = sql(col);
	// Pollution = présence d'un `|` OU d'un `}}`.
	const rows = (await sql`
		SELECT id, name, ${c} AS v FROM bot.db_characters
		WHERE ${c} LIKE '%|%' OR ${c} LIKE '%}}%'`) as { id: number; name: string; v: string }[];
	if (rows.length === 0) {
		console.log(`${DRY ? "[dry] " : ""}db_characters.${col}: déjà propre`);
		continue;
	}
	let kept = 0;
	let nulled = 0;
	for (const r of rows) {
		const next = clean(r.v, !!requireJP);
		if (next === null) nulled++;
		else kept++;
		if (!DRY) await sql`UPDATE bot.db_characters SET ${c} = ${next} WHERE id = ${r.id}`;
	}
	grand += rows.length;
	console.log(
		`${DRY ? "[dry] " : ""}db_characters.${col}: ${rows.length} pollué(s) → ${kept} valeur conservée, ${nulled} NULL`
	);
	for (const r of rows.slice(0, 3))
		console.log(
			`   #${r.id} ${r.name}: ${JSON.stringify(r.v.slice(0, 90))} → ${JSON.stringify(clean(r.v, !!requireJP))}`
		);
}
console.log(`\n${DRY ? "[dry] " : ""}TOTAL ${grand} cellule(s) traitée(s) sur db_characters.`);
await sql.end();

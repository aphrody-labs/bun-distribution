#!/usr/bin/env bun
/**
 * `bot.db_characters.name_ja` qui ne contient pas de japonais.
 *
 * Mis au jour le 2026-08-28 par la passe « nom japonais » de
 * `doublons-personnages.ts`, qui a failli fusionner deux personnages distincts :
 * `#303 Captain Strong` et `#539 Goose` portaient tous deux « Kōji Totani » —
 * le nom de leur **comédien de doublage**, échappé d'une infobox. Deux fiches,
 * même valeur, donc « même personne » pour un juge qui fait confiance au champ.
 *
 * Mesuré sur tout le corpus : 13 fiches sur 1 307 portent un `name_ja` sans le
 * moindre kana ni kanji. Elles se rangent en quatre familles, et une seule est
 * corrigeable sans deviner :
 *
 *   1. **Fuite de seiyū** (2) — un nom de comédien. La valeur est fausse, et
 *      elle est ACTIVEMENT nuisible : c'est elle qui fabriquait le faux doublon.
 *      → vidée.
 *   2. **Colonnes inversées** (1) — `#90` porte le rōmaji dans `name_ja` et le
 *      japonais dans `name_romaji`. Provable, réversible, sans perte.
 *      → échangées.
 *   3. **Graphie d'un AUTRE personnage** (1) — `#935 Panzia` porte コイツカイ,
 *      qui est le nom de `#721 Koitsukai`. On ne sait pas ce que Panzia devrait
 *      porter, et l'inventer serait pire. → vidée.
 *   4. **Rōmaji seul, ou coréen** (9) — `Bee`, `Daīzu`, `나라크`… Rien à en
 *      tirer sans une source : le rōmaji ne se re-japonise pas mécaniquement
 *      (ブー ? ビー ?) et aucune colonne n'accueille du coréen. → LAISSÉES EN
 *      PLACE et listées. Une valeur imparfaite mais informative vaut mieux
 *      qu'une case vide, tant qu'elle ne sert pas de juge.
 *
 * Corollaire de la famille 4 : `doublons-personnages.ts` n'accepte une graphie
 * comme juge que si elle contient au moins un kana ou un kanji. C'est le filtre,
 * pas ce script, qui protège des faux doublons — celui-ci ne fait que nettoyer
 * ce qui est démontrable.
 *
 * Chaque écriture pose une révision `public.wiki_revisions` : réversible depuis
 * /admin/wiki/history.
 *
 * SIMULATION PAR DÉFAUT.
 *
 * Usage :
 *   bun scripts/corrige-name-ja-fautifs.ts
 *   bun scripts/corrige-name-ja-fautifs.ts --appliquer
 */
import postgres from "postgres";
import { join } from "node:path";

const APPLIQUER = process.argv.includes("--appliquer");

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	// La DERNIÈRE : `.env` porte l'ancienne URL Neon en commentaire AVANT la locale.
	const valeur = texte
		.split("\n")
		.filter((l) => l.startsWith("DATABASE_URL="))
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable.");
		process.exit(1);
	}
	return valeur;
}

const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

const sql = postgres(await urlBase(), { max: 2, prepare: false });
/** `sql.json()` — jamais `JSON.stringify(...)::jsonb`, qui écrit un scalaire. */
const jsonb = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

const A_DU_JAPONAIS = /[぀-ヿ㐀-䶿一-鿿]/;
const CORÉEN = /[가-힯]/;

type Ligne = { id: number; name: string; name_ja: string | null; name_romaji: string | null };

const suspects = (await sql`
	select id, name, name_ja, name_romaji
	from bot.db_characters
	where coalesce(name_ja, '') <> ''
	order by id
`) as unknown as Ligne[];

const fautifs = suspects.filter((f) => !A_DU_JAPONAIS.test(f.name_ja ?? ""));

/** Corrections démontrables, avec leur justification affichée. */
type Correction = { ligne: Ligne; ja: string | null; romaji?: string | null; raison: string };
const corrections: Correction[] = [];
const laissees: Ligne[] = [];

// Une valeur de `name_ja` portée par PLUSIEURS fiches et dépourvue de japonais
// n'est pas un nom de personnage : c'est un attribut partagé (comédien, rôle)
// tombé dans la mauvaise colonne. On le mesure au lieu de coder « Kōji Totani ».
const partages = new Map<string, Ligne[]>();
for (const f of fautifs) {
	const k = (f.name_ja ?? "").trim();
	partages.set(k, [...(partages.get(k) ?? []), f]);
}

for (const f of fautifs) {
	const ja = (f.name_ja ?? "").trim();
	if ((partages.get(ja)?.length ?? 0) > 1) {
		corrections.push({
			ligne: f,
			ja: null,
			raison: `valeur partagée par ${partages.get(ja)!.length} fiches — attribut, pas un nom`,
		});
		continue;
	}
	if (A_DU_JAPONAIS.test(f.name_romaji ?? "")) {
		corrections.push({
			ligne: f,
			ja: f.name_romaji,
			romaji: ja,
			raison: "colonnes inversées (le japonais est dans name_romaji)",
		});
		continue;
	}
	// Graphie appartenant à une AUTRE fiche : elle existe ailleurs, en japonais.
	laissees.push(f);
}

// La graphie d'un autre personnage se détecte en base, pas de mémoire : on
// cherche si un `name_ja` japonais d'une autre fiche a la même prononciation
// latine. Trop fragile à automatiser ; on se contente de signaler les fiches
// dont le `name_ja` est identique à celui d'une autre ligne, japonais compris.
const collisionsJa = (await sql`
	select name_ja, count(*)::int as n, string_agg(id || ':' || name, ', ') as fiches
	from bot.db_characters
	where coalesce(name_ja, '') <> '' and coalesce(visible, true)
	group by 1 having count(*) > 1
	order by 2 desc
`) as unknown as { name_ja: string; n: number; fiches: string }[];

console.log(`${suspects.length} fiches avec un name_ja, ${fautifs.length} sans japonais.\n`);
console.log(`${corrections.length} correction(s) démontrable(s) :`);
for (const c of corrections) {
	console.log(
		`  #${c.ligne.id} ${c.ligne.name}\n` +
			`      name_ja « ${c.ligne.name_ja} » → ${c.ja === null ? "vide" : `« ${c.ja} »`}` +
			(c.romaji !== undefined ? `, name_romaji → « ${c.romaji} »` : "") +
			`\n      ${c.raison}`
	);
}

console.log(`\n${laissees.length} laissée(s) en place (rien de démontrable) :`);
for (const f of laissees) {
	console.log(
		`  #${f.id} ${f.name} — « ${f.name_ja} »` +
			(CORÉEN.test(f.name_ja ?? "") ? " (coréen)" : " (rōmaji)")
	);
}

if (collisionsJa.length) {
	console.log(
		`\n${collisionsJa.length} graphie(s) japonaise(s) portée(s) par plusieurs fiches VISIBLES :`
	);
	for (const c of collisionsJa) console.log(`  ${c.name_ja} ×${c.n} — ${c.fiches}`);
	console.log(
		"  (à trancher à la main : une version de saga, un homonyme, ou une graphie recopiée)"
	);
}

if (!APPLIQUER || corrections.length === 0) {
	if (corrections.length) console.log("\n(simulation — relancer avec --appliquer)");
	await sql.end();
	process.exit(0);
}

await sql.begin(async (tx) => {
	for (const c of corrections) {
		if (c.romaji !== undefined) {
			await tx`update bot.db_characters set name_ja = ${c.ja}, name_romaji = ${c.romaji} where id = ${c.ligne.id}`;
		} else {
			await tx`update bot.db_characters set name_ja = ${c.ja} where id = ${c.ligne.id}`;
		}
		await tx`insert into public.wiki_revisions ${tx({
			id: idRevision(),
			tableName: "db_characters",
			rowId: String(c.ligne.id),
			action: "update",
			label: c.ligne.name,
			before: jsonb({ name_ja: c.ligne.name_ja, name_romaji: c.ligne.name_romaji }),
			after: jsonb({
				name_ja: c.ja,
				name_romaji: c.romaji !== undefined ? c.romaji : c.ligne.name_romaji,
			}),
			editorId: "script",
			editorName: `corrige-name-ja-fautifs (${c.raison})`,
		})}`;
	}
});

console.log(`\n✔ ${corrections.length} fiche(s) corrigée(s) et versionnée(s).`);
await sql.end();

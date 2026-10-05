#!/usr/bin/env bun
/**
 * Cohérence des graphies japonaises à travers le corpus des databooks.
 *
 *   bun apps/shenron/site/scripts/ja-coherence.ts --simulation [--echantillons N]
 *
 * Complète la table dakuten/handakuten de `databooks-ocr-corrections.ts` (les
 * confusions sourde/sonore, ex. `プロリー`→`ブロリー`) par l'axe orthogonal :
 * l'allongement vocalique (`ー` en trop, manquant ou déplacé — jamais une
 * substitution de caractère, cf. `src/lib/ja/coherence.ts`).
 *
 * Ce script ne fait qu'un seul mode : LA MESURE. Il applique la table fermée
 * (`corrigerCoherence`) au corpus réel et rapporte les corrections qui
 * SERAIENT faites, avec des échantillons avant/après — rien n'est jamais
 * écrit en base, ni via SQL ni via l'API. C'est un choix délibéré, pas une
 * limitation technique : contrairement aux fautes de lecture (dakuten), la
 * cohérence des graphies touche aussi des questions éditoriales (le wiki a-t-
 * il tort ? faut-il harmoniser la ponctuation ?) qui ne se tranchent pas par
 * un script.
 *
 * Le rapport a QUATRE sections, une par axe mesuré :
 *
 *   1. Allongements + résidu dans les composés — la seule section qui
 *      correspond à une VRAIE correction de texte (table fermée, vérifiée
 *      par lecture de contexte, cf. docstring du module).
 *   2. Divergences corpus ↔ wiki — jamais appliqué : les databooks sont la
 *      source primaire, mais corriger le wiki est un acte éditorial.
 *   3. Séparateurs (interpoints/espaces) — mesuré, jugé NON actionnable :
 *      la variance existe mais ressemble à une typographie légitime, comme
 *      la ponctuation `!!!`/guillemets droits déjà classée par le correcteur
 *      OCR (`databooks-ocr-corrections.ts`).
 *   4. Structure (niveaux de titre markdown) — mesuré, jugé NON actionnable :
 *      la dispersion suit surtout la catégorie de source, et 9 384/11 778
 *      planches seulement sont transcrites — on ne peut pas garantir qu'un
 *      titre de niveau 2 en tête d'ouvrage n'est pas simplement précédé d'un
 *      niveau 1 sur une planche pas encore transcrite.
 *
 * Prérequis : `bun apps/shenron/site/scripts/ja-preparer.ts` (JMdict, pour la section
 * ponctuation/structure qui n'en a en fait pas besoin — seule la
 * régénération des candidats, non incluse ici, en aurait besoin).
 */
import postgres from "postgres";
import {
	ALLONGEMENTS_ECARTES,
	DIVERGENCES_CORPUS_WIKI,
	VARIANTES_ALLONGEMENT,
	VARIANTES_COMPOSEES,
	corrigerCoherence,
} from "../src/lib/ja/coherence";

function argument(nom: string): string | undefined {
	const i = process.argv.indexOf(`--${nom}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (nom: string) => process.argv.includes(`--${nom}`);

if (!flag("simulation")) {
	console.error(
		"erreur : ce script ne fait QUE mesurer. Lancer avec --simulation.\n" +
			"(il n'existe pas de mode d'écriture : cf. docstring du fichier.)"
	);
	process.exit(2);
}
const N_ECHANTILLONS = Number(argument("echantillons") ?? 4);

async function lireEnv(cle: string): Promise<string | undefined> {
	const contenu = await Bun.file(new URL("../.env", import.meta.url)).text();
	return contenu
		.split("\n")
		.filter((l) => l.startsWith(`${cle}=`))
		.pop() // dernière ligne qui matche : la ligne Neon commentée précède la locale
		?.slice(cle.length + 1)
		.replace(/^"|"$/g, "")
		.trim();
}
const DATABASE_URL = await lireEnv("DATABASE_URL");
if (!DATABASE_URL) throw new Error("DATABASE_URL introuvable dans apps/shenron/site/.env");
const sql = postgres(DATABASE_URL, { max: 2 });

interface Planche {
	id: number;
	titre: string;
	category: string;
	numero: number;
	texte: string;
}

console.log("· lecture des transcriptions…");
const planches = await sql<Planche[]>`
	SELECT d.id, d.title AS titre, d.category, (p ->> 'number')::int AS numero, p ->> 'text' AS texte
	FROM bot.db_databooks d, LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END
	) p
	WHERE nullif(btrim(p ->> 'text'), '') IS NOT NULL
	ORDER BY d.id, numero
`;
console.log(
	`  ${planches.length} planche(s) transcrite(s), ${new Set(planches.map((p) => p.id)).size} ouvrage(s)\n`
);

// ---------------------------------------------------------------------------
// 1. Allongements + composés — la table appliquée au corpus réel.
// ---------------------------------------------------------------------------
console.log("=".repeat(78));
console.log("1. ALLONGEMENTS VOCALIQUES + RÉSIDU DANS LES COMPOSÉS");
console.log("=".repeat(78));
console.log(
	`table fermée : ${VARIANTES_ALLONGEMENT.length} variante(s) d'allongement, ${VARIANTES_COMPOSEES.length} variante(s) étendue(s) aux composés`
);
console.log(`variantes mesurées puis écartées (preuve gardée) : ${ALLONGEMENTS_ECARTES.length}`);
for (const e of ALLONGEMENTS_ECARTES) console.log(`  - ${e.lu} → ${e.cible} écarté : ${e.raison}`);

interface Modif {
	planche: Planche;
	texteCorrige: string;
	allongements: { lu: string; correct: string; n: number }[];
	composes: { lu: string; correct: string; n: number }[];
}
const modifs: Modif[] = [];
const totalParEntree = new Map<string, { correct: string; n: number; ouvrages: Set<number> }>();

for (const p of planches) {
	const { texte, modifie, allongements, composes } = corrigerCoherence(p.texte);
	if (!modifie) continue;
	modifs.push({ planche: p, texteCorrige: texte, allongements, composes });
	for (const { lu, correct, n } of [...allongements, ...composes]) {
		const acc = totalParEntree.get(lu) ?? { correct, n: 0, ouvrages: new Set<number>() };
		acc.n += n;
		acc.ouvrages.add(p.id);
		totalParEntree.set(lu, acc);
	}
}

console.log(`\nplanches touchées : ${modifs.length} / ${planches.length}`);
console.log(`\npar graphie (${totalParEntree.size} distinctes) :`);
for (const [lu, v] of [...totalParEntree.entries()].toSorted((a, b) => b[1].n - a[1].n)) {
	console.log(
		`  ${String(v.n).padStart(4)}×  ${lu.padEnd(16)} → ${v.correct.padEnd(14)} (${v.ouvrages.size} ouvrage(s))`
	);
}

if (N_ECHANTILLONS > 0 && modifs.length > 0) {
	console.log(`\n— échantillons avant/après (${Math.min(N_ECHANTILLONS, modifs.length)}) —`);
	const pas = Math.max(1, Math.floor(modifs.length / N_ECHANTILLONS));
	for (let i = 0; i < modifs.length; i += pas) {
		const m = modifs[i];
		// Centré sur la première graphie corrigée, pas sur le début de la
		// planche : sinon la correction tombe souvent hors de la fenêtre affichée.
		const premiereLu = [...m.allongements, ...m.composes][0]?.lu ?? "";
		const idx = premiereLu ? m.planche.texte.indexOf(premiereLu) : -1;
		const debut = Math.max(0, idx - 60);
		console.log(`\n[#${m.planche.id} "${m.planche.titre}" p.${m.planche.numero}]`);
		console.log(`  avant : …${m.planche.texte.slice(debut, debut + 200).replace(/\n/g, "⏎")}…`);
		console.log(`  après : …${m.texteCorrige.slice(debut, debut + 200).replace(/\n/g, "⏎")}…`);
	}
}

// ---------------------------------------------------------------------------
// 2. Divergences corpus ↔ wiki — jamais appliqué.
// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(78)}`);
console.log("2. DIVERGENCES CORPUS ↔ WIKI (informationnel — jamais appliqué)");
console.log("=".repeat(78));
const parNature = new Map<string, typeof DIVERGENCES_CORPUS_WIKI>();
for (const d of DIVERGENCES_CORPUS_WIKI)
	parNature.set(d.nature, [...(parNature.get(d.nature) ?? []), d]);
for (const [nature, ds] of parNature) {
	console.log(`\n${nature} (${ds.length}) :`);
	for (const d of ds) {
		console.log(
			`  ${d.formeWiki.padEnd(20)} (wiki: ${d.occWiki}×)  vs  ${d.formeCorpus.padEnd(16)} (corpus: ${d.occCorpus}×)  [${d.fr}]`
		);
	}
}
console.log(
	"\nVerdict : ces cas ne sont PAS corrigés ici. Les « wiki-bug-espacement » et\n" +
		"« wiki-choonpu-superflu » sont des candidats solides pour une correction\n" +
		"éditoriale du wiki (via /admin ou dbfr-wiki) ; le cas « ambigu » n'a pas de\n" +
		"verdict possible sur la seule fréquence."
);

// ---------------------------------------------------------------------------
// 3. Séparateurs — mesuré, jugé NON actionnable.
// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(78)}`);
console.log("3. SÉPARATEURS (interpoint ・, espace) — mesuré, non actionnable");
console.log("=".repeat(78));
const CAS_SEPARATEURS: { avec: string; sans: string; fr: string }[] = [
	{ avec: "ドクター・ゲロ", sans: "ドクターゲロ", fr: "Android 20 / Dr. Gero" },
	{ avec: "ミスター・サタン", sans: "ミスターサタン", fr: "Mr. Satan" },
	{ avec: "ジャッキー・チュン", sans: "ジャッキーチュン", fr: "Jackie Chun" },
	{ avec: "ドクター・ミュー", sans: "ドクターミュー", fr: "Dr Mu" },
];
function compterBrut(mot: string): { occ: number; ouvrages: Set<number> } {
	let occ = 0;
	const ouvrages = new Set<number>();
	for (const p of planches) {
		let from = 0;
		while (true) {
			const idx = p.texte.indexOf(mot, from);
			if (idx === -1) break;
			occ++;
			ouvrages.add(p.id);
			from = idx + mot.length;
		}
	}
	return { occ, ouvrages };
}
for (const c of CAS_SEPARATEURS) {
	const avec = compterBrut(c.avec);
	const sans = compterBrut(c.sans);
	console.log(
		`  ${c.avec.padEnd(18)} (${avec.occ}×, ${avec.ouvrages.size} ouv.)  vs  ${c.sans.padEnd(16)} (${sans.occ}×, ${sans.ouvrages.size} ouv.)  [${c.fr}]`
	);
}
console.log(
	"\nVerdict : la forme avec séparateur domine dans les 4 cas, mais la forme sans\n" +
		"reste substantielle (14 à 51 ouvrages distincts pour la forme sans, selon le\n" +
		"cas) — trop répandue et trop régulière pour être une faute isolée. Traité en\n" +
		"amont comme une variance typographique légitime par `normaliserJa()` (déjà\n" +
		"utilisée pour la RECHERCHE/l'appariement), pas comme un défaut du texte à\n" +
		"corriger — cohérent avec la conclusion du correcteur OCR sur la ponctuation\n" +
		"(`!!!`, guillemets droits). Aucune règle de correction n'est proposée ici."
);

// ---------------------------------------------------------------------------
// 4. Structure (niveaux de titre) — mesuré, jugé NON actionnable.
// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(78)}`);
console.log("4. STRUCTURE — niveaux de titre markdown, par catégorie");
console.log("=".repeat(78));
interface Ouvrage {
	id: number;
	titre: string;
	category: string;
	pages: { number: number; text: string | null }[];
}
const ouvragesRaw = await sql<{ id: number; titre: string; category: string; pages: unknown }[]>`
	SELECT id, title AS titre, category, pages FROM bot.db_databooks WHERE pages IS NOT NULL
`;
const ouvrages: Ouvrage[] = ouvragesRaw.map((r) => ({
	id: r.id,
	titre: r.titre,
	category: r.category,
	pages: (Array.isArray(r.pages) ? r.pages : []) as { number: number; text: string | null }[],
}));
function premierNiveau(pages: { number: number; text: string | null }[]): number | "aucun" {
	const tri = pages.filter((p) => p.text && p.text.trim()).toSorted((a, b) => a.number - b.number);
	for (const p of tri) {
		const m = p.text!.match(/^(#{1,6})[ \t]/m);
		if (m) return m[1].length;
	}
	return "aucun";
}
const parCategorie = new Map<string, Map<number | "aucun", number>>();
for (const o of ouvrages) {
	if (!o.pages.some((p) => p.text && p.text.trim())) continue;
	const premier = premierNiveau(o.pages);
	const cat = o.category ?? "?";
	const acc = parCategorie.get(cat) ?? new Map<number | "aucun", number>();
	acc.set(premier, (acc.get(premier) ?? 0) + 1);
	parCategorie.set(cat, acc);
}
console.log(
	"niveau du PREMIER titre de l'ouvrage (planche transcrite la plus basse), par catégorie :"
);
for (const [cat, acc] of parCategorie) {
	const total = [...acc.values()].reduce((a, b) => a + b, 0);
	const parts = [...acc.entries()]
		.toSorted((a, b) => b[1] - a[1])
		.map(([k, v]) => `${k === "aucun" ? "aucun" : `niveau ${k}`}:${v}`);
	console.log(`  ${cat.padEnd(24)} (${total} ouv.)  ${parts.join("  ")}`);
}
console.log(
	"\nVerdict : la grande majorité ouvre au niveau 1 (ex. 152/165 V-Jump). La\n" +
		"minorité au niveau 2 (~25/248 au total) N'EST PAS harmonisée ici : 9 384 des\n" +
		"11 778 planches seulement sont transcrites, donc « premier titre trouvé »\n" +
		"n'est pas forcément « premier titre du livre » — une planche antérieure non\n" +
		"encore transcrite peut porter le vrai niveau 1. Décaler les niveaux sans\n" +
		"cette garantie serait une harmonisation qui SEMBLE mécanique mais n'est pas\n" +
		"prouvée non destructive."
);

// ---------------------------------------------------------------------------
// 5. Ponctuation ASCII vs pleine chasse — mesuré, décision éditoriale.
// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(78)}`);
console.log("5. PONCTUATION ASCII VS PLEINE CHASSE (!/？, guillemets) — décision éditoriale");
console.log("=".repeat(78));
let totalAscii = 0;
let totalPleine = 0;
let planchesAsciiOnly = 0;
let planchesPleineOnly = 0;
let planchesMixtes = 0;
let totalGuillemetsDroits = 0;
let totalGuillemetsJa = 0;
for (const p of planches) {
	const nAscii = (p.texte.match(/[!?]/g) ?? []).length;
	const nPleine = (p.texte.match(/[！？]/g) ?? []).length;
	totalAscii += nAscii;
	totalPleine += nPleine;
	if (nAscii > 0 && nPleine > 0) planchesMixtes++;
	else if (nAscii > 0) planchesAsciiOnly++;
	else if (nPleine > 0) planchesPleineOnly++;
	totalGuillemetsDroits += (p.texte.match(/["]/g) ?? []).length;
	totalGuillemetsJa += (p.texte.match(/[「」]/g) ?? []).length;
}
console.log(`occurrences !/? ASCII ....... ${totalAscii.toLocaleString("fr-FR")}`);
console.log(`occurrences ！/？ pleine ..... ${totalPleine.toLocaleString("fr-FR")}`);
console.log(`planches ASCII seul ......... ${planchesAsciiOnly}`);
console.log(`planches pleine chasse seul . ${planchesPleineOnly}`);
console.log(`planches mixtes ............. ${planchesMixtes}`);
console.log(`\noccurrences guillemets droits " . ${totalGuillemetsDroits.toLocaleString("fr-FR")}`);
console.log(`occurrences guillemets 「」 ...... ${totalGuillemetsJa.toLocaleString("fr-FR")}`);
console.log(
	"\nVerdict : le corpus penche massivement ASCII pour !/? (environ 90 % des\n" +
		"occurrences, ~85 % des planches tranchées) — c'est le stock historique,\n" +
		"largement majoritaire. Les guillemets, à l'inverse, sont déjà à 93 % au\n" +
		"format japonais 「」 : cette dimension n'a pas besoin d'arbitrage. Pour\n" +
		"!/?, harmoniser le stock existant vers la pleine chasse toucherait la\n" +
		"majorité du corpus (des dizaines de milliers d'occurrences) ; harmoniser\n" +
		"les lots récents vers l'ASCII en toucherait beaucoup moins. AUCUNE des\n" +
		"deux directions n'est appliquée ici : c'est une décision de politique\n" +
		"éditoriale (uniformité vs fidélité aux conventions d'origine par source),\n" +
		"pas un défaut factuel — elle revient au propriétaire."
);

await sql.end();
console.log("\n(mesure seule : rien n'a été écrit — ni en base, ni via l'API.)");

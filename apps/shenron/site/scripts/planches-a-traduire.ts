#!/usr/bin/env bun
/**
 * File de TRADUCTION des planches de databook : japonais → français.
 *
 *   bun apps/shenron/site/scripts/planches-a-traduire.ts --compte
 *   bun apps/shenron/site/scripts/planches-a-traduire.ts --lot 40 --json /tmp/lot-01.json
 *   bun apps/shenron/site/scripts/planches-a-traduire.ts --databook 4 --pages 41-80 --json …
 *
 * Ce que le script garantit, et qui n'est pas négociable :
 *
 * 1. **Seules les planches saines sortent.** `classerDefaut` (le juge unique du
 *    corpus) écarte les transcriptions hallucinées : traduire une hallucination
 *    la blanchit en la rendant lisible, c'est le pire résultat possible.
 *    S'y ajoute `intraduisible()`, trois signatures que le juge du corpus ne
 *    connaît pas et que les traducteurs de la première passe ont dû écarter
 *    À LA MAIN, après lecture — donc après avoir payé la lecture. Mesuré :
 *    2 131 planches sur 9 356, soit 23 % du travail restant, économisées sans
 *    perdre une seule planche traduisible.
 * 2. **Seules les planches japonaises sortent** (au moins un kana) : les pages
 *    de crédits, ISBN et sommaires latins n'ont rien à traduire.
 * 3. **Le lexique du domaine voyage avec le lot.** Sans lui, un traducteur rend
 *    `界王拳` par « le poing du roi » et `ベジータ` par « Végitta » — mesuré.
 *    Le lot ne porte que les termes RÉELLEMENT présents dans ses planches, pour
 *    ne pas payer 4 000 entrées de lexique par lot.
 *
 *    L'appariement de ces termes est **tolérant**, et il a fallu une passe ratée
 *    pour le comprendre : cherchée à l'identique, la graphie de la base ne
 *    retrouve pas celle de la planche. La base écrit `ターレス` (Tullece), l'OCR
 *    a lu `タレス` — l'allongement manque, `includes` échoue, le terme sort du
 *    lexique du lot, et le traducteur, laissé sans forme officielle, rend
 *    « Tarles » à l'oreille. Même mécanique pour `ダーブラ`, qui n'existe en base
 *    qu'enrobé (`未来のダーブラ`, `ダーブラ：ゼノ`) et ressortait « Dâburâ ».
 *    On apparie donc sur une forme repliée (sans allongement, sans point médian,
 *    sans qualificatif de désambiguïsation) et on remonte au traducteur LES DEUX
 *    graphies : celle de la base et celle que porte réellement sa planche.
 * 4. **Les lots ne se recouvrent pas.** `--decalage` découpe la file d'un même
 *    appel, mais la file RÉTRÉCIT à mesure que les traductions se déposent :
 *    deux agents parallèles finiraient par se marcher dessus. `--pages 41-80`
 *    borne sur les numéros de planche, qui eux ne bougent pas — c'est la forme
 *    à employer dès qu'il y a plus d'un traducteur.
 *
 * Reprise : une planche déjà traduite (`text_fr` non vide dans le jsonb) ne
 * ressort jamais. Relancer après une interruption reprend là où on s'est arrêté.
 * `--retraduire` lève ce filtre, pour reprendre une planche dont le contrôle a
 * montré qu'elle avait été mal rendue.
 */
import { classerDefaut } from "../src/lib/databooks-defauts";
import { intraduisible, noyaux, replier } from "../src/lib/databooks-traduction";
import { trierLexique, type TermeLexique } from "../src/lib/ja/anomalies";
import { contientJaponais } from "../src/lib/ja/normalisation";
import { connecte } from "./_databooks-base";

const args = process.argv.slice(2);
const flag = (nom: string) => args.includes(`--${nom}`);
const opt = (nom: string, def?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i >= 0 ? (args[i + 1] ?? def) : def;
};

const KANA = /[぀-ヿ]/;
const SHARDS = Math.max(1, Number(opt("shards", "1")) || 1);
const SHARD_INDEX = Math.max(0, Math.min(SHARDS - 1, Number(opt("shard-index", "0")) || 0));
const EXCLUDE_FILE = opt("exclure");

const exclusions = new Set<string>();
if (EXCLUDE_FILE) {
	const raw = await Bun.file(EXCLUDE_FILE).text().catch(() => "");
	for (const line of raw.split(/\r?\n/)) if (line.trim()) exclusions.add(line.trim());
}

/** Partition stable : plusieurs workers ne reprennent jamais la même planche. */
function appartientAuShard(databookId: string | number, page: number): boolean {
	let hash = 2166136261;
	for (const char of `${databookId}:${page}`) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash % SHARDS === SHARD_INDEX;
}

// Utilise la résolution canonique (tunnel local, REMOTE_DATABASE_URL ou .env)
// au lieu de relire directement l'ancien fichier apps/shenron/site/.env.
const sql = await connecte();

interface PlancheBrute {
	databook_id: string | number;
	titre: string;
	page: number;
	texte: string;
	traduite: boolean;
	/** Planche acquittée à la main : les signatures de défaut ne la retiennent plus. */
	verifiee: boolean;
}

try {
	const cibleId = Number(opt("databook") ?? 0) || 0;
	const categorie = opt("categorie");

	const brutes = await sql<PlancheBrute[]>`
		SELECT d.id AS databook_id,
		       d.title AS titre,
		       (e.value->>'number')::int AS page,
		       coalesce(e.value->>'text', '') AS texte,
		       coalesce(length(trim(coalesce(e.value->>'text_fr', ''))), 0) > 0 AS traduite,
		       coalesce(e.value->>'verifiee', 'false') = 'true' AS verifiee
		FROM bot.db_databooks d, jsonb_array_elements(d.pages) e
		WHERE (${cibleId} = 0 OR d.id = ${cibleId})
		  AND (${categorie ?? null}::text IS NULL OR d.category = ${categorie ?? null})
		ORDER BY d.id, (e.value->>'number')::int
	`;

	// Le filtrage tient en JS parce que le juge des défauts y vit : le refaire en
	// SQL, c'est fabriquer un second juge qui divergera du premier (et la boucle
	// ne se détecte de toute façon pas en SQL en un temps raisonnable).
	const retraduire = flag("retraduire");
	const laxiste = flag("sans-filtre-etendu");
	const eligibles = brutes.filter(
		(p) =>
			(retraduire || !p.traduite) &&
			!exclusions.has(`${p.databook_id}:${p.page}`) &&
			KANA.test(p.texte) &&
			// Une planche relue à l'image est saine par décision humaine : la
			// garder hors du lot reviendrait à faire confiance au détecteur
			// contre le relecteur qui vient de comparer texte et scan.
			(p.verifiee || classerDefaut(p.texte) === null) &&
			(laxiste || intraduisible(p.texte) === null)
	);

	if (flag("compte")) {
		const par = new Map<string, { titre: string; reste: number; faites: number; signes: number }>();
		for (const p of brutes) {
			const cle = String(p.databook_id);
			const e = par.get(cle) ?? { titre: p.titre, reste: 0, faites: 0, signes: 0 };
			if (p.traduite) e.faites++;
			else if (
				KANA.test(p.texte) &&
				(p.verifiee || classerDefaut(p.texte) === null) &&
				intraduisible(p.texte) === null
			) {
				e.reste++;
				e.signes += p.texte.length;
			}
			par.set(cle, e);
		}
		const lignes = [...par.entries()]
			.filter(([, e]) => e.reste > 0 || e.faites > 0)
			.toSorted((a, b) => b[1].reste - a[1].reste);
		for (const [id, e] of lignes) {
			console.log(
				`${id.padStart(4)}  reste ${String(e.reste).padStart(4)}  faites ${String(e.faites).padStart(4)}  ${String(Math.round(e.signes / 1000)).padStart(4)} k signes  ${e.titre}`
			);
		}
		const reste = lignes.reduce((n, [, e]) => n + e.reste, 0);
		const faites = lignes.reduce((n, [, e]) => n + e.faites, 0);
		const signes = lignes.reduce((n, [, e]) => n + e.signes, 0);
		console.log(
			`\n${reste} planches à traduire, ${faites} déjà traduites, ${Math.round(signes / 1000)} k signes japonais restants.`
		);
		process.exit(0);
	}

	const plage = opt("pages");
	let candidates = eligibles;
	if (SHARDS > 1) {
		candidates = candidates.filter((p) => appartientAuShard(p.databook_id, p.page));
	}
	if (plage) {
		const m = /^(\d+)-(\d+)$/.exec(plage);
		if (!m) throw new Error(`--pages attend « début-fin » (reçu « ${plage} »)`);
		const [debut, fin] = [Number(m[1]), Number(m[2])];
		candidates = eligibles.filter((p) => p.page >= debut && p.page <= fin);
	}
	const taille = Number(opt("lot", "40"));
	const decalage = Number(opt("decalage", "0"));
	const tranche = candidates.slice(decalage, decalage + taille);
	if (tranche.length === 0) {
		console.error("aucune planche à traduire pour ces critères.");
		process.exit(3);
	}

	// Lexique du domaine : la base porte, sur la même ligne, la graphie japonaise
	// et la forme française officielle. C'est elle qui fait autorité, pas l'oreille
	// du traducteur.
	const brutLex = await sql<{ ja: string; fr: string; kind: string }[]>`
		SELECT name_ja AS ja, name AS fr, 'personnage' AS kind FROM bot.db_characters WHERE name_ja IS NOT NULL
		UNION ALL SELECT name_ja, name, 'planete'        FROM bot.db_planets         WHERE name_ja IS NOT NULL
		UNION ALL SELECT name_ja, name, 'race'           FROM bot.db_races           WHERE name_ja IS NOT NULL
		UNION ALL SELECT name_ja, name, 'saga'           FROM bot.db_sagas           WHERE name_ja IS NOT NULL
		UNION ALL SELECT name_ja, name, 'technique'      FROM bot.db_techniques      WHERE name_ja IS NOT NULL
	`;
	const vus = new Set<string>();
	const termes: TermeLexique[] = [];
	for (const l of brutLex) {
		for (const v of String(l.ja).split(/[,、;]/)) {
			const ja = v
				.trim()
				.replace(/^[（(]+|[）)]+$/g, "")
				.trim();
			if (ja.length < 2 || !contientJaponais(ja) || vus.has(ja)) continue;
			vus.add(ja);
			termes.push({
				ja,
				fr: String(l.fr ?? "")
					.replace(/\s*\([^)]*\)\s*$/, "")
					.trim(),
				kind: l.kind,
			});
		}
	}
	const tries = trierLexique(termes);
	const corpus = tranche.map((p) => p.texte).join("\n");
	const corpusReplie = replier(corpus);

	// Ne descend dans le lot que ce que le lot contient : sur 4 000 entrées, une
	// vingtaine sert, et un lexique qu'on ne relit pas est un lexique ignoré.
	const utiles: { ja: string; fr: string; kind: string; dansLaPlanche?: string }[] = [];
	const retenus = new Set<string>();
	for (const t of tries) {
		if (retenus.has(t.fr)) continue;
		for (const forme of noyaux(t.ja)) {
			if (forme.length < 2) continue;
			if (corpus.includes(forme)) {
				utiles.push({ ja: t.ja, fr: t.fr, kind: t.kind });
				retenus.add(t.fr);
				break;
			}
			// Appariement replié : la planche porte une graphie que l'OCR a rabotée.
			// On remonte la graphie RÉELLE de la planche, sans quoi le traducteur
			// chercherait dans son texte un terme qui ne s'y trouve pas.
			const cible = replier(forme);
			if (cible.length < 2 || !corpusReplie.includes(cible)) continue;
			const trouve = new RegExp(`${[...cible].map((c) => `${c}ー?`).join("[・･·]?")}`).exec(corpus);
			utiles.push({ ja: t.ja, fr: t.fr, kind: t.kind, dansLaPlanche: trouve?.[0] ?? undefined });
			retenus.add(t.fr);
			break;
		}
	}

	const sortie = {
		planches: tranche.map((p) => ({
			databookId: Number(p.databook_id),
			page: p.page,
			titre: p.titre,
			texte: p.texte,
		})),
		lexique: utiles,
		reste: candidates.length,
	};

	const chemin = opt("json");
	if (chemin) {
		await Bun.write(chemin, JSON.stringify(sortie, null, "\t"));
		const signes = tranche.reduce((n, p) => n + p.texte.length, 0);
		console.log(
			`${tranche.length} planches (${signes} signes) + ${utiles.length} termes de lexique → ${chemin}`
		);
		console.log(
			`(${candidates.length} planches éligibles pour ces critères, ${eligibles.length} sur tout l'ouvrage)`
		);
	} else {
		console.log(JSON.stringify(sortie, null, "\t"));
	}
} catch (e) {
	console.error(`✗ ${(e as Error).message}`);
	process.exitCode = 1;
} finally {
	await sql.end();
}

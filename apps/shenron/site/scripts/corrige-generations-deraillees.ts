#!/usr/bin/env bun
/**
 * Correcteur des **générations qui ont déraillé** dans les transcriptions de
 * databooks.
 *
 * Applique les modules purs de nettoyage OCR (boucles dégénérées et artefacts
 * de formatage) sur `bot.db_databooks`, puis dépose le résultat dans une
 * transaction PostgreSQL chirurgicale, avec une révision par planche dans
 * `public.wiki_revisions`, donc réversible depuis /admin/wiki/history.
 *
 * Jumeau de `corrige-transcriptions-ocr.ts`, dont il partage les conventions
 * (mêmes modes et lecture de la base) mais **pas** les règles :
 * les deux runners visent des familles de défauts disjointes et peuvent tourner
 * l'un après l'autre dans n'importe quel ordre.
 *
 * Modes (un seul requis) :
 *   --simulation            n'écrit rien, imprime un rapport chiffré + diffs
 *   --appliquer             dépose les corrections dans PostgreSQL
 *
 * Filtres :
 *   --fiche <id>            une seule fiche (databook id)
 *   --limite N              limite le nombre de PLANCHES examinées
 *   --echantillons N        nombre de diffs affichés (défaut 5)
 *
 * ## Le garde-fou des 50 %, et la seule voie qui le franchit
 *
 * `corrige-transcriptions-ocr.ts` écarte toute planche dont le texte corrigé
 * ferait moins de 50 % de l'original : aucune de ses règles n'est censée faire
 * disparaître autant de matière. Ici, **c'est le cas normal** — une planche de
 * 8 168 signes dont 8 120 sont « ？！ » répété doit tomber à 50 signes, et
 * perdre 99 % du texte EST la correction.
 *
 * Le garde reste donc actif et nominatif : il n'est franchi que si **toutes**
 * les règles qui ont agi appartiennent à `REGLES_BOUCLE_DEGENEREE` ou à la
 * liste fermée d'artefacts de formatage sûrs
 * (cf. `EXCEPTION_BOUCLE_DEGENEREE` plus bas). Toute autre coupe massive —
 * qui ne pourrait venir que d'une règle ajoutée plus tard sans y penser — est
 * écartée et listée pour relecture humaine, exactement comme dans l'autre
 * runner.
 *
 * ## Ce qu'une planche corrigée devient
 *
 * Rien ne disparaît : une planche vidée de sa boucle garde son préfixe lu, et
 * `classerDefaut` (`src/lib/databooks-defauts.ts`) la reclasse toute seule.
 * Si le préfixe est trop court ou porte encore une signature d'échec, elle
 * repart dans la file de `scripts/planches-a-relire.ts`. Le rapport les liste
 * nommément pour qu'aucune ne se perde.
 *
 * **Avant tout `--appliquer` en production, prendre un dump de
 * `bot.db_databooks`**. Chaque planche est protégée par comparaison avec le
 * texte lu avant correction : une modification concurrente est refusée.
 */
import postgres from "postgres";
import {
	REGLES_BOUCLE_DEGENEREE,
	corrigerGenerationsDeraillees,
	type BoucleDetectee,
} from "../src/lib/databooks-ocr/generations-deraillees";
import { corrigerArtefactsModele } from "../src/lib/databooks-ocr/artefacts-modele";
import { corrigerSosiesEtIntrusions } from "../src/lib/databooks-ocr/sosies-intrusions";
import { SEUIL_COURT, classerDefaut } from "../src/lib/databooks-defauts";

const args = process.argv.slice(2);
const flag = (nom: string) => args.includes(`--${nom}`);
const opt = (nom: string): string | undefined => {
	const i = args.indexOf(`--${nom}`);
	return i >= 0 ? args[i + 1] : undefined;
};

const SIMULATION = flag("simulation");
const APPLIQUER = flag("appliquer");
const FICHE = opt("fiche") ? Number(opt("fiche")) : null;
const LIMITE = opt("limite") ? Number(opt("limite")) : null;
const N_ECHANTILLONS = Number(opt("echantillons") ?? 5);

if (SIMULATION === APPLIQUER) {
	console.error("erreur : il faut choisir exactement un mode, --simulation OU --appliquer.");
	process.exit(2);
}

/** Dernière ligne qui matche : le `.env` a une ligne Neon commentée AVANT la locale. */
async function lireEnv(cle: string): Promise<string | undefined> {
	if (cle === "DATABASE_URL" && process.env.DATABASE_URL?.trim()) {
		return process.env.DATABASE_URL.trim();
	}
	const contenu = await Bun.file(new URL("../.env", import.meta.url))
		.text()
		.catch(() => "");
	const local = contenu
		.split("\n")
		.filter((l) => l.startsWith(`${cle}=`))
		.pop()
		?.slice(cle.length + 1)
		.replace(/^"|"$/g, "")
		.trim();
	if (local) return local;
	if (cle === "DATABASE_URL") {
		const distant = await Bun.file(".env.remote-db")
			.text()
			.catch(() => "");
		return distant
			.split("\n")
			.filter((l) => l.startsWith("REMOTE_DATABASE_URL="))
			.pop()
			?.slice("REMOTE_DATABASE_URL=".length)
			.replace(/^"|"$/g, "")
			.trim();
	}
	return undefined;
}

const DATABASE_URL = await lireEnv("DATABASE_URL");
if (!DATABASE_URL) throw new Error("DATABASE_URL introuvable dans apps/shenron/site/.env");
const sql = postgres(DATABASE_URL, { max: 2 });

interface Planche {
	id: number;
	titre: string;
	numero: number;
	texte: string;
}

console.log("· lecture des transcriptions…");
const planches = await sql<Planche[]>`
	SELECT d.id, d.title AS titre, (p ->> 'number')::int AS numero, p ->> 'text' AS texte
	FROM bot.db_databooks d, LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END
	) p
	WHERE nullif(btrim(p ->> 'text'), '') IS NOT NULL
	${FICHE !== null ? sql`AND d.id = ${FICHE}` : sql``}
	ORDER BY d.id, numero
	${LIMITE !== null ? sql`LIMIT ${LIMITE}` : sql``}
`;
console.log(
	`  ${planches.length} planche(s) examinée(s)${FICHE !== null ? ` (fiche #${FICHE})` : ""}\n`
);
if (planches.length === 0) {
	console.log("rien à faire.");
	await sql.end();
	process.exit(0);
}

// ---------------------------------------------------------------------------
// Correction
// ---------------------------------------------------------------------------

const SEUIL_SECURITE_LONGUEUR = 0.5;

interface Modification {
	planche: Planche;
	texteCorrige: string;
	regles: Array<{ code: string; corrections: number }>;
	coupes: BoucleDetectee[];
	ratio: number;
	/** Le garde-fou des 50 % a-t-il été franchi par la voie nommée ? */
	exception: boolean;
}

/**
 * **La voie explicite.** Une planche peut passer sous les 50 % de sa longueur
 * d'origine si, et seulement si, toutes les règles qui ont agi sur elle sont
 * des règles de boucle dégénérée — les seules dont on ait prouvé que la
 * matière retirée est du texte que le modèle a inventé, pas du texte lu.
 *
 * Écrit comme un prédicat nommé plutôt qu'en désactivant le garde : le jour où
 * une règle est ajoutée à ce module, elle ne franchira le garde que si on
 * l'inscrit sciemment dans `REGLES_BOUCLE_DEGENEREE`.
 */
function EXCEPTION_BOUCLE_DEGENEREE(regles: Array<{ code: string; corrections: number }>): boolean {
	const agissantes = regles.filter((r) => r.corrections > 0);
	const artefactsSurs = new Set([
		"json-brut",
		"entite-html",
		"balise-html",
		"echappement-litteral",
		"echappement-repete",
		"marqueur-page",
		"remplacement-terminal",
	]);
	return (
		agissantes.length > 0 &&
		agissantes.every((r) => REGLES_BOUCLE_DEGENEREE.has(r.code) || artefactsSurs.has(r.code))
	);
}

const modifications: Modification[] = [];
const ecartesSecurite: {
	planche: Planche;
	ratio: number;
	regles: Array<{ code: string; corrections: number }>;
}[] = [];
const totauxParRegle = new Map<string, { planches: number; corrections: number }>();

for (const p of planches) {
	const artefacts = corrigerArtefactsModele(p.texte);
	const sosies = corrigerSosiesEtIntrusions(artefacts.texte);
	const generations = corrigerGenerationsDeraillees(sosies.texte);
	const texte = generations.texte;
	const modifie = artefacts.modifie || sosies.texte !== artefacts.texte || generations.modifie;
	const rapport = [...artefacts.rapport, ...sosies.rapport, ...generations.rapport];
	const coupes = generations.coupes;
	if (!modifie) continue;

	for (const r of rapport) {
		if (r.corrections === 0) continue;
		const acc = totauxParRegle.get(r.code) ?? { planches: 0, corrections: 0 };
		acc.planches++;
		acc.corrections += r.corrections;
		totauxParRegle.set(r.code, acc);
	}

	const ratio = p.texte.length > 0 ? texte.length / p.texte.length : 1;
	const exception = EXCEPTION_BOUCLE_DEGENEREE(rapport);
	if (ratio < SEUIL_SECURITE_LONGUEUR && !exception) {
		ecartesSecurite.push({ planche: p, ratio, regles: rapport });
		continue;
	}
	modifications.push({
		planche: p,
		texteCorrige: texte,
		regles: rapport,
		coupes,
		ratio,
		exception,
	});
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

const LIBELLES: Record<string, string> = {
	"json-brut": "Sérialisation JSON du modèle",
	"entite-html": "Entité HTML doublement échappée",
	"balise-html": "Balisage HTML survivant",
	"echappement-litteral": "Saut de ligne littéral",
	"enumeration-hangul": "Compteur cerclé passé en hangul",
	"boucle-degeneree": "Boucle dégénérée (motif répété en rafale)",
	"bloc-hallucine-repete": "Pavé halluciné recollé sous chaque titre",
};

console.log("=".repeat(78));
console.log("RÈGLES");
console.log("=".repeat(78));
for (const [code, libelle] of Object.entries(LIBELLES)) {
	const acc = totauxParRegle.get(code);
	console.log(
		`${libelle.padEnd(46)} ${String(acc?.planches ?? 0).padStart(5)} planche(s)  ${String(acc?.corrections ?? 0).padStart(6)} coupe(s)`
	);
}
const parException = modifications.filter((m) => m.ratio < SEUIL_SECURITE_LONGUEUR);
console.log(`\nplanches modifiées : ${modifications.length} / ${planches.length}`);
console.log(
	`  dont sous les ${Math.round(SEUIL_SECURITE_LONGUEUR * 100)} % de la longueur d'origine, admises par EXCEPTION_BOUCLE_DEGENEREE : ${parException.length}`
);
if (ecartesSecurite.length > 0) {
	console.log(
		`\n⚠ ${ecartesSecurite.length} planche(s) ÉCARTÉE(S) par le garde-fou (hors voie d'exception) — À RELIRE :`
	);
	for (const e of ecartesSecurite) {
		console.log(
			`  #${e.planche.id} "${e.planche.titre}" p.${e.planche.numero} — ratio ${(e.ratio * 100).toFixed(0)} %`
		);
	}
}

// Ce qui, après correction, doit repartir en relecture humaine : le texte
// gardé porte encore une signature d'échec, ou n'a plus assez de matière.
const aRelire = modifications
	.map((m) => ({ m, defaut: classerDefaut(m.texteCorrige) }))
	.filter((x) => x.defaut !== null);
console.log(`\n${"-".repeat(78)}`);
console.log(`RENVOYÉES EN RELECTURE HUMAINE APRÈS CORRECTION : ${aRelire.length} planche(s)`);
console.log(
	`(seuil « courte » = ${SEUIL_COURT} signes ; la file scripts/planches-a-relire.ts les reprend d'elle-même)`
);
for (const { m, defaut } of aRelire) {
	console.log(
		`  #${m.planche.id} "${m.planche.titre}" p.${m.planche.numero} — ${m.planche.texte.length} → ${m.texteCorrige.length} signes, défaut résiduel : ${defaut}`
	);
}
const propres = modifications.length - aRelire.length;
console.log(`\n${propres} planche(s) ne portent plus AUCUNE signature d'échec après correction.`);

if (N_ECHANTILLONS > 0 && modifications.length > 0) {
	console.log(`\n${"=".repeat(78)}`);
	console.log(`ÉCHANTILLONS (${N_ECHANTILLONS} des coupes les plus profondes)`);
	console.log("=".repeat(78));
	const tries = [...modifications].toSorted((a, b) => a.ratio - b.ratio).slice(0, N_ECHANTILLONS);
	for (const m of tries) {
		const motifs = m.coupes
			.map(
				(c) =>
					`${c.repetitions.toFixed(0)}× « ${m.planche.texte.slice(c.debut, c.debut + c.periode).replace(/\n/g, "⏎")} »`
			)
			.join(" | ");
		console.log(
			`\n[#${m.planche.id} "${m.planche.titre}" p.${m.planche.numero}] ${m.planche.texte.length} → ${m.texteCorrige.length} (${(m.ratio * 100).toFixed(0)} %)`
		);
		console.log(`  motif(s) : ${motifs}`);
		console.log(`  avant : ${m.planche.texte.slice(0, 180).replace(/\n/g, "⏎")}…`);
		console.log(`  après : ${m.texteCorrige.slice(0, 240).replace(/\n/g, "⏎")}`);
	}
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

if (SIMULATION) {
	console.log(
		`\n(simulation : rien n'a été écrit — relancer avec --appliquer pour déposer ${modifications.length} planche(s))`
	);
	await sql.end();
	process.exit(0);
}

console.log(`\n${"=".repeat(78)}`);
console.log(`APPLICATION — dépôt transactionnel direct de ${modifications.length} planche(s)`);
console.log("=".repeat(78));

const parOuvrage = new Map<number, Modification[]>();
for (const m of modifications) {
	const liste = parOuvrage.get(m.planche.id) ?? [];
	liste.push(m);
	parOuvrage.set(m.planche.id, liste);
}

const idRevision = () => `ocr-generation-${Date.now()}-${crypto.randomUUID()}`;
let deposees = 0;
let echecs = 0;
for (const [databookId, liste] of [...parOuvrage.entries()].toSorted((a, b) => a[0] - b[0])) {
	try {
		await sql.begin(async (tx) => {
			for (const m of liste) {
				const updated = await tx`
					UPDATE bot.db_databooks AS d
					SET pages = jsonb_set(
						d.pages,
						ARRAY[(SELECT (e.ord - 1)::text
							FROM jsonb_array_elements(d.pages) WITH ORDINALITY AS e(page, ord)
							WHERE (e.page ->> 'number')::int = ${m.planche.numero}
							LIMIT 1), 'text'],
						to_jsonb(${m.texteCorrige}::text),
						true
					)
					WHERE d.id = ${databookId}
					  AND EXISTS (
						SELECT 1 FROM jsonb_array_elements(d.pages) AS e(page)
						WHERE (e.page ->> 'number')::int = ${m.planche.numero}
						  AND e.page ->> 'text' = ${m.planche.texte}
					  )
					RETURNING d.id
				`;
				if (updated.length !== 1) {
					throw new Error(`conflit ou planche absente #${databookId} p.${m.planche.numero}`);
				}
				await tx`INSERT INTO public.wiki_revisions ${tx({
					id: idRevision(),
					tableName: "db_databooks",
					rowId: `${databookId}:pages#${m.planche.numero}`,
					action: "update",
					label: `${m.planche.titre} — correction OCR génération déraillée p.${m.planche.numero}`,
					before: tx.json({ text: m.planche.texte }),
					after: tx.json({ text: m.texteCorrige }),
					editorId: "agent-shenron",
					editorName: "Shenron — correcteur OCR déterministe",
				})}`;
			}
		});
		deposees += liste.length;
		console.log(`  #${databookId} ${liste.length} page(s) déposée(s) et versionnée(s)`);
	} catch (error) {
		echecs += liste.length;
		console.error(`  #${databookId} ÉCHEC transaction : ${(error as Error).message}`);
	}
}

console.log(`\n${deposees} page(s) déposée(s), ${echecs} en échec.`);
await sql.end();
if (echecs > 0) process.exit(1);

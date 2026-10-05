#!/usr/bin/env bun
/**
 * Correcteur des glyphes sosies et du débordement d'énumération en hangul.
 *
 * Applique le module pur `../src/lib/databooks-ocr/sosies-intrusions.ts` sur
 * `bot.db_databooks`, et rapporte séparément ce qui est seulement SIGNALÉ :
 * les intrusions d'alphabet étranger, qu'aucune règle ne corrige parce que
 * reconstruire le caractère juste demanderait de relire l'image.
 *
 * Calqué sur `corrige-transcriptions-ocr.ts` — mêmes modes, même garde-fou des
 * 50 %, même dépôt en mode « merge » — mais dans son propre fichier : quatre
 * passes de correction sont écrites en parallèle, et partager un runner les
 * ferait se marcher dessus.
 *
 * Modes (un seul requis) :
 *   --simulation            n'écrit rien, imprime le rapport et tous les diffs
 *   --appliquer             dépose les corrections via l'API (mode « merge »)
 *
 * Filtres :
 *   --fiche <id>            une seule fiche (databook id)
 *   --limite N              limite le nombre de PLANCHES examinées
 *   --intrusions N          nombre d'intrusions listées dans le rapport (défaut 20)
 *
 * Sécurité en mode --appliquer : identique au runner principal. Une planche
 * dont le texte corrigé ferait moins de 50 % de l'original est EXCLUE et
 * listée à part ; le dépôt passe par l'API en mode « merge », donc idempotent,
 * et chaque appel écrit une révision dans `public.wiki_revisions`.
 *
 * Le dictionnaire (kuromoji + JMdict) est OBLIGATOIRE ici : sans lui la règle
 * des sosies se tait, et un rapport « 0 correction » serait pris pour un
 * corpus sain. Même refus de démarrer que `ja-analyser.ts`.
 */
import postgres from "postgres";
import {
	corrigerSosiesEtIntrusions,
	signalerIntrusions,
	type RapportRegle,
} from "../src/lib/databooks-ocr/sosies-intrusions";
import { analyseur, exigerRessources, graphiesJmdict } from "../src/lib/ja/dictionnaire";
import { origineSite } from "./_origine-site";

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
const N_INTRUSIONS = Number(opt("intrusions") ?? 20);
const PAQUET = Number(opt("paquet") ?? 50);

if (SIMULATION === APPLIQUER) {
	console.error("erreur : il faut choisir exactement un mode, --simulation OU --appliquer.");
	process.exit(2);
}

async function lireEnv(cle: string): Promise<string | undefined> {
	const contenu = await Bun.file(new URL("../.env", import.meta.url)).text();
	return contenu
		.split("\n")
		.filter((l) => l.startsWith(`${cle}=`))
		.pop() // la dernière ligne qui matche fait autorité (piège documenté)
		?.slice(cle.length + 1)
		.replace(/^"|"$/g, "")
		.trim();
}

const DATABASE_URL = await lireEnv("DATABASE_URL");
if (!DATABASE_URL) throw new Error("DATABASE_URL introuvable dans apps/shenron/site/.env");
const sql = postgres(DATABASE_URL, { max: 2 });

const API = origineSite();
const JETON = (
	(await lireEnv("DATABOOKS_API_TOKEN")) ??
	(await lireEnv("SHENRON_ADMIN_TOKEN")) ??
	""
).trim();
if (APPLIQUER && JETON.length < 16) {
	console.error(
		"erreur : jeton absent — DATABOOKS_API_TOKEN ou SHENRON_ADMIN_TOKEN doit être dans apps/shenron/site/.env"
	);
	process.exit(2);
}

// ---------------------------------------------------------------------------
// L'oracle du dictionnaire
// ---------------------------------------------------------------------------

console.log("· chargement du dictionnaire japonais…");
await exigerRessources();
const jmdict = await graphiesJmdict();
const tokenizer = (await analyseur())!;

/**
 * « Cette suite est-elle UN mot japonais ? »
 *
 * Deux sources, dans cet ordre de coût : JMdict d'abord (un `Set`, donc une
 * comparaison de hachage), l'analyseur morphologique ensuite. JMdict seul ne
 * suffit pas — il ignore des formes qu'IPADIC connaît — et IPADIC seul non
 * plus : il ignore la plupart des emprunts à l'anglais, ce qui ferait passer
 * コミックス ou バーサス pour des inconnus.
 *
 * UN mot, pas plusieurs : カメハメ découpé en カメ + ハメ serait « connu » au
 * sens large tout en n'étant pas un mot, et cette indulgence suffirait à
 * valider n'importe quelle substitution.
 */
const cache = new Map<string, boolean>();
function motConnu(mot: string): boolean {
	const vu = cache.get(mot);
	if (vu !== undefined) return vu;
	let ok = jmdict.has(mot);
	if (!ok) {
		const tokens = tokenizer.tokenize(mot) as { word_type?: string }[];
		ok = tokens.length === 1 && tokens[0].word_type !== "UNKNOWN";
	}
	cache.set(mot, ok);
	return ok;
}

// ---------------------------------------------------------------------------
// Lecture du corpus
// ---------------------------------------------------------------------------

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
// Application
// ---------------------------------------------------------------------------

interface Modification {
	planche: Planche;
	texteCorrige: string;
	rapport: RapportRegle[];
	details: { avant: string; apres: string }[];
}

const SEUIL_SECURITE_LONGUEUR = 0.5;

const modifications: Modification[] = [];
const ecartesSecurite: { planche: Planche; ratio: number }[] = [];
const totaux = new Map<string, { planches: Set<string>; corrections: number }>();
const parSubstitution = new Map<
	string,
	{ apres: string; n: number; ouvrages: Set<string>; ou: string[] }
>();

let planchesIntrusions = 0;
let signesIntrusions = 0;
const echantillonsIntrusions: string[] = [];

for (const p of planches) {
	// Signalement sur le texte ORIGINAL, avant toute correction.
	const intrusions = signalerIntrusions(p.texte);
	if (intrusions.length > 0) {
		planchesIntrusions++;
		signesIntrusions += intrusions.reduce((a, i) => a + i.fragment.length, 0);
		if (echantillonsIntrusions.length < N_INTRUSIONS) {
			echantillonsIntrusions.push(
				`#${p.id} "${p.titre}" p.${p.numero} [${intrusions[0].fragment}] … ${intrusions[0].contexte}`
			);
		}
	}

	const { texte, rapport, details } = corrigerSosiesEtIntrusions(p.texte, { motConnu });
	if (texte === p.texte) continue;

	for (const r of rapport) {
		if (r.corrections === 0) continue;
		const acc = totaux.get(r.code) ?? { planches: new Set<string>(), corrections: 0 };
		// Clé par PLANCHE (fiche + numéro) : `p.id` seul est l'identifiant de
		// l'OUVRAGE, partagé par toutes ses pages.
		acc.planches.add(`${p.id}-${p.numero}`);
		acc.corrections += r.corrections;
		totaux.set(r.code, acc);
	}
	for (const d of details) {
		const acc = parSubstitution.get(d.avant) ?? {
			apres: d.apres,
			n: 0,
			ouvrages: new Set<string>(),
			ou: [],
		};
		acc.n++;
		acc.ouvrages.add(p.titre);
		if (acc.ou.length < 4) acc.ou.push(`#${p.id} p.${p.numero}`);
		parSubstitution.set(d.avant, acc);
	}

	const ratio = p.texte.length > 0 ? texte.length / p.texte.length : 1;
	if (texte.length > 0 && ratio < SEUIL_SECURITE_LONGUEUR) {
		ecartesSecurite.push({ planche: p, ratio });
		continue;
	}
	modifications.push({ planche: p, texteCorrige: texte, rapport, details });
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

const LIBELLES: Record<string, string> = {
	"enumeration-hangul": "Énumération débordée en hangul cerclé",
	"sosies-typographiques": "Sosies typographiques kanji/katakana",
};

console.log("=".repeat(78));
console.log("RÈGLES DE CORRECTION");
console.log("=".repeat(78));
for (const [code, libelle] of Object.entries(LIBELLES)) {
	const acc = totaux.get(code);
	console.log(
		`${libelle.padEnd(46)} ${String(acc?.planches.size ?? 0).padStart(5)} planche(s)  ${String(acc?.corrections ?? 0).padStart(6)} correction(s)`
	);
}
console.log(`\nplanches modifiées au total : ${modifications.length} / ${planches.length}`);

if (ecartesSecurite.length > 0) {
	console.log(
		`\n⚠ ${ecartesSecurite.length} planche(s) écartée(s) par le garde-fou (texte corrigé < ${Math.round(SEUIL_SECURITE_LONGUEUR * 100)} % de l'original) — À RELIRE :`
	);
	for (const e of ecartesSecurite.slice(0, 20)) {
		console.log(
			`  #${e.planche.id} "${e.planche.titre}" p.${e.planche.numero} — ratio ${(e.ratio * 100).toFixed(0)} %`
		);
	}
}

if (parSubstitution.size > 0) {
	console.log(`\n${"-".repeat(78)}`);
	console.log(`Sosies corrigés, cas par cas (${parSubstitution.size} suites distinctes) :`);
	for (const [avant, v] of [...parSubstitution].toSorted((a, b) => b[1].n - a[1].n)) {
		console.log(
			`  ${String(v.n).padStart(3)}×  ${avant.padEnd(16)} → ${v.apres.padEnd(16)} ${v.ou.join(", ")}`
		);
	}
}

console.log(`\n${"=".repeat(78)}`);
console.log("SIGNALÉ, JAMAIS CORRIGÉ (demande une relecture à l'image)");
console.log("=".repeat(78));
console.log(
	`intrusions d'alphabet étranger … ${planchesIntrusions} planche(s), ${signesIntrusions} signe(s)`
);
for (const e of echantillonsIntrusions) console.log(`    ${e}`);

if (SIMULATION && modifications.length > 0) {
	console.log(`\n${"=".repeat(78)}`);
	console.log("DIFFS — toutes les planches touchées");
	console.log("=".repeat(78));
	for (const m of modifications) {
		const n = m.rapport.map((r) => `${r.code}=${r.corrections}`).join(" ");
		console.log(`\n[#${m.planche.id} "${m.planche.titre}" p.${m.planche.numero}] ${n}`);
		for (const d of m.details) console.log(`   sosie : ${d.avant} → ${d.apres}`);
		// Premières lignes qui diffèrent, pour voir le changement en contexte.
		const av = m.planche.texte.split("\n");
		const ap = m.texteCorrige.split("\n");
		let montrees = 0;
		for (let i = 0; i < Math.max(av.length, ap.length) && montrees < 4; i++) {
			if (av[i] === ap[i]) continue;
			console.log(`   L${i + 1} avant : ${(av[i] ?? "").slice(0, 150)}`);
			console.log(`   L${i + 1} après : ${(ap[i] ?? "").slice(0, 150)}`);
			montrees++;
		}
	}
}

// ---------------------------------------------------------------------------
// Dépôt
// ---------------------------------------------------------------------------

if (SIMULATION) {
	console.log(
		`\n(simulation : rien n'a été écrit — relancer avec --appliquer pour déposer ${modifications.length} planche(s))`
	);
	await sql.end();
	process.exit(0);
}

console.log(`\n${"=".repeat(78)}`);
console.log(`APPLICATION — dépôt de ${modifications.length} planche(s) via ${API}`);
console.log("=".repeat(78));

const parOuvrage = new Map<number, Modification[]>();
for (const m of modifications) {
	const liste = parOuvrage.get(m.planche.id) ?? [];
	liste.push(m);
	parOuvrage.set(m.planche.id, liste);
}

function paquets<T>(items: T[], taille: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += taille) out.push(items.slice(i, i + taille));
	return out;
}

let deposees = 0;
let echecs = 0;
for (const [databookId, liste] of [...parOuvrage.entries()].toSorted((a, b) => a[0] - b[0])) {
	for (const lot of paquets(liste, PAQUET)) {
		const corps = JSON.stringify({
			mode: "merge",
			pages: lot.map((m) => ({ number: m.planche.numero, text: m.texteCorrige })),
		});
		let ok = false;
		let detail = "";
		for (let essai = 1; essai <= 2; essai++) {
			try {
				const r = await fetch(`${API}/api/databooks/${databookId}/transcription`, {
					method: "POST",
					headers: { Authorization: `Bearer ${JETON}`, "Content-Type": "application/json" },
					body: corps,
				});
				detail = await r.text();
				if (r.ok) {
					ok = true;
					break;
				}
				if (r.status < 500 || essai === 2) break;
			} catch (e) {
				detail = (e as Error).message;
				if (essai === 2) break;
			}
			await new Promise((res) => setTimeout(res, 5_000));
		}
		if (ok) {
			deposees += lot.length;
			console.log(`  #${databookId} ${lot.length} page(s) -> ${detail.slice(0, 160)}`);
		} else {
			echecs += lot.length;
			console.error(`  #${databookId} ÉCHEC : ${detail.slice(0, 200)}`);
		}
	}
}

console.log(`\n${deposees} page(s) déposée(s), ${echecs} en échec.`);
await sql.end();
if (echecs > 0) process.exit(1);

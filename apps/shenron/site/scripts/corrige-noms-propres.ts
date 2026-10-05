#!/usr/bin/env bun
/**
 * Correcteur des noms propres Dragon Ball mal lus dans les transcriptions.
 *
 * Applique le module pur `../src/lib/databooks-ocr/noms-propres.ts` sur
 * `bot.db_databooks`. Il ne traite qu'une classe de défaut — la confusion
 * sourde/sonore sur un nom propre — et n'est délibérément pas branché sur le
 * pipeline de `corrige-transcriptions-ocr.ts` : les deux surfaces avancent en
 * parallèle, et les mêler ferait qu'un dépôt de l'une emporterait les règles
 * non relues de l'autre.
 *
 * Modes (un seul requis) :
 *   --simulation      n'écrit rien, imprime un rapport chiffré et les diffs
 *   --appliquer       dépose via l'API en mode « merge », réversible
 *
 * Filtres :
 *   --fiche <id>      une seule fiche (databook id)
 *   --limite N        limite le nombre de PLANCHES examinées
 *   --echantillons N  nombre de diffs affichés (défaut 8)
 *   --paire <graphie> n'affiche que les diffs portant cette graphie fautive
 *
 * Sécurité en mode --appliquer, identique à `corrige-transcriptions-ocr.ts` :
 *   - une planche dont le texte corrigé ferait moins de 50 % de la longueur de
 *     l'original est ÉCARTÉE et listée à part. Aucune paire de la table ne
 *     change la longueur du texte (test de non-régression), donc ce garde-fou
 *     ne devrait jamais se déclencher ; s'il le fait, c'est un bug, pas un
 *     cas limite ;
 *   - dépôt par `POST /api/databooks/:id/transcription` en mode « merge » :
 *     idempotent, et chaque appel écrit une révision dans
 *     `public.wiki_revisions`, relisible depuis /admin/wiki/history ;
 *   - un dump de `bot.db_databooks` doit exister avant tout `--appliquer`.
 *     Celui du 2026-08-25 est dans `~/backups/`.
 *
 * Jeton : $DATABOOKS_API_TOKEN, sinon $SHENRON_ADMIN_TOKEN, lus dans
 * `apps/shenron/site/.env` (dernière ligne qui matche — le fichier a une ligne Neon
 * commentée AVANT la ligne active).
 */
import postgres from "postgres";
import {
	AGGLUTINATIONS_VALIDEES_A_LA_MAIN,
	NOMS_PROPRES_MAL_LUS,
	detaillerNomsPropres,
} from "../src/lib/databooks-ocr/noms-propres";
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
const N_ECHANTILLONS = Number(opt("echantillons") ?? 8);
const PAIRE = opt("paire") ?? null;
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
		.pop()
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
	`  ${planches.length} planche(s) transcrite(s) examinée(s)${FICHE !== null ? ` (fiche #${FICHE})` : ""}\n`
);

if (planches.length === 0) {
	console.log("rien à faire.");
	await sql.end();
	process.exit(0);
}

interface Modification {
	planche: Planche;
	texteCorrige: string;
	details: { lu: string; correct: string; n: number }[];
}

/** Une planche qui perdrait plus de la moitié de sa matière est un bug, pas un cas limite. */
const SEUIL_SECURITE_LONGUEUR = 0.5;

const modifications: Modification[] = [];
const ecartesSecurite: { planche: Planche; ratio: number }[] = [];
const totaux = new Map<
	string,
	{ correct: string; fr: string; n: number; planches: number; ouvrages: Set<string> }
>();

/**
 * Libellé à afficher pour une graphie rencontrée : le nom français pour une
 * paire ordinaire, la planche d'origine pour une chaîne agglutinée — c'est
 * ce qui permet au relecteur de retrouver le cas qui a été tranché à la main.
 */
const LIBELLE = new Map<string, string>([
	...NOMS_PROPRES_MAL_LUS.map((f) => [f.lu, f.fr] as [string, string]),
	...AGGLUTINATIONS_VALIDEES_A_LA_MAIN.map(
		(a) => [a.lu, `agglutination ${a.planche} — ${a.note}`] as [string, string]
	),
]);

for (const p of planches) {
	const { texte, corrections, details } = detaillerNomsPropres(p.texte);
	if (corrections === 0) continue;

	for (const d of details) {
		const acc = totaux.get(d.lu) ?? {
			correct: d.correct,
			fr: LIBELLE.get(d.lu) ?? "?",
			n: 0,
			planches: 0,
			ouvrages: new Set<string>(),
		};
		acc.n += d.n;
		acc.planches++;
		acc.ouvrages.add(p.titre);
		totaux.set(d.lu, acc);
	}

	const ratio = p.texte.length > 0 ? texte.length / p.texte.length : 1;
	if (texte.length > 0 && ratio < SEUIL_SECURITE_LONGUEUR) {
		ecartesSecurite.push({ planche: p, ratio });
		continue;
	}
	modifications.push({ planche: p, texteCorrige: texte, details });
}

console.log("=".repeat(78));
console.log("NOMS PROPRES MAL LUS — confusion sourde / sonore");
console.log("=".repeat(78));
const totalCorrections = [...totaux.values()].reduce((s, v) => s + v.n, 0);
console.log(
	`${totaux.size} graphie(s) distincte(s) rencontrée(s) sur ${NOMS_PROPRES_MAL_LUS.length} paire(s) + ${AGGLUTINATIONS_VALIDEES_A_LA_MAIN.length} agglutination(s) en table`
);
console.log(
	`${totalCorrections} correction(s) sur ${modifications.length} planche(s) / ${planches.length} examinées\n`
);

const tri = [...totaux.entries()].toSorted((a, b) => b[1].n - a[1].n);
for (const [lu, v] of tri) {
	console.log(
		`  ${String(v.n).padStart(4)}×  ${lu.padEnd(16)} → ${v.correct.padEnd(16)} ${String(v.planches).padStart(3)} pl  ${String(v.ouvrages.size).padStart(2)} ouv   ${v.fr}`
	);
}

const jamaisVues = NOMS_PROPRES_MAL_LUS.filter((f) => !totaux.has(f.lu));
if (jamaisVues.length > 0) {
	console.log(
		`\n${jamaisVues.length} paire(s) de la table sans occurrence dans le périmètre examiné :`
	);
	console.log(`  ${jamaisVues.map((f) => f.lu).join(" ")}`);
}

if (ecartesSecurite.length > 0) {
	console.log(
		`\n⚠ ${ecartesSecurite.length} planche(s) écartée(s) par le garde-fou (texte corrigé < ${Math.round(SEUIL_SECURITE_LONGUEUR * 100)} % de l'original) — aucune paire ne changeant la longueur, c'est un BUG à investiguer :`
	);
	for (const e of ecartesSecurite.slice(0, 20)) {
		console.log(
			`  #${e.planche.id} "${e.planche.titre}" p.${e.planche.numero} — ratio ${(e.ratio * 100).toFixed(0)} %`
		);
	}
}

/**
 * Contexte d'une correction, tel qu'un relecteur en a besoin : la phrase
 * autour, pas la planche entière. Le diff « avant/après » sur 220 caractères
 * du script voisin noie une substitution d'un seul kana ; ici on cadre sur
 * elle.
 */
function contextes(m: Modification, filtre: string | null): string[] {
	const out: string[] = [];
	for (const d of m.details) {
		if (filtre && d.lu !== filtre) continue;
		let depuis = 0;
		for (let k = 0; k < d.n; k++) {
			const i = m.planche.texte.indexOf(d.lu, depuis);
			if (i < 0) break;
			depuis = i + d.lu.length;
			const gauche = m.planche.texte.slice(Math.max(0, i - 34), i).replace(/\n/g, "⏎");
			const droite = m.planche.texte
				.slice(i + d.lu.length, i + d.lu.length + 34)
				.replace(/\n/g, "⏎");
			out.push(`    …${gauche}[${d.lu} → ${d.correct}]${droite}…`);
		}
	}
	return out;
}

if (N_ECHANTILLONS > 0 && modifications.length > 0) {
	const candidats = PAIRE
		? modifications.filter((m) => m.details.some((d) => d.lu === PAIRE))
		: modifications;
	console.log(`\n${"=".repeat(78)}`);
	console.log(
		`DIFFS (${Math.min(N_ECHANTILLONS, candidats.length)} planche(s) sur ${candidats.length})`
	);
	console.log("=".repeat(78));
	const pas = Math.max(
		1,
		Math.floor(candidats.length / Math.min(N_ECHANTILLONS, candidats.length))
	);
	for (let i = 0, vus = 0; i < candidats.length && vus < N_ECHANTILLONS; i += pas, vus++) {
		const m = candidats[i];
		console.log(`\n[#${m.planche.id} "${m.planche.titre}" p.${m.planche.numero}]`);
		for (const ligne of contextes(m, PAIRE)) console.log(ligne);
	}
}

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

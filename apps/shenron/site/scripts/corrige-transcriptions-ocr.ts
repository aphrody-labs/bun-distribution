#!/usr/bin/env bun
/**
 * Correcteur déterministe des transcriptions OCR de databooks.
 *
 * Applique le pipeline pur de `../src/lib/databooks-ocr-corrections.ts`
 * (titres markdown coincés en milieu de ligne, latin pleine chasse, boucles
 * du modèle, fautes de lecture validées à la main) sur `bot.db_databooks`, et
 * rapporte séparément ce qui est seulement DÉTECTÉ (jamais deviné) :
 * caractère de remplacement, texte très court, romaji-only, mojibake,
 * candidats furigana orphelins.
 *
 * Modes (un seul requis) :
 *   --simulation           n'écrit rien, imprime un rapport chiffré + échantillons
 *   --appliquer             dépose les corrections via l'API (mode "merge", réversible)
 *
 * Filtres :
 *   --fiche <id>            une seule fiche (databook id)
 *   --limite N               limite le nombre de PLANCHES examinées
 *   --echantillons N        nombre de diffs affichés par règle (défaut 3)
 *
 * Sécurité en mode --appliquer :
 *   - une planche dont le texte corrigé ferait moins de 50 % de la longueur
 *     du texte original est EXCLUE de l'envoi et listée à part — ce n'est
 *     jamais censé arriver (aucune règle ne devrait faire disparaître autant
 *     de matière), donc mieux vaut l'écarter et la faire relire que l'appliquer
 *     aveuglément ;
 *   - dépôt via `POST /api/databooks/:id/transcription` en mode "merge" —
 *     idempotent, et chaque appel écrit une révision dans
 *     `public.wiki_revisions` (réversible depuis /admin/wiki/history) ;
 *   - **avant tout `--appliquer` en production, prendre un dump de
 *     `bot.db_databooks`** (cf. README du dépôt / CLAUDE.md) — ce script ne
 *     le fait pas lui-même, il n'écrit que via l'API.
 *
 * Jeton : $DATABOOKS_API_TOKEN, sinon $SHENRON_ADMIN_TOKEN, lus dans
 * `apps/shenron/site/.env` (dernière ligne qui matche — le fichier a une ligne Neon
 * commentée AVANT la ligne active, piège documenté dans CLAUDE.md).
 */
import postgres from "postgres";
import {
	candidatFuriganaOrphelin,
	contientMojibakeSuspect,
	corrigerTexte,
	estRomajiUniquement,
	type RapportRegle,
} from "../src/lib/databooks-ocr-corrections";
import { diagnostiquerPlanche } from "../src/lib/databooks-format";
import { origineSite } from "./_origine-site";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

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
const N_ECHANTILLONS = Number(opt("echantillons") ?? 3);
const PAQUET = Number(opt("paquet") ?? 50);

if (SIMULATION === APPLIQUER) {
	console.error("erreur : il faut choisir exactement un mode, --simulation OU --appliquer.");
	process.exit(2);
}

// ---------------------------------------------------------------------------
// Environnement — même convention que ja-analyser.ts / depose-transcriptions.ts
// ---------------------------------------------------------------------------

async function lireEnv(cle: string): Promise<string | undefined> {
	if (process.env[cle]) return process.env[cle];
	for (const candidate of ["../.env.local", "../.env", "../../../.env"]) {
		const f = Bun.file(new URL(candidate, import.meta.url));
		if (await f.exists()) {
			const contenu = await f.text();
			const val = contenu
				.split("\n")
				.filter((l) => l.startsWith(`${cle}=`))
				.pop()
				?.slice(cle.length + 1)
				.replace(/^["']|["']$/g, "")
				.trim();
			if (val) return val;
		}
	}
	return undefined;
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
	`  ${planches.length} planche(s) transcrite(s) examinée(s)${FICHE !== null ? ` (fiche #${FICHE})` : ""}\n`
);

if (planches.length === 0) {
	console.log("rien à faire.");
	await sql.end();
	process.exit(0);
}

// ---------------------------------------------------------------------------
// Application du pipeline de correction
// ---------------------------------------------------------------------------

interface Modification {
	planche: Planche;
	texteCorrige: string;
	regles: RapportRegle[];
	fautesDeLecture: { lu: string; correct: string; n: number }[];
}

const SEUIL_SECURITE_LONGUEUR = 0.5;

const modifications: Modification[] = [];
const ecartesSecurite: { planche: Planche; ratio: number }[] = [];

const totauxParRegle = new Map<string, { planches: Set<string>; corrections: number }>();
const totauxFautes = new Map<string, { correct: string; n: number; ouvrages: Set<string> }>();

// Signaux détectés, jamais corrigés — cf. docstring de databooks-ocr-corrections.ts.
let nRemplacement = 0;
let nTresCourt = 0;
let nRomajiOnly = 0;
let nMojibake = 0;
let planchesFuriganaCandidat = 0;
let lignesFuriganaCandidat = 0;

for (const p of planches) {
	// Signaux "à signaler" — sur le texte ORIGINAL, avant toute correction.
	const anomalies = diagnostiquerPlanche(p.texte);
	if (anomalies.some((a) => a.code === "remplacement")) nRemplacement++;
	if (anomalies.some((a) => a.code === "tres-court")) nTresCourt++;
	if (estRomajiUniquement(p.texte)) nRomajiOnly++;
	if (contientMojibakeSuspect(p.texte)) nMojibake++;
	const lignesFurigana = p.texte.split("\n").filter(candidatFuriganaOrphelin).length;
	if (lignesFurigana > 0) {
		planchesFuriganaCandidat++;
		lignesFuriganaCandidat += lignesFurigana;
	}

	// Correction.
	const { texte, modifie, regles, fautesDeLecture } = corrigerTexte(p.texte);
	if (!modifie) continue;

	for (const r of regles) {
		if (r.corrections === 0) continue;
		const acc = totauxParRegle.get(r.code) ?? { planches: new Set(), corrections: 0 };
		// Clé unique par PLANCHE (fiche + numéro) — `p.id` seul est l'identifiant
		// de la FICHE (l'ouvrage), partagé par toutes ses pages : l'utiliser
		// seul confondrait « fiches touchées » et « planches touchées ».
		acc.planches.add(`${p.id}-${p.numero}`);
		acc.corrections += r.corrections;
		totauxParRegle.set(r.code, acc);
	}
	for (const f of fautesDeLecture) {
		const acc = totauxFautes.get(f.lu) ?? { correct: f.correct, n: 0, ouvrages: new Set() };
		acc.n += f.n;
		acc.ouvrages.add(p.titre);
		totauxFautes.set(f.lu, acc);
	}

	const ratio = p.texte.length > 0 ? texte.length / p.texte.length : 1;
	if (texte.length > 0 && ratio < SEUIL_SECURITE_LONGUEUR) {
		ecartesSecurite.push({ planche: p, ratio });
		continue;
	}

	modifications.push({ planche: p, texteCorrige: texte, regles, fautesDeLecture });
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

console.log("=".repeat(78));
console.log("RÈGLES DE CORRECTION");
console.log("=".repeat(78));
const LIBELLES: Record<string, string> = {
	"latin-pleine-chasse": "Latin/chiffres pleine chasse → normale",
	"titres-inline": "Titres markdown coincés en milieu de ligne",
	"repetitions-consecutives": "Répétitions consécutives (boucle du modèle)",
	"fautes-de-lecture": "Fautes de lecture (table validée)",
};
for (const [code, libelle] of Object.entries(LIBELLES)) {
	const acc = totauxParRegle.get(code);
	console.log(
		`${libelle.padEnd(46)} ${String(acc?.planches.size ?? 0).padStart(5)} planche(s)  ${String(acc?.corrections ?? 0).padStart(6)} correction(s)`
	);
}
console.log(`\nplanches modifiées au total : ${modifications.length} / ${planches.length}`);
if (ecartesSecurite.length > 0) {
	console.log(
		`\n⚠ ${ecartesSecurite.length} planche(s) écartée(s) par le garde-fou de sécurité (texte corrigé < ${Math.round(SEUIL_SECURITE_LONGUEUR * 100)}% de l'original) — À RELIRE MANUELLEMENT :`
	);
	for (const e of ecartesSecurite.slice(0, 20)) {
		console.log(
			`  #${e.planche.id} "${e.planche.titre}" p.${e.planche.numero} — ratio ${(e.ratio * 100).toFixed(0)}%`
		);
	}
}

if (totauxFautes.size > 0) {
	console.log(
		`\n${"-".repeat(78)}\nFautes de lecture corrigées, par graphie (${totauxFautes.size} graphies distinctes) :`
	);
	const tri = [...totauxFautes.entries()].toSorted((a, b) => b[1].n - a[1].n);
	for (const [lu, v] of tri) {
		console.log(
			`  ${String(v.n).padStart(4)}×  ${lu.padEnd(12)} → ${v.correct.padEnd(12)} (${v.ouvrages.size} ouvrage(s))`
		);
	}
}

console.log(`\n${"=".repeat(78)}`);
console.log("SIGNALÉ, JAMAIS CORRIGÉ (nécessite une relecture humaine)");
console.log("=".repeat(78));
console.log(`caractère de remplacement (�) ....... ${nRemplacement} planche(s)`);
console.log(`texte très court (<15 signes) ....... ${nTresCourt} planche(s)`);
console.log(
	`romaji-only (0 kana/kanji) ........... ${nRomajiOnly} planche(s) (souvent du contenu réellement non japonais)`
);
console.log(`mojibake suspect ..................... ${nMojibake} planche(s)`);
console.log(
	`candidats furigana orphelins ......... ${planchesFuriganaCandidat} planche(s), ${lignesFuriganaCandidat} ligne(s) (aucune règle fiable, cf. docstring)`
);

if (N_ECHANTILLONS > 0 && modifications.length > 0) {
	console.log(`\n${"=".repeat(78)}`);
	console.log(`ÉCHANTILLONS (${N_ECHANTILLONS} par règle)`);
	console.log("=".repeat(78));
	for (const code of Object.keys(LIBELLES)) {
		const candidats = modifications.filter((m) =>
			m.regles.some((r) => r.code === code && r.corrections > 0)
		);
		if (candidats.length === 0) continue;
		console.log(`\n— ${LIBELLES[code]} —`);
		for (let i = 0; i < Math.min(N_ECHANTILLONS, candidats.length); i++) {
			const m =
				candidats[Math.floor((i * candidats.length) / Math.min(N_ECHANTILLONS, candidats.length))];
			console.log(`\n[#${m.planche.id} "${m.planche.titre}" p.${m.planche.numero}]`);
			console.log(`  avant : ${m.planche.texte.slice(0, 220).replace(/\n/g, "⏎")}`);
			console.log(`  après : ${m.texteCorrige.slice(0, 220).replace(/\n/g, "⏎")}`);
		}
	}
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

if (SIMULATION) {
	console.log(
		`\n(simulation : rien n'a été écrit — relancer avec --appliquer pour déposer ${modifications.length} planche(s) corrigée(s))`
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

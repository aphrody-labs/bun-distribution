#!/usr/bin/env bun
/**
 * Retrait des artefacts de sortie du modèle dans les transcriptions de
 * databooks.
 *
 * Applique le pipeline pur de `../src/lib/databooks-ocr/artefacts-modele.ts`
 * sur `bot.db_databooks`. Frère de `corrige-transcriptions-ocr.ts`, dont il
 * réutilise les conventions et le helper `origineSite()` : mêmes modes, même
 * garde-fou, même dépôt via l'API en mode « merge ». Il ne touche PAS aux
 * règles de l'autre pipeline — les deux modules sont indépendants et seront
 * enchaînés plus tard.
 *
 * Modes (un seul requis) :
 *   --simulation            n'écrit rien, imprime un rapport chiffré + diffs
 *   --appliquer             dépose les corrections via l'API (mode « merge »)
 *
 * Filtres :
 *   --fiche <id>            une seule fiche (databook id)
 *   --limite N              limite le nombre de PLANCHES examinées
 *   --regle <code>          n'agit que sur les planches touchées par ce code
 *   --echantillons N        nombre de diffs affichés par règle (défaut 3)
 *
 * Sécurité en mode --appliquer :
 *   - une planche dont le texte corrigé ferait moins de 50 % de la longueur du
 *     texte original est EXCLUE de l'envoi et listée à part. Ici ce n'est pas
 *     théorique : couper une queue JSON ou une rafale de 2 040 échappements
 *     fait légitimement fondre le texte. On préfère la faire relire plutôt que
 *     de forcer.
 *   - une planche qui deviendrait VIDE est également exclue : l'API ignore une
 *     chaîne vide (ce n'est pas un effacement), donc l'envoyer ne ferait rien,
 *     mais on la liste pour qu'elle parte en relecture.
 *   - dépôt via `POST /api/databooks/:id/transcription` en mode « merge » —
 *     idempotent, et chaque appel écrit une révision dans
 *     `public.wiki_revisions` (réversible depuis /admin/wiki/history).
 *
 * Jeton : $DATABOOKS_API_TOKEN, sinon $SHENRON_ADMIN_TOKEN, lus dans
 * `apps/shenron/site/.env` (dernière ligne qui matche).
 */
import postgres from "postgres";
import {
	corrigerArtefactsModele,
	type CodeArtefact,
	type RapportRegle,
} from "../src/lib/databooks-ocr/artefacts-modele";
import { nettoyerOcr } from "../src/lib/databooks-format";
import { origineSite } from "./_origine-site";

const args = process.argv.slice(2);
const flag = (nom: string) => args.includes("--" + nom);
const opt = (nom: string): string | undefined => {
	const i = args.indexOf("--" + nom);
	return i >= 0 ? args[i + 1] : undefined;
};

const SIMULATION = flag("simulation");
const APPLIQUER = flag("appliquer");
const FICHE = opt("fiche") ? Number(opt("fiche")) : null;
const LIMITE = opt("limite") ? Number(opt("limite")) : null;
const REGLE = opt("regle") as CodeArtefact | undefined;
const N_ECHANTILLONS = Number(opt("echantillons") ?? 3);
const PAQUET = Number(opt("paquet") ?? 50);

if (SIMULATION === APPLIQUER) {
	console.error("erreur : il faut choisir exactement un mode, --simulation OU --appliquer.");
	process.exit(2);
}

async function lireEnv(cle: string): Promise<string | undefined> {
	const contenu = await Bun.file(new URL("../.env", import.meta.url)).text();
	return contenu
		.split("\n")
		.filter((l) => l.startsWith(cle + "="))
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
	"  " +
		planches.length +
		" planche(s) transcrite(s) examinée(s)" +
		(FICHE !== null ? " (fiche #" + FICHE + ")" : "") +
		"\n"
);

if (planches.length === 0) {
	console.log("rien à faire.");
	await sql.end();
	process.exit(0);
}

interface Modification {
	planche: Planche;
	texteCorrige: string;
	regles: RapportRegle[];
}

const SEUIL_SECURITE_LONGUEUR = 0.5;

const modifications: Modification[] = [];
const ecartes: { planche: Planche; ratio: number; motif: string; regles: string }[] = [];
const totaux = new Map<
	string,
	{ planches: Set<string>; corrections: number; ouvrages: Set<string> }
>();

for (const p of planches) {
	const r = corrigerArtefactsModele(p.texte);
	const texte = nettoyerOcr(r.texte);
	if (texte === p.texte) continue;
	if (REGLE && !r.rapport.some((x) => x.code === REGLE && x.corrections > 0)) continue;

	for (const reg of r.rapport) {
		if (reg.corrections === 0) continue;
		const acc = totaux.get(reg.code) ?? {
			planches: new Set<string>(),
			corrections: 0,
			ouvrages: new Set<string>(),
		};
		// Clé unique par PLANCHE : `p.id` seul est l'identifiant de la FICHE,
		// partagé par toutes ses pages.
		acc.planches.add(p.id + "-" + p.numero);
		acc.corrections += reg.corrections;
		acc.ouvrages.add(p.titre);
		totaux.set(reg.code, acc);
	}

	const codesActifs = r.rapport
		.filter((x) => x.corrections > 0)
		.map((x) => x.code)
		.join(", ");
	const ratio = p.texte.length > 0 ? texte.length / p.texte.length : 1;
	if (texte.trim().length === 0) {
		ecartes.push({ planche: p, ratio: 0, motif: "texte vidé", regles: codesActifs });
		continue;
	}
	if (ratio < SEUIL_SECURITE_LONGUEUR) {
		ecartes.push({ planche: p, ratio, motif: "sous le seuil de 50 %", regles: codesActifs });
		continue;
	}
	modifications.push({ planche: p, texteCorrige: texte, regles: r.rapport });
}

const LIBELLES: Record<CodeArtefact, string> = {
	"json-brut": "Sérialisation JSON du modèle",
	"phrase-meta-modele": "Phrase méta / refus du modèle",
	"token-controle": "Token de contrôle",
	"latex-hallucine": "LaTeX halluciné",
	"lien-hallucine": "Lien ou image inventés",
	"entite-html": "Entité HTML doublement échappée",
	"balise-html": "Balisage HTML survivant",
	"echappement-litteral": "Saut de ligne écrit en toutes lettres",
	"echappement-repete": "Rafale d'échappements markdown",
	"marqueur-page": "Marqueur de page halluciné",
	"ellipse-points": "Points ASCII au contact du japonais",
	"ellipse-midot": "Point médian demi-chasse répété",
	"ellipse-nakaguro": "Point médian pleine chasse répété (>=3)",
	"remplacement-terminal": "Caractère de remplacement orphelin",
};

console.log("=".repeat(84));
console.log("RÈGLES APPLIQUÉES");
console.log("=".repeat(84));
for (const code of Object.keys(LIBELLES) as CodeArtefact[]) {
	const acc = totaux.get(code);
	console.log(
		LIBELLES[code].padEnd(42) +
			String(acc?.planches.size ?? 0).padStart(6) +
			" planche(s)" +
			String(acc?.corrections ?? 0).padStart(8) +
			" corr." +
			String(acc?.ouvrages.size ?? 0).padStart(5) +
			" ouvrage(s)"
	);
}
console.log("\nplanches modifiées : " + modifications.length + " / " + planches.length);

if (ecartes.length > 0) {
	console.log(
		"\n/! " +
			ecartes.length +
			" planche(s) écartée(s) par le garde-fou — NON ENVOYÉE(S), À RELIRE :"
	);
	for (const e of ecartes) {
		console.log(
			"  #" +
				e.planche.id +
				" « " +
				e.planche.titre +
				" » p." +
				e.planche.numero +
				" — " +
				e.motif +
				" (" +
				Math.round(e.ratio * 100) +
				" %, " +
				e.planche.texte.length +
				" car.) [" +
				e.regles +
				"]"
		);
	}
}

/** Extrait la zone réellement changée : préfixe et suffixe communs élagués. */
function zoneChangee(a: string, b: string): [string, string] {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	let j = 0;
	while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
	const debut = Math.max(0, i - 30);
	return [
		a.slice(debut, a.length - j + 30).slice(0, 260),
		b.slice(debut, b.length - j + 30).slice(0, 260),
	];
}

if (N_ECHANTILLONS > 0 && modifications.length > 0) {
	console.log("\n" + "=".repeat(84));
	console.log("DIFFS (" + N_ECHANTILLONS + " par règle, zone changée uniquement)");
	console.log("=".repeat(84));
	for (const code of Object.keys(LIBELLES) as CodeArtefact[]) {
		const candidats = modifications.filter((m) =>
			m.regles.some((x) => x.code === code && x.corrections > 0)
		);
		if (candidats.length === 0) continue;
		console.log("\n— " + LIBELLES[code] + " (" + candidats.length + " planches) —");
		for (const m of candidats.slice(0, N_ECHANTILLONS)) {
			const [av, ap] = zoneChangee(m.planche.texte, m.texteCorrige);
			console.log(
				"\n[#" + m.planche.id + " p." + m.planche.numero + " « " + m.planche.titre + " »]"
			);
			console.log("  avant : " + av.replace(/\n/g, "⏎"));
			console.log("  après : " + ap.replace(/\n/g, "⏎"));
		}
	}
}

if (SIMULATION) {
	console.log(
		"\n(simulation : rien n'a été écrit — relancer avec --appliquer pour déposer " +
			modifications.length +
			" planche(s))"
	);
	await sql.end();
	process.exit(0);
}

console.log("\n" + "=".repeat(84));
console.log("APPLICATION — dépôt de " + modifications.length + " planche(s) via " + API);
console.log("=".repeat(84));

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
				const r = await fetch(API + "/api/databooks/" + databookId + "/transcription", {
					method: "POST",
					headers: { Authorization: "Bearer " + JETON, "Content-Type": "application/json" },
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
			console.log("  #" + databookId + " " + lot.length + " page(s) -> " + detail.slice(0, 160));
		} else {
			echecs += lot.length;
			console.error("  #" + databookId + " ÉCHEC : " + detail.slice(0, 200));
		}
	}
}

console.log("\n" + deposees + " page(s) déposée(s), " + echecs + " en échec.");
await sql.end();
if (echecs > 0) process.exit(1);

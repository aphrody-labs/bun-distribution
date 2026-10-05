#!/usr/bin/env bun
/**
 * Repêche, dans les lots d'OCR d'origine, une transcription MEILLEURE que celle
 * qui est en base.
 *
 * Le corpus a été transcrit en plusieurs passes (`lot-NNN-resultats.jsonl`, puis
 * des passes ciblées : bulles de dialogue, planches muettes, relectures). Ces
 * passes se sont écrasées les unes les autres au dépôt, sans jamais comparer :
 * une planche peut donc porter en base la sortie qui a bouclé jusqu'à sa limite
 * alors qu'un autre lot contient, pour la même image, une lecture propre.
 *
 * Ce script relit tous les lots, regroupe les candidats par planche, et ne
 * propose que ceux qui battent le texte en base au sens de `noteQualite`
 * (`src/lib/databooks-defauts.ts`) : un texte sans signature d'échec bat un
 * texte fautif, et à défaut égal le plus long gagne. Aucune règle d'écriture
 * ici — on choisit entre des lectures existantes, on n'en invente aucune.
 *
 * Usage :
 *   bun scripts/meilleure-source-ocr.ts --lots ~/databooks-ocr             # rapport
 *   bun scripts/meilleure-source-ocr.ts --lots ~/databooks-ocr --sortie f.jsonl
 *   bun scripts/meilleure-source-ocr.ts --lots ~/databooks-ocr --appliquer
 *
 * `--appliquer` dépose via `depose-transcriptions.ts` (mode « merge »,
 * réversible : chaque écriture laisse une révision dans `public.wiki_revisions`).
 */
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import postgres from "postgres";
import { classerDefaut, noteQualite } from "../src/lib/databooks-defauts";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const LOTS = opt("lots", join(process.env.HOME ?? ".", "databooks-ocr"))!;
const SORTIE = opt("sortie");
const APPLIQUER = flag("appliquer");
const ECHANTILLONS = Number(opt("echantillons", "5"));
/** Accepter aussi les échanges entre deux textes sans défaut (déconseillé). */
const TOUT = flag("tout");

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	// La DERNIÈRE ligne active gagne : `apps/shenron/site/.env` garde l'URL Neon
	// d'avant la migration, plus haut dans le fichier.
	const ligne = texte
		.split("\n")
		.filter((l) => l.startsWith("DATABASE_URL="))
		.pop();
	const valeur = ligne
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable (environnement ou apps/shenron/site/.env).");
		process.exit(1);
	}
	return valeur;
}

/**
 * Clé logique d'une planche à partir du nom de fichier écrit par les lots.
 * Deux graphies coexistent selon la passe : `12-0029.jpg` (export par lot,
 * page sur 4 chiffres) et `142-39.jpg` (passes ciblées). Les deux désignent la
 * même planche — d'où la normalisation du numéro de page en entier.
 */
function cle(chemin: string): string | null {
	const nom = basename(chemin.replace(/\\/g, "/"));
	const m = nom.match(/^(\d+)-(\d+)\./);
	if (!m) return null;
	return `${Number(m[1])}-${Number(m[2])}`;
}

interface Candidat {
	texte: string;
	lot: string;
	note: number;
}

const candidats = new Map<string, Candidat>();

const fichiers = (await readdir(LOTS)).filter((f) => f.endsWith(".jsonl")).toSorted();
if (fichiers.length === 0) {
	console.error(`✗ aucun .jsonl dans ${LOTS}`);
	process.exit(1);
}

for (const fichier of fichiers) {
	const contenu = await Bun.file(join(LOTS, fichier)).text();
	for (const ligne of contenu.split("\n")) {
		if (!ligne.trim()) continue;
		let objet: { image?: string; text?: { kind?: string; markdown?: string } };
		try {
			objet = JSON.parse(ligne);
		} catch {
			continue;
		}
		const k = objet.image ? cle(objet.image) : null;
		if (!k) continue;
		const texte = (objet.text?.markdown ?? "").trim();
		if (!texte) continue;
		const note = noteQualite(texte);
		const connu = candidats.get(k);
		if (!connu || note > connu.note) candidats.set(k, { texte, lot: fichier, note });
	}
}

console.log(`· ${fichiers.length} lot(s) lus, ${candidats.size} planche(s) candidates`);

const sql = postgres(await urlBase(), { max: 2, prepare: false });
interface Gain {
	cle: string;
	fiche: number;
	page: number;
	extension: string;
	avant: string;
	apres: string;
	lot: string;
}
const gains: Gain[] = [];
try {
	const fiches = await sql<{ id: number; pages: unknown }[]>`
		SELECT id, pages FROM bot.db_databooks WHERE pages IS NOT NULL ORDER BY id`;
	for (const fiche of fiches) {
		const pages = Array.isArray(fiche.pages) ? (fiche.pages as Record<string, unknown>[]) : [];
		for (const [i, p] of pages.entries()) {
			// Même repli que `export-databooks-ocr.ts`, qui nomme les fichiers d'un
			// lot `<fiche>-<numero || index+1>`. Sans lui, les planches sans
			// `number` recevaient la clé `<fiche>-0`, que le lot n'écrit jamais :
			// une meilleure transcription retrouvée pour elles n'était jamais
			// proposée, en silence.
			const page = Number(p.number ?? 0) || i + 1;
			const k = `${Number(fiche.id)}-${page}`;
			const candidat = candidats.get(k);
			if (!candidat) continue;
			const actuel = typeof p.text === "string" ? p.text : "";
			if (candidat.texte === actuel) continue;
			if (candidat.note <= noteQualite(actuel)) continue;
			// Par défaut on ne remplace QUE du fautif par du sain. Départager deux
			// textes sans défaut à la longueur est un mauvais juge : mesuré sur ce
			// corpus, la « meilleure » version gagnait souvent 30 signes en écrivant
			// ベージータ au lieu de ベジータ. `--tout` lève la restriction.
			if (!TOUT && (classerDefaut(actuel) === null || classerDefaut(candidat.texte) !== null))
				continue;
			const image = typeof p.image === "string" ? p.image : "";
			gains.push({
				cle: k,
				fiche: fiche.id,
				page,
				extension: image.split(".").pop() || "jpg",
				avant: actuel,
				apres: candidat.texte,
				lot: candidat.lot,
			});
		}
	}
} finally {
	await sql.end();
}

const parDefaut = new Map<string, number>();
for (const g of gains) {
	const d = classerDefaut(g.avant) ?? "sain";
	parDefaut.set(d, (parDefaut.get(d) ?? 0) + 1);
}
console.log(`\n${gains.length} planche(s) où un lot bat la base :`);
for (const [d, n] of [...parDefaut].toSorted((a, b) => b[1] - a[1])) {
	console.log(`  ${d.padEnd(14)} ${String(n).padStart(5)}`);
}

for (const g of gains.slice(0, ECHANTILLONS)) {
	const court = (t: string) => t.slice(0, 90).replaceAll("\n", "⏎");
	console.log(`\n[#${g.fiche} p.${g.page}] ← ${g.lot}`);
	console.log(`  base : ${court(g.avant)}`);
	console.log(`  lot  : ${court(g.apres)}`);
}

if (SORTIE || APPLIQUER) {
	const chemin = SORTIE ?? join(process.env.TMPDIR ?? "/tmp", "meilleure-source-ocr.jsonl");
	const lignes = gains.map((g) =>
		JSON.stringify({
			image: `${g.fiche}-${g.page}.${g.extension}`,
			text: { kind: "text", markdown: g.apres },
		})
	);
	await Bun.write(chemin, lignes.join("\n") + "\n");
	console.log(`\n· ${gains.length} ligne(s) écrite(s) dans ${chemin}`);
	if (APPLIQUER) {
		const proc = Bun.spawn(["bun", join(import.meta.dir, "depose-transcriptions.ts"), chemin], {
			stdout: "inherit",
			stderr: "inherit",
			env: process.env,
		});
		process.exit(await proc.exited);
	}
}

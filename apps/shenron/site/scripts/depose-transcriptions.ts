#!/usr/bin/env bun
/**
 * Dépose dans l'API databooks les transcriptions produites par `aphrody ocr`.
 *
 * Entrée : le JSONL qu'écrit `aphrody ocr batch`, une ligne par planche :
 *
 *   {"image":"…/1-0001.jpg","text":{"kind":"none"},"elapsed_ms":5223}
 *   {"image":"…/2-0015.jpg","text":{"kind":"text","markdown":"## …"},"elapsed_ms":4100}
 *
 * Le nom de fichier porte l'identité de la planche (`<databookId>-<page>.jpg`),
 * exactement comme `export-databooks-ocr.ts` l'a écrit. Le manifeste du lot est
 * lu quand il est disponible, et fait alors autorité : c'est lui qui a produit
 * les images, donc lui qui a raison si un nom a été touché entre-temps.
 *
 * Sortie : un POST `mode: "merge"` par ouvrage, par paquets, avec le compte
 * rendu de l'API. `merge` ne touche que le champ `text` des pages citées, donc
 * relancer le même lot ne change rien — la commande est rejouable.
 *
 * Usage :
 *   bun depose-transcriptions.ts <resultats.jsonl> [--manifeste <m.json>]
 *                                [--paquet 50] [--simulation] [--avec-vides]
 *
 * Jeton : $DATABOOKS_API_TOKEN, sinon $SHENRON_ADMIN_TOKEN.
 */

import { origineSite } from "./_origine-site";

const API = origineSite();
const JETON = (process.env.DATABOOKS_API_TOKEN ?? process.env.SHENRON_ADMIN_TOKEN ?? "").trim();

type Texte = { kind: "text"; markdown: string } | { kind: "none" };
type Ligne = { image: string; text: Texte; elapsed_ms?: number };
type Planche = { databookId: number; page: number; texte: string | null };

/** Une entrée du manifeste produit par `export-databooks-ocr.ts`. */
type EntreeManifeste = { databookId: number; page: number; image: string; titre?: string };

function usage(message: string): never {
	console.error(`erreur : ${message}\n`);
	console.error("usage : bun depose-transcriptions.ts <resultats.jsonl> [--manifeste <m.json>]");
	console.error("                                     [--paquet 50] [--simulation] [--avec-vides]");
	process.exit(2);
}

/** Le basename d'un chemin, quel que soit le séparateur qui l'a écrit. */
function basename(chemin: string): string {
	const parts = chemin.split(/[\\/]/);
	return parts[parts.length - 1] ?? chemin;
}

/**
 * `1-0001.jpg` -> `{ databookId: 1, page: 1 }`.
 *
 * Renvoie `null` pour tout ce qui ne suit pas la convention : mieux vaut
 * ignorer une ligne bruitée que déposer sur la mauvaise fiche.
 */
export function identifiePlanche(chemin: string): { databookId: number; page: number } | null {
	const m = /^(\d+)-(\d+)\.[a-z]+$/i.exec(basename(chemin));
	if (!m) return null;
	const databookId = Number(m[1]);
	const page = Number(m[2]);
	if (!Number.isInteger(databookId) || !Number.isInteger(page)) return null;
	if (databookId < 1 || page < 1) return null;
	return { databookId, page };
}

/** Lit le JSONL et le convertit en planches. */
export function lisResultats(
	contenu: string,
	index: Map<string, EntreeManifeste>,
	avecVides: boolean
): { planches: Planche[]; ignorees: number } {
	const planches: Planche[] = [];
	let ignorees = 0;

	for (const ligne of contenu.split("\n")) {
		const brut = ligne.trim();
		if (!brut) continue;

		let objet: Ligne;
		try {
			objet = JSON.parse(brut) as Ligne;
		} catch {
			// Dernière ligne tronquée par un kill : la planche sera relue.
			ignorees++;
			continue;
		}

		const nom = basename(objet.image ?? "");
		const depuisManifeste = index.get(nom);
		const identite = depuisManifeste ?? identifiePlanche(nom);
		if (!identite) {
			ignorees++;
			continue;
		}

		const texte = objet.text?.kind === "text" ? objet.text.markdown.trim() : null;

		// Une planche sans texte : `null` EFFACE la transcription existante côté
		// API. On ne l'envoie donc que sur demande explicite — sinon un passage
		// du modèle qui échoue détruirait une bonne transcription antérieure.
		if (texte === null && !avecVides) continue;
		if (texte !== null && texte.length === 0) {
			ignorees++;
			continue;
		}

		planches.push({ databookId: identite.databookId, page: identite.page, texte });
	}

	return { planches, ignorees };
}

/** Regroupe par ouvrage, pages triées. */
export function groupe(planches: Planche[]): Map<number, Planche[]> {
	const par = new Map<number, Planche[]>();
	for (const p of planches) {
		const liste = par.get(p.databookId) ?? [];
		liste.push(p);
		par.set(p.databookId, liste);
	}
	for (const liste of par.values()) liste.sort((a, b) => a.page - b.page);
	return par;
}

/** Découpe une liste en paquets d'au plus `taille`. */
export function paquets<T>(items: T[], taille: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += taille) out.push(items.slice(i, i + taille));
	return out;
}

async function depose(
	databookId: number,
	lot: Planche[],
	simulation: boolean
): Promise<{ ok: boolean; corps: string }> {
	const corps = JSON.stringify({
		mode: "merge",
		pages: lot.map((p) => ({ number: p.page, text: p.texte })),
	});

	if (simulation) {
		return { ok: true, corps: `[simulation] ${lot.length} page(s)` };
	}

	// Une 5xx est transitoire : un essai de plus, puis on passe à l'ouvrage
	// suivant plutôt que de bloquer tout le lot sur une fiche.
	for (let essai = 1; essai <= 2; essai++) {
		const r = await fetch(`${API}/api/databooks/${databookId}/transcription`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${JETON}`,
				"Content-Type": "application/json",
			},
			body: corps,
		});
		const texte = await r.text();
		if (r.ok) return { ok: true, corps: texte };
		if (r.status < 500 || essai === 2) return { ok: false, corps: `HTTP ${r.status} ${texte}` };
		await new Promise((r) => setTimeout(r, 30_000));
	}
	return { ok: false, corps: "inatteignable" };
}

async function main(): Promise<void> {
	const args = Bun.argv.slice(2);
	const fichier = args.find((a) => !a.startsWith("--"));
	if (!fichier) usage("il faut un fichier de résultats JSONL");

	const opt = (nom: string): string | undefined => {
		const i = args.indexOf(`--${nom}`);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const simulation = args.includes("--simulation");
	const avecVides = args.includes("--avec-vides");
	const taille = Number(opt("paquet") ?? 50);

	if (!simulation && JETON.length < 16) {
		usage("jeton absent : exporte DATABOOKS_API_TOKEN ou SHENRON_ADMIN_TOKEN");
	}

	// Le manifeste fait autorité quand il est là.
	const index = new Map<string, EntreeManifeste>();
	const cheminManifeste = opt("manifeste");
	if (cheminManifeste) {
		const m = (await Bun.file(cheminManifeste).json()) as { entrees?: EntreeManifeste[] };
		for (const e of m.entrees ?? []) index.set(basename(e.image), e);
		console.log(`manifeste : ${index.size} entrée(s)`);
	}

	const contenu = await Bun.file(fichier).text();
	const { planches, ignorees } = lisResultats(contenu, index, avecVides);
	const parOuvrage = groupe(planches);

	const avecTexte = planches.filter((p) => p.texte !== null).length;
	console.log(
		`${planches.length} planche(s) à déposer sur ${parOuvrage.size} ouvrage(s) ` +
			`— ${avecTexte} avec texte, ${planches.length - avecTexte} vidées, ${ignorees} ignorée(s)`
	);
	if (simulation) console.log("(simulation : rien n'est envoyé)");

	let deposees = 0;
	let echecs = 0;
	for (const [databookId, liste] of [...parOuvrage.entries()].toSorted((a, b) => a[0] - b[0])) {
		for (const lot of paquets(liste, taille)) {
			const { ok, corps } = await depose(databookId, lot, simulation);
			if (ok) {
				deposees += lot.length;
				console.log(`  #${databookId} ${lot.length} page(s) -> ${corps.slice(0, 160)}`);
			} else {
				echecs += lot.length;
				console.error(`  #${databookId} ÉCHEC : ${corps.slice(0, 200)}`);
			}
		}
	}

	console.log(`\n${deposees} page(s) déposée(s), ${echecs} en échec.`);
	if (echecs > 0) process.exit(1);
}

if (import.meta.main) await main();

#!/usr/bin/env bun
/**
 * **Arbitrage des planches manga par agents, en deux temps.**
 *
 * `run-manga-ocr.ts` sait arbitrer tout seul parce que son arbitre est un
 * processus : `codex exec` avec `gpt-5.6-luna`. Le 2026-09-11, ce compte a
 * épuisé son quota jusqu'au 15 et toute la chaîne s'est arrêtée — alors que le
 * contrat d'arbitrage, lui, restait tenable par d'autres modèles de vision.
 * `MANGA_ARBITRES` nomme désormais ces arbitres au lieu d'en coder un en dur.
 *
 * Un agent ne se lance pas depuis un script : il se lance depuis la session qui
 * le pilote. L'arbitrage par agent est donc forcément en deux temps, et ce
 * fichier tient les deux bouts :
 *
 *   bun scripts/manga-revue-agents.ts prepare <racine-run> --lot 1 --sortie /tmp/revue
 *       → un dossier de travail par lot : chemins d'images ABSOLUS (l'agent lit
 *         l'image lui-même — c'est toute la valeur de l'arbitrage) et indices
 *         PP-OCR, présentés comme des propositions à contredire.
 *
 *   bun scripts/manga-revue-agents.ts sceller <racine-run> --revues /tmp/revue --lot 1
 *       → scelle chaque planche par SES DEUX lectures indépendantes et écrit le
 *         `results.jsonl` que le dépôt attend. Une planche sans ses deux revues
 *         n'est pas écrite : le contrat n'est pas négociable, seul le
 *         fournisseur l'est.
 *
 * L'invariant reste celui de `docs/ocr-manga.md` : deux lectures visuelles
 * indépendantes, décision confirmée, aucune anomalie. Un JSONL PP-OCR seul
 * n'est jamais déposable.
 */
import { existsSync, readdirSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { SHENRON_MANGA_CANDIDATE_SCHEMA, type MangaReviewCandidateInput } from "../src/koharu";
import {
	atomicWriteText,
	coverageAuditedMangaResult,
	type MangaOcrCoverageAudit,
	type MangaOcrDetectionLine,
	type MangaOcrResultLine,
	type MangaOcrVisualReview,
	portableBasename,
	readMangaManifest,
	reviewedMangaResult,
	sha256File,
} from "../src/manga-ocr";

const args = process.argv.slice(2);
const commande = args[0] ?? "";
const positionnel = args[1];
const opt = (n: string, d?: string) => {
	const i = args.indexOf(`--${n}`);
	return i !== -1 && args[i + 1] && !args[i + 1]!.startsWith("--") ? args[i + 1]! : d;
};

function aide(): never {
	console.error(
		"usage :\n" +
			"  manga-revue-agents.ts run <racine-run> --lot <n> [--limit <n>]\n" +
			"  manga-revue-agents.ts prepare <racine-run> --lot <n> --sortie <dir> [--candidates <candidates.jsonl>]\n" +
			"  manga-revue-agents.ts sceller <racine-run> --revues <dir> --lot <n>\n"
	);
	process.exit(2);
}

if (!positionnel || !existsSync(positionnel)) aide();
const RACINE = resolve(positionnel);
const LOT = Number(opt("lot", "1"));
const dossierLot = join(RACINE, `lot-${String(LOT).padStart(3, "0")}`);
if (!existsSync(dossierLot)) {
	console.error(`lot introuvable : ${dossierLot}`);
	process.exit(1);
}

// The active path performs both visual passes on Aphrody AI. The prepare and
// sceller commands remain for importing already produced offline reviews.
if (commande === "run") {
	const command = [process.execPath, join(import.meta.dir, "run-manga-ocr.ts"), "--run", RACINE, ...args.slice(2)];
	const proc = Bun.spawn(command, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
	process.exit(await proc.exited);
}

/** Les indices PP-OCR d'un lot, indexés par nom de fichier d'image. */
function detectionsDuLot(): Map<string, MangaOcrDetectionLine> {
	const chemin = join(dossierLot, "detections.jsonl");
	const index = new Map<string, MangaOcrDetectionLine>();
	if (!existsSync(chemin)) return index;
	const brut = require("node:fs").readFileSync(chemin, "utf8") as string;
	for (const ligne of brut.split(/\r?\n/)) {
		if (!ligne.trim()) continue;
		try {
			const d = JSON.parse(ligne) as MangaOcrDetectionLine;
			index.set(portableBasename(d.image ?? "").toLowerCase(), d);
		} catch {
			/* une ligne illisible n'est qu'un indice perdu, pas une erreur bloquante */
		}
	}
	return index;
}

/** A candidate supplies untrusted reading hints, never a visual review or a verdict. */
async function candidatsDuLot(
	chemin: string,
	manifeste: Awaited<ReturnType<typeof readMangaManifest>>
): Promise<Map<string, MangaReviewCandidateInput>> {
	const fichier = Bun.file(chemin);
	if (!(await fichier.exists())) throw new Error(`candidats introuvables : ${chemin}`);
	if (fichier.size > 50_000_000) throw new Error("fichier de candidats trop volumineux");
	const parPage = new Map(manifeste.entries.map((entry) => [entry.id, entry]));
	const candidats = new Map<string, MangaReviewCandidateInput>();
	for (const [index, ligne] of (await fichier.text()).split(/\r?\n/).entries()) {
		if (!ligne.trim()) continue;
		let brut: unknown;
		try {
			brut = JSON.parse(ligne);
		} catch {
			throw new Error(`candidat ligne ${index + 1} : JSON invalide`);
		}
		if (!brut || typeof brut !== "object" || Array.isArray(brut)) {
			throw new Error(`candidat ligne ${index + 1} : objet attendu`);
		}
		const candidat = brut as Partial<MangaReviewCandidateInput>;
		const entree = typeof candidat.pageId === "string" ? parPage.get(candidat.pageId) : undefined;
		if (
			candidat.schema !== SHENRON_MANGA_CANDIDATE_SCHEMA ||
			candidat.decision !== "unreviewed" ||
			!entree ||
			candidats.has(entree.id) ||
			candidat.image !== entree.image ||
			candidat.source?.kind !== "manga" ||
			candidat.source.pageId !== entree.id ||
			candidat.source.sourceSha256 !== entree.sourceSha256 ||
			candidat.source.imageSha256 !== entree.imageSha256 ||
			!Array.isArray(candidat.regions) ||
			!candidat.pipeline ||
			typeof candidat.pipeline.name !== "string" ||
			typeof candidat.pipeline.version !== "string"
		) {
			throw new Error(`candidat ligne ${index + 1} : schéma, identité ou SHA-256 incohérent`);
		}
		if (
			candidat.ocr &&
			(candidat.ocr.schema !== "aphrody.ocr.result/v2" ||
				!["text", "needs-review"].includes(candidat.ocr.status) ||
				!Array.isArray(candidat.ocr.blocks))
		) {
			throw new Error(`candidat ligne ${index + 1} : preuve OCR v2 invalide`);
		}
		const image = resolve(dossierLot, entree.image);
		const dansLot = relative(dossierLot, image);
		if (!dansLot || dansLot === ".." || dansLot.startsWith(`..${sep}`) || isAbsolute(dansLot)) {
			throw new Error(`image de candidat hors du lot : ${entree.id}`);
		}
		if ((await sha256File(image)) !== entree.imageSha256) {
			throw new Error(`image de candidat modifiée depuis le manifeste : ${entree.id}`);
		}
		candidats.set(entree.id, candidat as MangaReviewCandidateInput);
	}
	return candidats;
}

if (commande === "prepare") {
	const sortie = opt("sortie");
	if (!sortie) aide();
	await mkdir(sortie, { recursive: true });
	const manifeste = await readMangaManifest(join(dossierLot, "manifest.json"));
	const indices = detectionsDuLot();
	const cheminCandidats = opt("candidates");
	const candidats = cheminCandidats
		? await candidatsDuLot(cheminCandidats, manifeste)
		: new Map<string, MangaReviewCandidateInput>();

	const planches = manifeste.entries.map((e) => {
		const fichier = portableBasename(e.image).toLowerCase();
		const d = indices.get(fichier);
		const candidat = candidats.get(e.id);
		return {
			pageId: e.id,
			image: resolve(join(dossierLot, e.image)),
			// Les indices PP-OCR sont des PROPOSITIONS, pas une vérité : l'agent
			// lit l'image et peut les contredire. Les donner évite surtout de
			// rater une zone difficile.
			indicesPpocr: (d?.blocks ?? [])
				.slice(0, 120)
				.map((b) => ({ texte: b.text, confiance: Number(b.confidence.toFixed(2)) })),
			// Le juge doit ouvrir l'image. Le candidat ne vaut ni transcription
			// confirmée ni seconde lecture indépendante.
			...(candidat
				? { candidatNonRelu: {
					decision: "unreviewed" as const,
					pipeline: candidat.pipeline,
					regions: candidat.regions,
					ocr: candidat.ocr ?? null,
				} }
				: {}),
		};
	});

	const fichier = join(sortie, `lot-${String(LOT).padStart(3, "0")}.json`);
	await atomicWriteText(fichier, `${JSON.stringify({ lot: LOT, racine: RACINE, planches }, null, 2)}\n`);
	console.log(`${planches.length} planche(s) → ${fichier}`);
	console.log(`les images sont à lire sur disque, en chemin absolu, par l'agent lui-même`);
	process.exit(0);
}

if (commande === "sceller") {
	const revues = opt("revues");
	if (!revues || !existsSync(revues)) aide();
	const manifeste = await readMangaManifest(join(dossierLot, "manifest.json"));
	const parPage = new Map(manifeste.entries.map((e) => [e.id, e]));

	const lus = readdirSync(revues).filter((f) => f.endsWith(".json"));
	const revuesParPage = new Map<string, MangaOcrVisualReview>();
	const auditsParPage = new Map<string, MangaOcrCoverageAudit>();
	for (const f of lus) {
		try {
			const o = JSON.parse(await Bun.file(join(revues, f)).text()) as Record<string, unknown>;
			const pageId = String(o.pageId ?? "");
			if (!pageId || !parPage.has(pageId)) continue;
			if (f.includes(".audit.")) auditsParPage.set(pageId, o as unknown as MangaOcrCoverageAudit);
			else revuesParPage.set(pageId, o as unknown as MangaOcrVisualReview);
		} catch {
			console.log(`  ✗ ${f} : JSON illisible`);
		}
	}

	const lignes: string[] = [];
	let scellees = 0;
	let incompletes = 0;
	for (const [pageId, entree] of parPage) {
		const revue = revuesParPage.get(pageId);
		const audit = auditsParPage.get(pageId);
		if (!revue || !audit) {
			incompletes += 1;
			continue;
		}
		try {
			const image = basename(entree.image);
			const premier: MangaOcrResultLine = reviewedMangaResult(
				image,
				pageId,
				revue,
				undefined,
				"hybrid-sonnet-ppocr"
			);
			const scelle = coverageAuditedMangaResult(premier, pageId, audit);
			lignes.push(JSON.stringify(scelle));
			scellees += 1;
		} catch (e) {
			incompletes += 1;
			console.log(`  ✗ ${pageId} : ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	if (lignes.length > 0) {
		const cible = join(dossierLot, "results.jsonl");
		await atomicWriteText(cible, `${lignes.join("\n")}\n`);
		console.log(`\n${scellees} planche(s) scellée(s) → ${cible}`);
	}
	console.log(
		`${scellees} scellée(s), ${incompletes} sans ses deux lectures (non écrite(s), c'est voulu)`
	);
	process.exit(0);
}

aide();

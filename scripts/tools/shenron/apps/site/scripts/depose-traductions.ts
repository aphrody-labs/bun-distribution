#!/usr/bin/env bun
/**
 * Dépose les traductions françaises des planches de databook.
 *
 *   bun apps/site/scripts/depose-traductions.ts /tmp/traductions-01.jsonl
 *   bun apps/site/scripts/depose-traductions.ts /tmp/… --appliquer
 *   bun apps/site/scripts/depose-traductions.ts /tmp/… --par machine:agy --source-relue --appliquer
 *
 * Entrée : un JSONL, une ligne par planche —
 *   {"databookId":4,"page":12,"fr":"…"}
 *   {"databookId":4,"page":12,"fr":"…","ja":"<texte source traduit>"}   (recommandé)
 *
 * `ja`, quand il est fourni, est la GARDE anti-désalignement : la traduction
 * n'est posée que si la planche porte encore exactement ce texte source.
 *
 * Écriture : la clé `text_fr` de la planche dans `bot.db_databooks.pages`, plus
 * `text_fr_by` (qui a traduit) et `text_fr_at` (quand). **Le japonais d'origine
 * n'est jamais touché.** Une instruction SQL par planche (`deposerTraduction`,
 * `_databooks-base.ts`), sous garde optimiste : si la planche (texte ou
 * traduction) a changé depuis sa lecture, rien n'est écrit et le conflit est
 * listé — plus aucune écriture concurrente écrasée en silence.
 *
 * **Simulation par défaut** (`--appliquer` pour écrire), une révision
 * `public.wiki_revisions` par ouvrage et par dépôt, en `traduction#<n>`, la seule
 * convention que le retour arrière de `/admin/wiki/history` sache lire.
 *
 * Juge : `jugerTraduction` — le même pour tous les écrivains (bruit OCR, copie
 * de la source, jeton de masquage non restauré, mots doublés, japonais résiduel,
 * boucle, rapport de longueur). `--source-relue` lève les seuls juges de source
 * (bruit, intraduisible) pour une planche relue à l'image.
 * Une ligne refusée n'interrompt pas le dépôt : elle est comptée et listée.
 */
import postgres from "postgres";
import {
	arretSiGel,
	connecte,
	deposerTraduction,
	jugerTraduction,
	texteDePlanche,
	traductionDePlanche,
	type PlancheBrute,
} from "./_databooks-base";

// Gel des écrivains : sortie 3 avant toute connexion si .coord/FREEZE-databooks.json existe.
arretSiGel("depose-traductions");

const args = process.argv.slice(2);
const flag = (nom: string) => args.includes(`--${nom}`);
const opt = (nom: string, def?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i >= 0 ? (args[i + 1] ?? def) : def;
};
const fichier = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--par");

if (!fichier) {
	console.error(
		await Bun.file(import.meta.path)
			.text()
			.then((t) => t.split("*/")[0]!.replace(/^#!.*\n/, ""))
	);
	process.exit(2);
}

const APPLIQUER = flag("appliquer");
const SOURCE_RELUE = flag("source-relue");
const PAR = opt("par", "machine:sonnet")!;

const sql: postgres.Sql = await connecte();
const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

interface Ligne {
	databookId: number;
	page: number;
	fr: string;
	ja?: string;
}

try {
	const contenu = await Bun.file(fichier).text();
	const lignes: Ligne[] = [];
	let illisibles = 0;
	for (const l of contenu.split("\n")) {
		const brut = l.trim();
		if (!brut) continue;
		try {
			const o = JSON.parse(brut) as Ligne;
			if (
				!Number.isInteger(o.databookId) ||
				!Number.isInteger(o.page) ||
				typeof o.fr !== "string" ||
				(o.ja !== undefined && typeof o.ja !== "string")
			) {
				illisibles++;
				continue;
			}
			lignes.push(o);
		} catch {
			illisibles++;
		}
	}
	if (lignes.length === 0) throw new Error("aucune ligne exploitable");

	const ids = [...new Set(lignes.map((l) => l.databookId))];
	// `= any(${tableau})` casse avec postgres-js (« malformed array literal ») :
	// la forme qui marche est `in ${sql(tableau)}`, que le driver développe.
	const ouvrages = await sql<{ id: string; title: string; pages: PlancheBrute[] | null }[]>`
		SELECT id, title, pages FROM bot.db_databooks WHERE id in ${sql(ids)}
	`;

	let deposees = 0;
	let retenues = 0;
	let refusees = 0;
	const rapports: string[] = [];

	for (const ouvrage of ouvrages) {
		const miennes = lignes.filter((l) => l.databookId === Number(ouvrage.id));
		const pages = ouvrage.pages ?? [];
		const avant: Record<string, unknown> = {};
		const apres: Record<string, unknown> = {};

		for (const ligne of miennes) {
			const planches = pages.filter((p) => Number(p.number) === ligne.page);
			if (planches.length !== 1) {
				rapports.push(
					`  ✗ ${ouvrage.id}/${ligne.page} — ${planches.length === 0 ? "planche absente de l'ouvrage" : "numéro de planche ambigu"}`
				);
				refusees++;
				continue;
			}
			const planche = planches[0]!;
			const texte = texteDePlanche(planche);
			if (ligne.ja !== undefined && ligne.ja.trim() !== texte.trim()) {
				rapports.push(`  ✗ ${ouvrage.id}/${ligne.page} — désalignement : la source traduite n'est plus celle de la planche`);
				refusees++;
				continue;
			}
			const travail = {
				databookId: Number(ouvrage.id),
				numero: ligne.page,
				image: planche.image ?? null,
				source: texte,
				traduction: ligne.fr,
			};
			const verdict = jugerTraduction(travail, undefined, { sourceRelue: SOURCE_RELUE });
			if (!verdict.ok) {
				rapports.push(`  ✗ ${ouvrage.id}/${ligne.page} — ${verdict.motif}`);
				refusees++;
				continue;
			}
			retenues++;
			if (!APPLIQUER) continue;

			// Garde optimiste sur la traduction LUE : une relecture peut remplacer
			// une traduction, mais pas celle qu'un autre dépôt vient de poser.
			const res = await deposerTraduction(
				sql,
				{ ...travail, par: PAR, traductionAttendue: traductionDePlanche(planche) },
				{ sourceRelue: SOURCE_RELUE, journal: (l) => rapports.push(l) }
			);
			if (res.statut !== "ecrite") {
				refusees++;
				continue;
			}
			// Convention `traduction#<n>` — la seule que le retour arrière de
			// `/admin/wiki/history` sache lire.
			avant[`traduction#${ligne.page}`] = res.avant || null;
			apres[`traduction#${ligne.page}`] = res.apres;
			deposees++;
		}

		const touchees = Object.keys(apres).length;
		if (touchees === 0) continue;
		console.log(`${ouvrage.title} (#${ouvrage.id}) : ${touchees} planches traduites`);
		await sql`INSERT INTO public.wiki_revisions ${sql({
			id: idRevision(),
			tableName: "db_databooks",
			rowId: String(ouvrage.id),
			action: "update",
			label: `${ouvrage.title} — traduction FR de ${touchees} planches`,
			before: sql.json(avant as postgres.JSONValue),
			after: sql.json(apres as postgres.JSONValue),
			editorId: "agent",
			editorName: `Traduction ja→fr (${PAR})`,
		})}`;
	}

	if (rapports.length) console.log(`\nrefus :\n${rapports.join("\n")}`);
	console.log(
		`\n${APPLIQUER ? deposees : retenues} traductions ${APPLIQUER ? "déposées" : "retenues"}, ${refusees} refusées${illisibles ? `, ${illisibles} lignes illisibles` : ""}.`
	);
	if (!APPLIQUER) console.log("(simulation — relancer avec --appliquer)");
} catch (e) {
	console.error(`✗ ${(e as Error).message}`);
	process.exitCode = 1;
} finally {
	await sql.end();
}

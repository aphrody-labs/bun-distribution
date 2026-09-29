#!/usr/bin/env bun
/**
 * Retire les illustrations de fan-art des fiches de transformation.
 *
 * Mesuré le 2026-08-27 : sept des 81 transformations visibles sont illustrées
 * par des images qui ne viennent d'aucune source officielle — quatre fan-arts
 * DeviantArt SIGNÉS (`_by_poh2000`, `_by_ssjrose890`, `_by_rmrlr2020`) et trois
 * détourages automatiques amateurs (`-removebg-preview`). Un wiki qui bannit
 * Fandom de son texte depuis le 2026-08-26 ne peut pas continuer à présenter
 * l'œuvre d'un tiers non crédité comme l'illustration de référence d'une forme.
 *
 * Ce qu'on NE fait pas, et pourquoi :
 *
 *   - On ne substitue PAS l'image du personnage. Le lot officiel ne contient ni
 *     la forme finale de Freezer, ni Gogeta en Super Saiyan, ni Trunks SSJ de
 *     l'arc Cell (vérifié à l'image le 2026-08-27). Montrer Gogeta en base sous
 *     le titre « Gogeta SSJ » aurait l'air juste, et c'est précisément ce qui le
 *     rend pire qu'une case vide.
 *   - On ne supprime PAS le fichier sur le disque. Seule la référence en base
 *     part, et elle part dans une révision : si un remplacement fidèle apparaît,
 *     ou si l'arbitrage change, un revert depuis /admin/wiki/history suffit.
 *
 * Le motif est RECOMPTÉ à chaque exécution plutôt que gravé en liste
 * d'identifiants : un nouvel ingest peut réintroduire la même famille d'images,
 * et un script qui ne sait chercher que sept lignes connues ne l'attraperait pas.
 *
 * SIMULATION PAR DÉFAUT. Rien ne part en base sans `--appliquer`.
 *
 * Usage :
 *   bun scripts/retire-fanart-transformations.ts            # simulation
 *   bun scripts/retire-fanart-transformations.ts --appliquer
 */
import postgres from "postgres";
import { join } from "node:path";

const args = process.argv.slice(2);
const APPLIQUER = args.includes("--appliquer");

/**
 * Signatures d'une image qui n'est pas une source officielle.
 *
 *   `_by_<pseudo>`      signature d'auteur DeviantArt, présente dans le nom de
 *                       fichier exporté par le site (`..._by_ssjrose890_de2z0ra`).
 *   `-removebg-preview` sortie de l'outil remove.bg : un détourage automatique,
 *                       dont l'image d'origine est peut-être officielle mais dont
 *                       le traitement ne l'est pas (halo, contours mangés).
 *   `deviantart`        l'URL complète, quand elle a été reprise telle quelle.
 *
 * Volontairement étroit : `_by_` seul attraperait un `render_by_type.webp`
 * légitime, d'où l'exigence d'un pseudo derrière.
 */
const MOTIF_FANART = /(_by_[a-z0-9]{3,}|-removebg-preview|deviantart)/i;

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	// La DERNIÈRE ligne : `.env` porte l'ancienne URL Neon en commentaire AVANT
	// la locale, et un `find` sur la première tape la base morte.
	const lignes = texte.split("\n").filter((l) => l.startsWith("DATABASE_URL="));
	const valeur = lignes
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable.");
		process.exit(1);
	}
	return valeur;
}

/** Identifiant de révision au format du site (24 signes base36). */
const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

const sql = postgres(await urlBase(), { max: 2, prepare: false });

/**
 * `sql.json()` et non `JSON.stringify(...)::jsonb` : postgres-js type le
 * paramètre d'après le cast et ré-encode la chaîne, donc la colonne reçoit un
 * SCALAIRE string. Sur `wiki_revisions.before/after`, ce défaut casse
 * silencieusement le revert de /admin/wiki/history, qui relit un objet.
 */
const jsonb = (valeur: unknown) => sql.json(valeur as Parameters<typeof sql.json>[0]);

type Ligne = { id: number; name: string; image: string };

const lignes = (await sql`
	select id, name, image
	from bot.db_transformations
	where coalesce(image, '') <> ''
	order by name
`) as unknown as Ligne[];

const vises = lignes.filter((l) => MOTIF_FANART.test(l.image));

console.log(`${lignes.length} transformations illustrées, ${vises.length} visées.\n`);
for (const l of vises) {
	const raison = /-removebg-preview/i.test(l.image) ? "détourage automatique" : "fan-art signé";
	console.log(`  #${l.id} ${l.name}\n      ${raison} — ${l.image}`);
}

if (vises.length === 0) {
	console.log("\nRien à retirer.");
	await sql.end();
	process.exit(0);
}

if (!APPLIQUER) {
	console.log(`\n(simulation — relancer avec --appliquer pour retirer ces ${vises.length} images)`);
	await sql.end();
	process.exit(0);
}

await sql.begin(async (tx) => {
	for (const l of vises) {
		await tx`update bot.db_transformations set image = null where id = ${l.id}`;
		await tx`insert into public.wiki_revisions ${tx({
			id: idRevision(),
			tableName: "db_transformations",
			rowId: String(l.id),
			action: "update",
			label: l.name,
			before: jsonb({ image: l.image }),
			after: jsonb({ image: null }),
			editorId: "script",
			editorName: "retire-fanart-transformations (illustration non officielle)",
		})}`;
	}
});

console.log(`\n✔ ${vises.length} illustrations retirées et versionnées.`);
await sql.end();

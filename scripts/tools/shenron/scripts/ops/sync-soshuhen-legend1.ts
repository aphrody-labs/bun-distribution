#!/usr/bin/env bun
/**
 * Synchronise la fiche bibliographique Sōshūhen Legend 1 avec les éléments
 * éditoriaux vérifiés. Les 381 références de scans DragonBallCN restent des
 * pointeurs d'acquisition : cette commande ne les télécharge ni ne les publie.
 *
 * Usage:
 *   DATABASE_URL=… bun scripts/ops/sync-soshuhen-legend1.ts --apply
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const ISBN = "978-4-08-111165-7";
const TITLE = "Dragon Ball Sōshūhen — Digest Edition Vol. 1";
const SOURCE_URL = "https://www.dreamnews.jp/press/0000131506";
const COVER_PATH = "./assets/wiki/databooks/ad0e860c-fab3-4d03-ae50-41b77ea7c5ff.jpg";
const DESCRIPTION =
	"**DRAGON BALL 総集編 超悟空伝 Legend 1** (*Dragon Ball Sōshūhen — Digest Edition Vol. 1*) est le premier volume de la collection commémorant le 30ᵉ anniversaire de la prépublication du manga d'Akira Toriyama, paru le 13 mai 2016 chez Shueisha.\n\n" +
	"### Caractéristiques de l'édition\n" +
	"* **Format magazine d'époque** : Édition grand format B5 (18,2 × 25,7 cm) reproduisant fidèlement la mise en page originale du *Weekly Shōnen Jump* des années 1984-1985.\n" +
	"* **Présentation historique intégrale** : Rétablit toutes les pages quadrichromes et bicolores d'origine, les catchphrases des pages-titres, les logos d'époque et les annonces de prépublication du numéro suivant.\n" +
	"* **Arc narratif** : Couvre l'intégralité de la quête initiale des Dragon Balls (chapitres 1 à 23), de la rencontre entre Son Goku et Bulma jusqu'au vœu exaucé par Shenron au château de Pilaf et la transformation en singe géant (Oozaru).\n" +
	"* **Suppléments exclusifs** : Inclut un poster dépliant grand format à double face et, dans le premier tirage, une carte collector *Dragon Ball Heroes* de Son Goku.";

function databaseUrl(): string | null {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	if (process.env.REMOTE_DATABASE_URL?.trim()) return process.env.REMOTE_DATABASE_URL.trim();
	const envPath = process.env.SHENRON_PG_ENV ?? `${homedir()}/.shenron-neon.env`;
	if (!existsSync(envPath)) return null;
	const line = readFileSync(envPath, "utf8")
		.split("\n")
		.findLast((entry) => entry.startsWith("DATABASE_URL="));
	return line?.slice("DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "") || null;
}

const url = databaseUrl();
if (!url) throw new Error("DATABASE_URL ou REMOTE_DATABASE_URL est requis.");

const sql = postgres(url, { max: 1, prepare: false });
try {
	const [before] = await sql<{
		id: number;
		title: string;
		isbn: string | null;
		cover: string | null;
		scan_slots: number;
		source_url: string | null;
		pages: Array<{ number: number; image: string | null; text?: string | null; verifiee?: boolean }>;
	}>`
		SELECT id, title, isbn, cover, pages, jsonb_array_length(pages)::int AS scan_slots, source_url
		FROM bot.db_databooks WHERE isbn = ${ISBN} LIMIT 1
	`;
	if (!before) throw new Error(`Fiche ISBN ${ISBN} introuvable.`);
	if (before.title !== TITLE) throw new Error(`Titre inattendu pour ${ISBN}: ${before.title}`);

	const updatedPages = Array.isArray(before.pages) ? [...before.pages] : [];
	if (updatedPages.length > 0) {
		updatedPages[0] = {
			...updatedPages[0],
			number: 1,
			image: COVER_PATH,
			text: "Couverture originale du Weekly Shōnen Jump Digest Edition — Dragon Ball Sōshūhen Legend 1.",
			verifiee: true,
		};
	}

	console.log(
		JSON.stringify(
			{
				mode: APPLY ? "apply" : "dry-run",
				id: before.id,
				title: before.title,
				scanSlots: before.scan_slots,
				coverBefore: before.cover,
				coverAfter: COVER_PATH,
				sourceUrlBefore: before.source_url,
				sourceUrlAfter: SOURCE_URL,
				page1After: updatedPages[0],
			},
			null,
			2
		)
	);
	if (!APPLY) process.exit(0);

	await sql`
		UPDATE bot.db_databooks
		SET
			source_url = ${SOURCE_URL},
			description = ${DESCRIPTION},
			cover = ${COVER_PATH},
			pages = ${sql.json(updatedPages)}
		WHERE id = ${before.id}
	`;
	console.log(`✓ Fiche ${before.id} synchronisée. Lancez ensuite rag-resync-entites.ts databooks --appliquer.`);
} finally {
	await sql.end();
}

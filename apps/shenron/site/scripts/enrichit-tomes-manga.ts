#!/usr/bin/env bun
/**
 * Enrichit `bot.db_manga_volumes` avec la bibliographie relevée du catalogue
 * de comic.dragonballcn.com (`bun apps/shenron/bot/scripts/crawl-dragonballcn.ts`).
 *
 * Mesuré le 2026-09-03 : les 65 tomes en base (42 DB + 23 DBS) portent un titre
 * générique (« Dragon Ball Vol. 1 ») et **zéro** titre japonais, ISBN ou date de
 * parution. Le catalogue, lui, donne les 42/42 pour l'édition japonaise originale :
 * ISBN, date de première édition, titre du volume tel que l'éditeur l'imprime.
 *
 * DEUX PIÈGES, tous deux mesurés plutôt que supposés :
 *
 *  1. **Le titre du volume est parfois coupé sur deux lignes.** Le site sépare
 *     « 巻二 ドラゴンボール » et « 危機一髪 » par un `<br>` : prendre la dernière
 *     ligne rend « 危機一髪 » et perd la moitié du titre. On repart donc de la
 *     ligne qui commence par 巻 et on joint tout ce qui suit (vérifié : 42/42 des
 *     tomes ont une telle ligne).
 *
 *  2. **`published_at` est en SECONDES**, pas en millisecondes — relevé sur
 *     `db_movies` (535420800 = 1986) et `db_episodes`. Écrire des millisecondes y
 *     placerait les tomes en l'an 56 000 sans qu'aucune contrainte ne proteste.
 *
 * Une valeur déjà présente n'est jamais écrasée (sauf `--force`) : le catalogue
 * est une source d'appoint, pas une autorité sur ce qu'un humain a saisi.
 *
 * SIMULATION PAR DÉFAUT. Rien ne part en base sans `--appliquer`, et chaque tome
 * écrit laisse une révision dans `public.wiki_revisions` → réversible depuis
 * `/admin/wiki/history`.
 *
 * Usage :
 *   bun apps/shenron/site/scripts/enrichit-tomes-manga.ts                 # simulation
 *   bun apps/shenron/site/scripts/enrichit-tomes-manga.ts --appliquer
 *   bun apps/shenron/site/scripts/enrichit-tomes-manga.ts --force --appliquer
 */
import { join } from "node:path";
import postgres from "postgres";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const APPLIQUER = flag("appliquer");
const FORCE = flag("force");
const CATALOGUE = opt(
	"catalogue",
	join(import.meta.dir, "..", "..", "bot", "data", "catalogues", "dragonballcn.json")
)!;

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	// La dernière ligne `^DATABASE_URL=` fait foi : l'ancienne URL Neon la précède, en commentaire.
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

const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

/** Le titre du volume court de la ligne « 巻… » jusqu'au bout du bloc. */
function titreDuVolume(lignes: string[] | undefined): string | null {
	if (!lignes?.length) return null;
	const debut = lignes.findIndex((l) => l.startsWith('巻'));
	return debut < 0 ? null : lignes.slice(debut).join(" ").trim() || null;
}

/** « 1985/09/15 » → epoch en SECONDES (UTC), comme le reste des tables du wiki. */
function enSecondes(date: string | undefined): number | null {
	const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(date?.trim() ?? "");
	if (!m) return null;
	const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

const numeroDeTome = (titre: string | undefined) => {
	const m = /\((\d+)\)/.exec(titre ?? "");
	return m ? Number(m[1]) : null;
};

type Tome = {
	id: number;
	volume_number: number | null;
	title: string | null;
	title_ja: string | null;
	isbn: string | null;
	published_at: number | null;
};

const sql = postgres(await urlBase(), { max: 2, prepare: false });
const jsonb = (valeur: unknown) => sql.json(valeur as Parameters<typeof sql.json>[0]);

try {
	const catalogue = await Bun.file(CATALOGUE).json();
	const collection = catalogue.collections?.find(
		(c: { slug: string }) => c.slug === "dragonball_jp_original"
	);
	if (!collection) {
		console.error(`✗ Collection « dragonball_jp_original » absente de ${CATALOGUE}.`);
		console.error("  Relever d'abord : bun apps/shenron/bot/scripts/crawl-dragonballcn.ts");
		process.exit(1);
	}

	// Le catalogue, indexé par numéro de tome.
	const parNumero = new Map<
		number,
		{ titreJa: string | null; isbn: string | null; date: number | null }
	>();
	for (const o of collection.ouvrages as Record<string, string & string[]>[]) {
		const numero = numeroDeTome(o.titre_tome as string | undefined);
		if (!numero) continue;
		parNumero.set(numero, {
			titreJa: titreDuVolume(o.lignes as string[] | undefined),
			isbn: (o.isbn as string | undefined) ?? null,
			date: enSecondes(o.premiere_edition as string | undefined),
		});
	}
	console.log(`Catalogue : ${parNumero.size} tomes japonais relevés.`);

	const tomes = (await sql`
		select id, volume_number, title, title_ja, isbn, published_at
		from bot.db_manga_volumes
		where series = 'DB'
		order by volume_number
	`) as unknown as Tome[];
	console.log(`Base      : ${tomes.length} tomes de la série DB.\n`);

	let ecrits = 0;
	let inchanges = 0;
	let sansSource = 0;

	for (const tome of tomes) {
		const source = tome.volume_number ? parNumero.get(Number(tome.volume_number)) : undefined;
		if (!source) {
			sansSource++;
			continue;
		}

		const maj: Record<string, string | number> = {};
		if (source.titreJa && (FORCE || !tome.title_ja)) maj.title_ja = source.titreJa;
		if (source.isbn && (FORCE || !tome.isbn)) maj.isbn = source.isbn;
		if (source.date && (FORCE || !tome.published_at)) maj.published_at = source.date;

		if (Object.keys(maj).length === 0) {
			inchanges++;
			continue;
		}

		const apercu = Object.entries(maj)
			.map(([c, v]) =>
				c === "published_at"
					? `${c}=${new Date(Number(v) * 1000).toISOString().slice(0, 10)}`
					: `${c}=${v}`
			)
			.join(" · ");
		console.log(`  tome ${String(tome.volume_number).padStart(2)} → ${apercu}`);
		ecrits++;

		if (!APPLIQUER) continue;

		const avant = {
			title_ja: tome.title_ja,
			isbn: tome.isbn,
			published_at: tome.published_at,
		};
		await sql.begin(async (tx) => {
			await tx`update bot.db_manga_volumes set ${tx(maj)} where id = ${tome.id}`;
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: idRevision(),
				tableName: "db_manga_volumes",
				rowId: String(tome.id),
				action: "update",
				label: tome.title ?? `db_manga_volumes#${tome.id}`,
				before: jsonb(avant),
				after: jsonb({ ...avant, ...maj }),
				editorId: "catalogue-dragonballcn",
				editorName: "Catalogue comic.dragonballcn.com (bibliographie éditeur)",
			})}`;
		});
	}

	console.log(
		`\n${ecrits} tome(s) ${APPLIQUER ? "enrichi(s)" : "à enrichir"} · ${inchanges} déjà complet(s) · ${sansSource} sans correspondance.`
	);
	if (!APPLIQUER && ecrits > 0) console.log("(simulation — relancer avec --appliquer)");
} finally {
	await sql.end();
}

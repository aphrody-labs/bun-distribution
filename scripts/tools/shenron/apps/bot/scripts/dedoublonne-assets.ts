#!/usr/bin/env bun
/**
 * Retire de `bot.db_assets` les lignes qui décrivent DEUX FOIS le même fichier.
 *
 * Le juge est le `sha256` : deux lignes de même empreinte pointent un contenu
 * identique au bit près. Mesuré le 2026-09-03 : 64 lignes surnuméraires sur 1 142,
 * réparties en 64 groupes de deux.
 *
 * TROIS GARDE-FOUS, parce qu'effacer une ligne d'inventaire est irréversible côté
 * usage même quand elle l'est côté base :
 *
 *  1. **On ne supprime que ce que plus rien ne référence.** Les 13 colonnes du
 *     wiki qui portent un chemin d'image (`db_characters.image`, `db_movies.poster`,
 *     `db_manga_volumes.cover`…) sont interrogées ligne par ligne. Une ligne encore
 *     citée est conservée, même en double — une fiche qui perd son illustration est
 *     un dégât visible, un doublon ne l'est pas.
 *  2. **Le fichier reste sur le disque.** Seule la ligne d'inventaire part. Rien
 *     n'est perdu, et une révision suffit à la rétablir.
 *  3. **Une révision `public.wiki_revisions` par suppression**, avec la ligne
 *     entière dans `before` → réversible depuis `/admin/wiki/history`.
 *
 * De chaque groupe on garde le plus PETIT id : c'est le premier entré, donc celui
 * que d'anciens contenus ont le plus de chances de citer.
 *
 * SIMULATION PAR DÉFAUT.
 *
 * Usage :
 *   bun apps/bot/scripts/dedoublonne-assets.ts
 *   bun apps/bot/scripts/dedoublonne-assets.ts --appliquer
 */
import { join } from "node:path";
import postgres from "postgres";

const APPLIQUER = process.argv.includes("--appliquer");
const RACINE_BOT = join(import.meta.dir, "..");

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(RACINE_BOT, "..", "site", ".env"))
		.text()
		.catch(() => "");
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

const sql = postgres(await urlBase(), { max: 2, prepare: false });
const jsonb = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

try {
	const surnumeraires = (await sql`
		with groupes as (
			select sha256, min(id) as garde
			from bot.db_assets where sha256 is not null
			group by sha256 having count(*) > 1
		)
		select a.*, g.garde
		from groupes g
		join bot.db_assets a on a.sha256 = g.sha256 and a.id <> g.garde
		order by a.id
	`) as unknown as (Record<string, unknown> & { id: number; path: string; garde: number })[];

	console.log(`${surnumeraires.length} ligne(s) en double.\n`);

	let retires = 0,
		gardes = 0;
	for (const ligne of surnumeraires) {
		const [reference] = (await sql`
			select 1 as vu where exists (
				select 1 from bot.db_characters where image = ${ligne.path}
				union all select 1 from bot.db_planets where image = ${ligne.path}
				union all select 1 from bot.db_transformations where image = ${ligne.path}
				union all select 1 from bot.db_sagas where image = ${ligne.path}
				union all select 1 from bot.db_techniques where image = ${ligne.path}
				union all select 1 from bot.db_episodes where image = ${ligne.path}
				union all select 1 from bot.db_news where image = ${ligne.path}
				union all select 1 from bot.db_movies where poster = ${ligne.path}
				union all select 1 from bot.db_games where cover = ${ligne.path}
				union all select 1 from bot.db_databooks where cover = ${ligne.path}
				union all select 1 from bot.db_manga_volumes where cover = ${ligne.path}
				union all select 1 from bot.db_manga_chapters where cover = ${ligne.path}
				union all select 1 from bot.db_character_variants where image = ${ligne.path}
			)
		`) as unknown as { vu: number }[];

		if (reference) {
			gardes++;
			console.log(`  gardé #${ligne.id} — encore cité par une fiche (${ligne.path})`);
			continue;
		}

		console.log(`  #${ligne.id} → doublon de #${ligne.garde} · ${ligne.path}`);
		retires++;
		if (!APPLIQUER) continue;

		const { garde: _garde, ...avant } = ligne;
		await sql.begin(async (tx) => {
			await tx`delete from bot.db_assets where id = ${ligne.id}`;
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: idRevision(),
				tableName: "db_assets",
				rowId: String(ligne.id),
				action: "delete",
				label: ligne.path,
				before: jsonb(avant),
				after: jsonb(null),
				editorId: "dedoublonnage",
				editorName: "Dédoublonnage par sha256 (fichier conservé sur disque)",
			})}`;
		});
	}

	console.log(
		`\n${retires} ligne(s) ${APPLIQUER ? "retirée(s)" : "à retirer"} · ${gardes} gardée(s) car encore citée(s).`
	);
	if (!APPLIQUER && retires > 0) console.log("(simulation — relancer avec --appliquer)");
} finally {
	await sql.end();
}

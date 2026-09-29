#!/usr/bin/env bun
/**
 * Nettoyage des titres japonais et dates de diffusion erronés sur les 6 épisodes
 * internationaux de DBZ_KAI_FINAL (signalement #15).
 *
 * Fiches 4, 5, 9, 11, 14, 16 : épisodes internationaux non diffusés au Japon
 * (101, 102, 106, 108, 111, 113). Leurs title_ja, title_romaji et air_date avaient
 * été copiés sur les fiches 8, 10, 17, 19, 22, 24.
 *
 * Usage :
 *   bun apps/shenron/site/scripts/corrige-kai-final-titres.ts            # simulation
 *   bun apps/shenron/site/scripts/corrige-kai-final-titres.ts --appliquer # applique avec wiki_revisions
 */
import { join } from "node:path";
import postgres from "postgres";

const APPLIQUER = process.argv.includes("--appliquer");

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const lignes = texte.split("\n").filter((l) => l.startsWith("DATABASE_URL="));
	const valeur = lignes
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) throw new Error("DATABASE_URL introuvable.");
	return valeur;
}

const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

const CIBLES = ["4", "5", "9", "11", "14", "16"];

const sql = postgres(await urlBase(), { max: 2, prepare: false });

try {
	const fiches = await sql<
		{
			id: string;
			number_in_series: string;
			title: string;
			title_ja: string | null;
			title_romaji: string | null;
			air_date: string | null;
		}[]
	>`
		SELECT id, number_in_series, title, title_ja, title_romaji, air_date
		FROM bot.db_episodes
		WHERE series = 'DBZ_KAI_FINAL' AND number_in_series IN ${sql(CIBLES)}
		ORDER BY CAST(number_in_series AS INT)`;

	console.log(`${fiches.length} fiche(s) examinée(s) pour DBZ_KAI_FINAL :`);

	let modifiees = 0;
	for (const f of fiches) {
		const avant = {
			title_ja: f.title_ja,
			title_romaji: f.title_romaji,
			air_date: f.air_date ? Number(f.air_date) : null,
		};
		const apres = {
			title_ja: null,
			title_romaji: null,
			air_date: null,
		};

		if (f.title_ja === null && f.title_romaji === null && f.air_date === null) {
			console.log(`  ✓ Fiche #${f.number_in_series} « ${f.title} » déjà nettoyée.`);
			continue;
		}

		console.log(
			`  • Fiche #${f.number_in_series} « ${f.title} » (id ${f.id}) :\n` +
				`      ja      : ${avant.title_ja} → null\n` +
				`      rōmaji  : ${avant.title_romaji} → null\n` +
				`      air_date: ${avant.air_date} → null`
		);
		modifiees++;

		if (APPLIQUER) {
			await sql.begin(async (tx) => {
				await tx`
					UPDATE bot.db_episodes
					SET title_ja = NULL, title_romaji = NULL, air_date = NULL
					WHERE id = ${Number(f.id)}
				`;
				await tx`
					INSERT INTO public.wiki_revisions ${tx({
						id: idRevision(),
						tableName: "db_episodes",
						rowId: String(f.id),
						action: "update",
						label: `DBZ_KAI_FINAL ${f.number_in_series} — purge des titres et air_date copiés (épisode international non diffusé au Japon)`,
						before: tx.json(avant),
						after: tx.json(apres),
						editorId: "agent",
						editorName: "Agent Shenron (Arbitrage signalement #15)",
					})}
				`;
			});
		}
	}

	console.log(
		APPLIQUER
			? `\n✔ ${modifiees} fiche(s) nettoyée(s) et versionnée(s) dans wiki_revisions.`
			: `\n${modifiees} fiche(s) à nettoyer.\n(simulation — relancer avec --appliquer)`
	);
} finally {
	await sql.end();
}

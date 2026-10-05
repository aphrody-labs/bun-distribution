// SPDX-License-Identifier: Apache-2.0
/**
 * Orchestrateur des lots OCR Manga (Dragon Ball & Dragon Ball Super)
 * pour le travail GPU local.
 *
 * Utilisation :
 *   bun scripts/ops/batch-manga-ocr.ts --statut
 *   bun scripts/ops/batch-manga-ocr.ts --series DB --taille 50 --exporter
 *   bun scripts/ops/batch-manga-ocr.ts --series DBS --exporter
 */


import { join } from "node:path";
import { connecte } from "../../../../../apps/shenron/site/scripts/_databooks-base";

const args = process.argv.slice(2);
const opt = (nom: string, defaut?: string) => {
	const i = args.indexOf(`--${nom}`);
	return i !== -1 && args[i + 1] ? args[i + 1]! : defaut;
};
const flag = (nom: string) => args.includes(`--${nom}`);

const STATUT = flag("statut");
const EXPORTER = flag("exporter");
const SERIES = (opt("series", "DB,DBS") ?? "DB,DBS").split(",").map((s) => s.trim().toUpperCase());
const TAILLE_LOT = Number(opt("taille", "100"));

async function main() {
	console.log("=== Orchestration des Lots Manga OCR pour GPU Local ===");

	const sql = await connecte();
	try {
		const seriesStats = await sql<
			{
				series: string;
				total_pages: number;
				pages_avec_texte: number;
				tomes_count: number;
			}[]
		>`
			SELECT 
				series,
				count(*)::int as total_pages,
				sum(case when text is not null and length(trim(text)) > 0 then 1 else 0 end)::int as pages_avec_texte,
				count(distinct tome)::int as tomes_count
			FROM bot.db_manga_pages
			WHERE series = ANY(${SERIES})
			GROUP BY series
			ORDER BY series
		`;

		console.log("\nÉtat actuel du corpus Manga (PostgreSQL) :");
		console.table(seriesStats);

		const tomesStats = await sql<
			{
				series: string;
				tome: string;
				total: number;
				avec_texte: number;
			}[]
		>`
			SELECT 
				series,
				tome,
				count(*)::int as total,
				sum(case when text is not null and length(trim(text)) > 0 then 1 else 0 end)::int as avec_texte
			FROM bot.db_manga_pages
			WHERE series = ANY(${SERIES})
			GROUP BY series, tome
			ORDER BY series, length(tome), tome
		`;

		const tomesIncomplets = tomesStats.filter((t) => t.avec_texte < t.total);
		console.log(`\nNombre total de tomes / volumes : ${tomesStats.length}`);
		console.log(`Tomes avec planches manquantes : ${tomesIncomplets.length}`);

		if (tomesIncomplets.length > 0) {
			console.log("Détail des tomes incomplets :");
			console.table(tomesIncomplets);
		} else {
			console.log("✓ 100% des planches DB et DBS enregistrées en base possèdent déjà une transcription.");
		}

		if (EXPORTER) {
			console.log("\nDéclenchement de l'export de lots manga via apps/bot/scripts/export-manga-ocr.ts...");
			const cmd = [
				"bun",
				"apps/bot/scripts/export-manga-ocr.ts",
				"--series",
				SERIES.join(","),
				"--taille",
				String(TAILLE_LOT),
				"--sortie",
				join(process.cwd(), "data", "manga-ocr"),
			];
			console.log(`$ ${cmd.join(" ")}`);
			const proc = Bun.spawnSync(cmd, { stdio: ["inherit", "inherit", "inherit"] });
			if (proc.exitCode !== 0) {
				throw new Error(`export-manga-ocr a échoué avec le code ${proc.exitCode}`);
			}
		}
	} finally {
		await sql.end();
	}
}

main().catch((err) => {
	console.error("Erreur lors de l'orchestration des lots manga :", err);
	process.exit(1);
});

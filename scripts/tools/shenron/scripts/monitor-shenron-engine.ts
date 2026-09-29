#!/usr/bin/env bun
import postgres from "postgres";
import { embedHealthUrl } from "@shenron/pipeline/ai/config";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL est requis pour le monitoring live");
const sql = postgres(databaseUrl);

async function main() {
	console.log("\n========================================================");
	console.log("   SHENRON SOVEREIGN ENGINE — MONITORING LIVE");
	console.log("========================================================\n");

	// 1. Databooks Traduction
	const databooks = await sql`SELECT count(*)::int as c FROM bot.db_databooks`;
	const pagesStats = await sql`
    WITH all_pages AS (
      SELECT jsonb_array_elements(COALESCE(pages, '[]'::jsonb)) as p FROM bot.db_databooks
    )
    SELECT
      count(*)::int as total_pages,
      count(*) FILTER (WHERE length(trim(COALESCE(p->>'text', ''))) > 0)::int as with_text,
      count(*) FILTER (WHERE length(trim(COALESCE(p->>'text_fr', p->>'translation', ''))) > 0)::int as with_trans
    FROM all_pages
  `;
	const dbk = pagesStats[0];

	console.log("📖 DATABOOKS TRADUCTION PIPELINE :");
	console.log(`   - Databooks catalogués : ${databooks[0].c}`);
	console.log(`   - Planches totales      : ${dbk.total_pages}`);
	console.log(
		`   - Transcrites (JA)      : ${dbk.with_text} (${((dbk.with_text / dbk.total_pages) * 100).toFixed(1)} %)`
	);
	console.log(
		`   - Traduites (FR)        : ${dbk.with_trans} (${((dbk.with_trans / dbk.total_pages) * 100).toFixed(1)} %)`
	);
	console.log(`   - En attente traduction : ${dbk.with_text - dbk.with_trans} planches\n`);

	// 2. Manga OCR
	const [mangaCount] = await sql`SELECT count(*)::int as total FROM bot.db_manga_pages`;
	const [mangaWithText] =
		await sql`SELECT count(*)::int as with_text FROM bot.db_manga_pages WHERE text IS NOT NULL AND length(trim(text)) > 0`;
	const [mangaWithJa] =
		await sql`SELECT count(*)::int as with_ja FROM bot.db_manga_pages WHERE has_ja = 1`;
	const [chaptersCount] = await sql`SELECT count(*)::int as count FROM bot.db_manga_chapters`;

	console.log("💥 MANGA TRANSCRIPTION & OCR :");
	console.log(`   - Chapitres au catalogue: ${chaptersCount.count}`);
	console.log(`   - Planches indexées     : ${mangaCount.total}`);
	console.log(
		`   - Planches avec texte   : ${mangaWithText.with_text} (${((mangaWithText.with_text / mangaCount.total) * 100).toFixed(1)} %)`
	);
	console.log(`   - Planches avec bulles JA : ${mangaWithJa.with_ja}\n`);

	// 3. Bot API & Services
	console.log("🤖 BOT API & MCP ENGINE :");
	try {
		const health = await fetch("http://127.0.0.1:5006/health/check").then((r) => r.json());
		console.log(
			`   - Bot Discord / API (:5006) : ONLINE (Uptime: ${Math.floor(health.uptime / 60)} min, Version: ${health.version})`
		);
	} catch {
		console.log(`   - Bot Discord / API (:5006) : OFFLINE`);
	}

	try {
		const mcp = await fetch("http://127.0.0.1:5010/health").then((r) => r.json());
		console.log(
			`   - MCP Public (:5010)        : ONLINE (${mcp.tools} outils, upstream: ${mcp.upstream})`
		);
	} catch {
		console.log(`   - MCP Public (:5010)        : OFFLINE`);
	}

	const embedHealth = embedHealthUrl(process.env);
	if (!embedHealth) {
		console.log(`   - Embeddings E5              : NOT CONFIGURED (APHRODY_AI_EMBED_BASE_URL)`);
	} else {
		try {
			const embed = await fetch(embedHealth).then((r) => r.json());
			console.log(
				`   - Embeddings E5 (${embedHealth.host}): ONLINE (${embed.model || "multilingual-e5-small"})`
			);
		} catch {
			console.log(`   - Embeddings E5 (${embedHealth.host}): OFFLINE`);
		}
	}

	console.log("\n========================================================\n");
	await sql.end();
}

main().catch(console.error);

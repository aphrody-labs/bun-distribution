import postgres from "postgres";
import { CHARACTER_CANONICAL_SLUGS, PLANET_CANONICAL_SLUGS, TRANSFORMATION_CANONICAL_SLUGS } from "../src/lib/wiki-slugs";

async function databaseUrl() {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db").text().catch(() => "");
	const line = env.split("\n").findLast((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line?.slice("REMOTE_DATABASE_URL=".length).trim().replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

const tables = [
	["db_arcs", "jsonb"], ["db_battles", "text"], ["db_characters", "jsonb"], ["db_dragons", "text"], ["db_items", "text"], ["db_locations", "text"], ["db_planets", "jsonb"], ["db_power_levels", "text"], ["db_races", "jsonb"], ["db_sagas", "jsonb"], ["db_soundtracks", "text"], ["db_techniques", "jsonb"], ["db_timeline_events", "text"], ["db_tournaments", "text"], ["db_transformations", "jsonb"], ["db_voice_actors", "text"], ["db_wishes", "text"],
] as const;

let movieSlugs = new Map<string, string>();

function rewriteLinks(input: string): string {
	return input
		.replace(/\/wiki\/dragon-ball\/character\/(\d+)/g, (_, id: string) => `/wiki/personnages/${CHARACTER_CANONICAL_SLUGS[Number(id)] ?? id}`)
		.replace(/\/wiki\/dragon-ball\/planet\/(\d+)/g, (_, id: string) => `/wiki/cosmologie/${PLANET_CANONICAL_SLUGS[Number(id)] ?? id}`)
		.replace(/\/wiki\/planetes\/(\d+)/g, (_, id: string) => `/wiki/cosmologie/${PLANET_CANONICAL_SLUGS[Number(id)] ?? id}`)
		.replace(/\/wiki\/dragon-ball\/transformation\/(\d+)/g, (_, id: string) => `/wiki/transformations/${TRANSFORMATION_CANONICAL_SLUGS[Number(id)] ?? id}`)
		.replace(/\/wiki\/dragon-ball\/techniques\//g, "/wiki/techniques/")
		.replace(/\/wiki\/dragon-ball\/technique\//g, "/wiki/techniques/")
		.replace(/\/wiki\/dragon-ball\/games\//g, "/wiki/jeux/")
		.replace(/\/wiki\/dragon-ball\/movie\/(\d+)/g, (_, id: string) => `/wiki/films/${movieSlugs.get(id) ?? id}`)
		.replace(/\/wiki\/films\/(\d+)/g, (_, id: string) => `/wiki/films/${movieSlugs.get(id) ?? id}`);
}

function normalizeVolumeSources(value: unknown, valid: Set<string>): unknown {
	if (!Array.isArray(value)) return value;
	return value.map((source) => {
		if (!source || typeof source !== "object") return source;
		const item = { ...(source as Record<string, unknown>) };
		const url = String(item.url ?? "");
		const marker = "/wiki/manga/volume/";
		const index = url.indexOf(marker);
		if (index >= 0) {
			const oldId = url.slice(index + marker.length).split(/[?#/]/)[0];
			if (!valid.has(oldId)) {
				const label = String(item.label ?? "");
				const match = label.match(/(?:Super\s+)?(?:Vol(?:ume)?\.?|Tomes?)\s+(\d+)/i);
				if (match) {
					const number = Number(match[1]);
					const base = /Dragon Ball Super/i.test(label) ? 123 : 81;
					item.url = `${url.slice(0, index + marker.length)}${base + number}${url.slice(index + marker.length + oldId.length)}`;
				}
			}
		}
		return item;
	});
}

const sql = postgres(await databaseUrl(), { max: 1 });
let changed = 0;
try {
	const volumes = await sql.unsafe("select id from bot.db_manga_volumes");
	const validVolumes = new Set(volumes.map((row) => String(row.id)));
	const movies = await sql.unsafe("select id,slug from bot.db_movies where slug is not null");
	movieSlugs = new Map(movies.map((row) => [String(row.id), String(row.slug)]));
	for (const [table, type] of tables) {
		const rows = await sql.unsafe(`select id,article_sources from bot.${table} where visible is distinct from false and article_sources is not null`);
		for (const row of rows) {
			let parsed: unknown = row.article_sources;
			if (typeof parsed === "string") {
				try { parsed = JSON.parse(parsed); } catch { continue; }
			}
			const normalized = normalizeVolumeSources(parsed, validVolumes);
		const beforeText = typeof row.article_sources === "string" ? row.article_sources : JSON.stringify(parsed);
		let afterText = JSON.stringify(normalized);
		if (type === "text" && typeof row.article_sources === "string") afterText = String(normalized === parsed ? row.article_sources : afterText);
		const rewritten = rewriteLinks(afterText);
		if (rewritten === beforeText) continue;
		await sql.begin(async (tx) => {
			if (type === "jsonb") await tx.unsafe(`update bot.${table} set article_sources=$1::jsonb where id=$2 and visible is distinct from false`, [rewritten, String(row.id)]);
			else await tx.unsafe(`update bot.${table} set article_sources=$1 where id=$2 and visible is distinct from false`, [rewritten, String(row.id)]);
			await tx.unsafe('insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)', [crypto.randomUUID(), table, String(row.id), "update", "Correction des liens de sources wiki", JSON.stringify({ article_sources: beforeText }), JSON.stringify({ article_sources: rewritten }), "shenron-source-integrity", "Shenron — intégrité des sources wiki"]);
		});
			changed++;
		}
	}
	console.log(JSON.stringify({ changed }));
} finally {
	await sql.end({ timeout: 5 });
}

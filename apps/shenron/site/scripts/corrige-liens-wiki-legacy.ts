#!/usr/bin/env bun
/** Réécrit les anciens préfixes de liens wiki et conserve chaque version. */
import postgres from "postgres";
import {
	CHARACTER_CANONICAL_SLUGS,
	PLANET_CANONICAL_SLUGS,
	TRANSFORMATION_CANONICAL_SLUGS,
} from "../src/lib/wiki-slugs";

const apply = process.argv.includes("--appliquer");
const tables = [
	"db_characters",
	"db_planets",
	"db_techniques",
	"db_transformations",
	"db_sagas",
	"db_races",
	"db_arcs",
] as const;

function rewrite(input: string): string {
	let output = input;
	output = output.replace(
		/\/wiki\/dragon-ball\/character\/(\d+)/g,
		(_, id: string) => `/wiki/personnages/${CHARACTER_CANONICAL_SLUGS[Number(id)] ?? id}`
	);
	output = output.replace(
		/\/wiki\/dragon-ball\/planet\/(\d+)/g,
		(_, id: string) => `/wiki/cosmologie/${PLANET_CANONICAL_SLUGS[Number(id)] ?? id}`
	);
	output = output.replace(
		/\/wiki\/planetes\/(\d+)/g,
		(_, id: string) => `/wiki/cosmologie/${PLANET_CANONICAL_SLUGS[Number(id)] ?? id}`
	);
	output = output.replace(
		/\/wiki\/dragon-ball\/transformation\/(\d+)/g,
		(_, id: string) => `/wiki/transformations/${TRANSFORMATION_CANONICAL_SLUGS[Number(id)] ?? id}`
	);
	output = output.replace(/\/wiki\/dragon-ball\/techniques\//g, "/wiki/techniques/");
	output = output.replace(/\/wiki\/dragon-ball\/games\//g, "/wiki/jeux/");
	output = output.replace(/\/wiki\/dragon-ball\/character\//g, "/wiki/personnages/");
	output = output.replace(/\/wiki\/dragon-ball\/planet\//g, "/wiki/cosmologie/");
	return output;
}

async function databaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(".env.remote-db")
		.text()
		.catch(() => "");
	const line = env.split("\n").findLast((entry) => entry.startsWith("REMOTE_DATABASE_URL="));
	const value = line
		?.slice("REMOTE_DATABASE_URL=".length)
		.trim()
		.replace(/^['"]|['"]$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

const sql = postgres(await databaseUrl(), { max: 1 });
try {
	for (const table of tables) {
		const rows = await sql.unsafe(`select * from bot.${table} where visible=true`);
		for (const row of rows as Array<Record<string, unknown>>) {
			const before = { ...row };
			const after = { ...row };
			let changed = false;
			for (const field of ["article", "description"] as const) {
				if (typeof row[field] !== "string") continue;
				const rewritten = rewrite(row[field]);
				if (rewritten !== row[field]) {
					after[field] = rewritten;
					changed = true;
				}
			}
			if (!changed) continue;
			console.log(
				JSON.stringify({
					mode: apply ? "APPLIQUER" : "SIMULATION",
					table,
					id: row.id,
					name: row.name,
				})
			);
			if (!apply) continue;
			await sql.begin(async (tx) => {
				const sets: string[] = [];
				const values: string[] = [String(row.id)];
				for (const field of ["article", "description"] as const) {
					if (after[field] !== row[field]) {
						sets.push(`${field}=$${values.length + 1}`);
						values.push(String(after[field] ?? ""));
					}
				}
				await tx.unsafe(
					`update bot.${table} set ${sets.join(", ")} where id=$1 and visible=true`,
					values
				);
				await tx.unsafe(
					'insert into public.wiki_revisions (id,"tableName","rowId",action,label,before,after,"editorId","editorName") values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',
					[
						`corrige-liens-wiki-${table}-${row.id}-${crypto.randomUUID()}`,
						table,
						String(row.id),
						"update",
						`${String(row.name ?? row.title ?? row.id)} — réécriture des liens wiki obsolètes`,
						JSON.stringify(before),
						JSON.stringify(after),
						"agent-shenron",
						"Shenron — correction navigation wiki",
					]
				);
			});
		}
	}
} finally {
	await sql.end();
}

#!/usr/bin/env bun
/**
 * Checks every hard-coded character slug against `bot.db_characters`.
 *
 *   bun apps/shenron/site/scripts/check-wiki-slugs.ts
 *
 * The id → slug table in `src/lib/wiki-slugs.ts` is written by hand. On
 * 2026-09-12 it had drifted from the database: 26 canonical URLs served another
 * character (`/wiki/personnages/broly` showed Dyspo) and 19 pointed at ids that
 * no longer exist. A slug is reported when its id is missing or hidden, or when
 * the character name shares no word with the slug. Exit code 1 on any problem.
 */
import postgres from "postgres";
import path from "node:path";
import {
	CHARACTER_CANONICAL_SLUGS,
	CHARACTER_SLUG_ALIASES,
	TRANSFORMATION_CANONICAL_SLUGS,
	TRANSFORMATION_SLUG_ALIASES,
} from "../src/lib/wiki-slugs";
import { slugify } from "../src/lib/slug";

async function databaseUrl(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	for (const name of [".env.local", ".env.production", ".env"]) {
		const file = Bun.file(path.join(import.meta.dir, "..", name));
		if (!(await file.exists())) continue;
		const match = (await file.text()).match(/^DATABASE_URL=["']?([^"'\n]+)/m);
		if (match?.[1]) return match[1];
	}
	throw new Error("DATABASE_URL introuvable");
}

const sql = postgres(await databaseUrl(), { max: 1 });
const ids = Object.keys(CHARACTER_CANONICAL_SLUGS).map(Number);
const rows = await sql<{ id: number; name: string; visible: boolean }[]>`
	select id, name, visible from bot.db_characters where id in ${sql(ids)}`;

const transfoIds = Object.keys(TRANSFORMATION_CANONICAL_SLUGS).map(Number);
const transfoRows = await sql<{ id: number; name: string; visible: boolean }[]>`
	select id, name, visible from bot.db_transformations where id in ${sql(transfoIds)}`;
await sql.end();

const byId = new Map(rows.map((r) => [Number(r.id), r]));
const transfoById = new Map(transfoRows.map((r) => [Number(r.id), r]));
const compact = (s: string) => slugify(s, 80).replaceAll("-", "");
/** Slugs that deliberately use the international name instead of the French one. */
const INTERNATIONAL_NAMES: Record<number, string> = { 9: "Celula", 17: "Master Roshi", 18: "Bardock" };
const problems: string[] = [];

for (const [idStr, slug] of Object.entries(CHARACTER_CANONICAL_SLUGS)) {
	const id = Number(idStr);
	const row = byId.get(id);
	if (!row) problems.push(`${idStr} → ${slug} : id absent de la base`);
	else if (!row.visible) problems.push(`${idStr} → ${slug} : fiche masquée (${row.name})`);
	else if (INTERNATIONAL_NAMES[id] !== undefined) {
		if (INTERNATIONAL_NAMES[id] !== row.name) problems.push(`${idStr} → ${slug} : attendu « ${INTERNATIONAL_NAMES[id]} », trouvé « ${row.name} »`);
	} else {
		const a = compact(slug);
		const b = compact(row.name);
		const words = slugify(row.name, 80).split("-");
		const matches = b.includes(a) || a.includes(b) || words.some((w) => w.length > 2 && a.includes(w));
		if (!matches) problems.push(`${idStr} → ${slug} : nom en base « ${row.name} »`);
	}
}
const canonical = new Set(Object.values(CHARACTER_CANONICAL_SLUGS));
for (const [alias, target] of Object.entries(CHARACTER_SLUG_ALIASES)) {
	if (!canonical.has(target)) problems.push(`alias ${alias} → ${target} : cible absente de la table`);
}

for (const [idStr, slug] of Object.entries(TRANSFORMATION_CANONICAL_SLUGS)) {
	const id = Number(idStr);
	const row = transfoById.get(id);
	if (!row) problems.push(`transfo ${idStr} → ${slug} : id absent de la base`);
	else if (!row.visible) problems.push(`transfo ${idStr} → ${slug} : fiche masquée (${row.name})`);
}
const transfoCanonical = new Set(Object.values(TRANSFORMATION_CANONICAL_SLUGS));
for (const [alias, target] of Object.entries(TRANSFORMATION_SLUG_ALIASES)) {
	if (!transfoCanonical.has(target)) problems.push(`alias transfo ${alias} → ${target} : cible absente de la table`);
}

if (problems.length === 0) {
	console.log(`✓ ${ids.length} slugs personnages conformes à bot.db_characters`);
	console.log(`✓ ${transfoIds.length} slugs transformations conformes à bot.db_transformations`);
} else {
	console.log(problems.join("\n"));
	process.exit(1);
}

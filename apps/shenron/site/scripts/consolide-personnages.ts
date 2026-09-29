#!/usr/bin/env bun
/** Conservative character consolidation. Simulation is the default. */
import { join } from "node:path";
import postgres from "postgres";
import {
	CHARACTER_MERGES,
	type CharacterIdentity,
	validateCharacterMerge,
} from "../src/lib/character-consolidation";

const APPLY = process.argv.includes("--appliquer");
const revisionId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

async function databaseUrl(): Promise<string> {
	if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim();
	const env = await Bun.file(join(import.meta.dir, "..", ".env")).text().catch(() => "");
	const value = env.split("\n").findLast((line) => line.startsWith("DATABASE_URL="))
		?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
	if (!value) throw new Error("DATABASE_URL introuvable");
	return value;
}

export async function consolidateCharacters(
	sql: ReturnType<typeof postgres>,
	apply = false,
	tables = { characters: "bot.db_characters", variants: "bot.db_character_variants", revisions: "public.wiki_revisions" }
): Promise<{ ready: number; changed: number; rejected: string[] }> {
	const characters = sql.unsafe(tables.characters);
	const variantsTable = sql.unsafe(tables.variants);
	const revisions = sql.unsafe(tables.revisions);
	const ids = [...new Set(CHARACTER_MERGES.flatMap((m) => [m.winnerId, m.duplicateId]))];
	const rows = await sql<{ id: string; name: string; name_ja: string | null; visible: boolean }[]>`
		select id, name, name_ja, visible from ${characters} where id in ${sql(ids)}`;
	const byId = new Map<number, CharacterIdentity>(rows.map((row) => [Number(row.id), {
		id: Number(row.id), name: row.name, nameJa: row.name_ja, visible: row.visible,
	}]));
	const rejected: string[] = [];
	const ready = CHARACTER_MERGES.filter((merge) => {
		const reason = validateCharacterMerge(merge, byId.get(merge.winnerId), byId.get(merge.duplicateId));
		if (reason) rejected.push(`${merge.duplicateId}->${merge.winnerId}: ${reason}`);
		return !reason;
	});
	if (!apply) return { ready: ready.length, changed: 0, rejected };

	let changed = 0;
	for (const merge of ready) {
		await sql.begin(async (tx) => {
			const locked = await tx<{ id: string; name: string; name_ja: string | null; visible: boolean }[]>`
				select id, name, name_ja, visible from ${characters}
				where id in ${tx([merge.winnerId, merge.duplicateId])} for update`;
			const live = new Map(locked.map((row) => [Number(row.id), { id: Number(row.id), name: row.name, nameJa: row.name_ja, visible: row.visible }]));
			const drift = validateCharacterMerge(merge, live.get(merge.winnerId), live.get(merge.duplicateId));
			if (drift) throw new Error(`${merge.duplicateId}->${merge.winnerId}: ${drift}`);

			const variants = await tx<{ id: string; slug: string; saga_id: string; visible: boolean }[]>`
				select id, slug, saga_id, visible from ${variantsTable} where character_id = ${merge.duplicateId} for update`;
			for (const variant of variants) {
				const collision = await tx`select id from ${variantsTable}
					where character_id = ${merge.winnerId} and saga_id = ${Number(variant.saga_id)}`;
				if (collision.length && !variant.visible) continue;
				const before = collision.length
					? { visible: variant.visible, character_id: merge.duplicateId }
					: { character_id: merge.duplicateId };
				const after = collision.length
					? { visible: false, character_id: merge.duplicateId }
					: { character_id: merge.winnerId };
				if (collision.length)
					await tx`update ${variantsTable} set visible = false where id = ${Number(variant.id)}`;
				else
					await tx`update ${variantsTable} set character_id = ${merge.winnerId} where id = ${Number(variant.id)}`;
				await tx`insert into ${revisions} ${tx({
					id: revisionId(), tableName: "db_character_variants", rowId: String(variant.id), action: "update",
					label: variant.slug, before: tx.json(before), after: tx.json(after), editorId: "agent",
					editorName: "Script consolide-personnages (SH-P1-009)",
				})}`;
			}
			if (live.get(merge.duplicateId)!.visible) {
				await tx`update ${characters} set visible = false where id = ${merge.duplicateId}`;
				await tx`insert into ${revisions} ${tx({
					id: revisionId(), tableName: "db_characters", rowId: String(merge.duplicateId), action: "visibility",
					label: merge.duplicateName, before: tx.json({ visible: true }), after: tx.json({ visible: false }),
					editorId: "agent", editorName: "Script consolide-personnages (SH-P1-009)",
				})}`;
			}
		});
		changed++;
	}
	// No exact canonical target exists for this form. Keeping it visible below a
	// hidden parent is worse than quarantining it until editorial arbitration.
	await sql.begin(async (tx) => {
		const orphan = await tx<{ id: string; slug: string; character_id: string; visible: boolean }[]>`
			select id, slug, character_id, visible from ${variantsTable} where id = 2330 for update`;
		const row = orphan[0];
		if (!row || row.slug !== "super-buu-buu" || Number(row.character_id) !== 89)
			throw new Error("orphan variant #2330 identity drifted");
		if (!row.visible) return;
		await tx`update ${variantsTable} set visible = false where id = 2330`;
		await tx`insert into ${revisions} ${tx({
			id: revisionId(), tableName: "db_character_variants", rowId: "2330", action: "visibility",
			label: "super-buu-buu", before: tx.json({ visible: true }), after: tx.json({ visible: false }),
			editorId: "agent", editorName: "Script consolide-personnages (SH-P1-009 quarantine)",
		})}`;
	});
	return { ready: ready.length, changed, rejected };
}

if (import.meta.main) {
	const sql = postgres(await databaseUrl(), { max: 2, prepare: false });
	try {
		const result = await consolidateCharacters(sql, APPLY);
		console.log(JSON.stringify({ status: result.rejected.length ? "INCOMPLET" : "FAIT", mode: APPLY ? "apply" : "simulation", ...result }, null, 2));
	} finally { await sql.end(); }
}

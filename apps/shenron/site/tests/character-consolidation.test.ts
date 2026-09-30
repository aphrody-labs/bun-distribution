import { describe, expect, test } from "bun:test";
import { CHARACTER_MERGES, validateCharacterMerge } from "../src/lib/character-consolidation";
import postgres from "postgres";
import { consolidateCharacters } from "../scripts/consolide-personnages";

describe("character consolidation", () => {
	test("contains no repeated source or target", () => {
		expect(new Set(CHARACTER_MERGES.map((m) => m.duplicateId)).size).toBe(CHARACTER_MERGES.length);
		expect(new Set(CHARACTER_MERGES.map((m) => m.winnerId)).size).toBe(CHARACTER_MERGES.length);
	});
	test("accepts an exact reviewed identity", () => {
		const m = CHARACTER_MERGES[0]!;
		expect(validateCharacterMerge(m,
			{ id: m.winnerId, name: m.winnerName, nameJa: m.nameJa, visible: true },
			{ id: m.duplicateId, name: m.duplicateName, nameJa: m.nameJa, visible: true }
		)).toBeNull();
	});
	test("rejects drift and distinct Japanese identities", () => {
		const m = CHARACTER_MERGES[0]!;
		expect(validateCharacterMerge(m,
			{ id: m.winnerId, name: m.winnerName, nameJa: m.nameJa, visible: true },
			{ id: m.duplicateId, name: m.duplicateName, nameJa: "別人", visible: true }
		)).toBe("Japanese identities differ");
	});
});

const dbUrl = process.env.DATABASE_URL?.trim();

test.skipIf(!dbUrl)("executes atomically against disposable PostgreSQL tables", async () => {
	const url = dbUrl!;
	const sql = postgres(url, { max: 1, prepare: false });
	try {
		await sql`create temporary table sh_chars (id bigint primary key, name text not null, name_ja text, visible boolean not null)`;
		await sql`create temporary table sh_variants (id bigint primary key, character_id bigint not null, saga_id bigint not null, slug text not null, visible boolean not null, unique(character_id,saga_id))`;
		await sql`create temporary table sh_revisions (id text primary key, "tableName" text, "rowId" text, action text, label text, before jsonb, after jsonb, "editorId" text, "editorName" text)`;
		for (const merge of CHARACTER_MERGES) {
			await sql`insert into sh_chars (id,name,name_ja,visible) values
				(${merge.winnerId},${merge.winnerName},${merge.nameJa},true),
				(${merge.duplicateId},${merge.duplicateName},${merge.nameJa},true)`;
		}
		await sql`insert into sh_variants values (9001,${CHARACTER_MERGES[0]!.duplicateId},901,${"moved"},true)`;
		await sql`insert into sh_variants values (2330,89,902,${"super-buu-buu"},true)`;
		const result = await consolidateCharacters(sql, true, {
			characters: "pg_temp.sh_chars", variants: "pg_temp.sh_variants", revisions: "pg_temp.sh_revisions",
		});
		expect(result.rejected).toEqual([]);
		const [moved] = await sql<{ character_id: string }[]>`select character_id from sh_variants where id=9001`;
		const [quarantined] = await sql<{ visible: boolean }[]>`select visible from sh_variants where id=2330`;
		const [audit] = await sql<{ n: number }[]>`select count(*)::int n from sh_revisions`;
		expect(Number(moved!.character_id)).toBe(CHARACTER_MERGES[0]!.winnerId);
		expect(quarantined!.visible).toBe(false);
		expect(audit!.n).toBe(CHARACTER_MERGES.length + 2);
	} finally { await sql.end(); }
}, 20_000);

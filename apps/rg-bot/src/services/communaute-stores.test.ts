import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";

test("owned characters compose RG inventory with Neon catalog without a cross-store SQL join", async () => {
	const child = Bun.spawn({
		cmd: [
			process.execPath,
			"-e",
			`
		import { mock } from "bun:test";
		const queries=[];
		mock.module(${JSON.stringify(pathToFileURL(`${import.meta.dir}/../lib/db.ts`).href)},()=>({
			sql: async (parts,...values)=>{ queries.push(["rg",parts.join("?"),values]); return [{objet_id:"a",obtenu_le:"2026-10-10"},{objet_id:"missing",obtenu_le:"2026-10-09"},{objet_id:"a",obtenu_le:"2026-10-08"}]; },
			inagleSql: async (parts,...values)=>{ queries.push(["inagle",parts.join("?"),values]); return [{id:"a",name_fr:"Axel",internal_code:"c001",rarity:"1",element:"fire",position:"FW",slug:"axel"}]; }
		}));
		mock.module(${JSON.stringify(pathToFileURL(`${import.meta.dir}/../lib/cache.ts`).href)},()=>({cached:async(_key,_ttl,read)=>read(),invalidate:async()=>{}}));
		const { personnagesPossedes } = await import(${JSON.stringify(pathToFileURL(`${import.meta.dir}/communaute.ts`).href)});
		queries.length = 0;
		const rows = await personnagesPossedes("guild","member");
		console.log(JSON.stringify({rows,queries}));
	`,
		],
		cwd: import.meta.dir,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	const result = JSON.parse(stdout);
	expect(
		result.rows.map((row: { id: string; obtenuLe: string }) => [row.id, row.obtenuLe]),
	).toEqual([
		["a", "2026-10-10"],
		["a", "2026-10-08"],
	]);
	expect(result.rows[0].nom).toBe("Axel");
	expect(result.queries.map((row: [string]) => row[0])).toEqual(["rg", "inagle"]);
	expect(result.queries[0][1]).toContain("FROM bot_inventaire");
	expect(result.queries[0][1]).not.toContain("inagle_");
	expect(result.queries[1][1]).toContain("FROM inagle_characters");
	expect(result.queries[1][1]).not.toContain("bot_inventaire");
	expect(result.queries[1][2]).toEqual([["a", "missing", "a"]]);
	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
});

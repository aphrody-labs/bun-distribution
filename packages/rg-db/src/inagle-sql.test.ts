import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";

test("gameplay queries reject absent Neon configuration while RG remains configured", async () => {
	const child = Bun.spawn({
		cmd: [
			process.execPath,
			"-e",
			`
		import { createInagleSql, destroyInagleSql } from ${JSON.stringify(pathToFileURL(`${import.meta.dir}/inagle-sql.ts`).href)};
		process.env.RG_DATABASE_URL = "postgresql://owner@127.0.0.1:1/rg";
		delete process.env.INAGLE_DATABASE_URL;
		delete process.env.NIE_PG_URL;
		const db = createInagleSql();
		const query = db.selectFrom("inagle_characters").select("id");
		console.log(query.compile().sql);
		try { await query.execute(); throw new Error("Unexpected fallback to RG"); }
		catch (error) { console.log(error.message); }
		finally { await destroyInagleSql(); }
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
	expect(stdout.trim()).toBe(
		'select "id" from "inagle_characters"\nINAGLE_DATABASE_URL/NIE_PG_URL absent ou corrompu : une chaîne Postgres valide est requise.',
	);
	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
});

test("the facade sends RG and gameplay tables through distinct pools and recreates the gameplay pool after shutdown", async () => {
	const child = Bun.spawn({
		cmd: [
			process.execPath,
			"-e",
			`
		import { mock } from "bun:test";
		const requests = [];
		mock.module("pg", () => ({ Client: class {}, Pool: class {
			constructor(config) { this.config = config; }
			on() {}
			async end() {}
			async connect() { const config = this.config; return {
				query: async (text, parameters) => { requests.push([config.connectionString, typeof text === "string" ? text : text.text, parameters]); return { rows: [{id:"1"}], rowCount:1 }; },
				release() {}, on() {}, off() {}
			}; }
		} }));
		process.env.DATABASE_URL = "postgresql://legacy@rg.invalid/legacy";
		process.env.RG_DATABASE_URL = "postgresql://rg@supabase.invalid/rg";
		process.env.INAGLE_DATABASE_URL = "postgresql://game@neon.invalid/inagle";
		process.env.NIE_PG_URL = "postgresql://old@legacy.invalid/old";
		const { createPostgresClient } = await import(${JSON.stringify(pathToFileURL(`${import.meta.dir}/postgres-client.ts`).href)});
		const { destroyInagleSql } = await import(${JSON.stringify(pathToFileURL(`${import.meta.dir}/inagle-sql.ts`).href)});
		const { destroyAchilleaSql } = await import(${JSON.stringify(pathToFileURL(`${import.meta.dir}/achillea-sql.ts`).href)});
		const client = createPostgresClient();
		for (const table of ["profiles", "inagle_characters"]) { const result = await client.from(table).select("id"); if (result.error) throw result.error; }
		const custom = createPostgresClient("postgresql://custom@override.invalid/rg");
		for (const table of ["profiles", "inagle_characters"]) { const result = await custom.from(table).select("id"); if (result.error) throw result.error; }
		await destroyInagleSql();
		const result = await client.from("inagle_characters").select("id"); if (result.error) throw result.error;
		await destroyInagleSql(); await destroyAchilleaSql();
		console.log(JSON.stringify(requests.map(([url,sql])=>[new URL(url).hostname,sql])));
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
	expect(stdout.trim()).toBe(
		JSON.stringify([
			["supabase.invalid", 'SELECT id FROM "profiles"'],
			["neon.invalid", 'SELECT id FROM "inagle_characters"'],
			["override.invalid", 'SELECT id FROM "profiles"'],
			["neon.invalid", 'SELECT id FROM "inagle_characters"'],
			["neon.invalid", 'SELECT id FROM "inagle_characters"'],
		]),
	);
	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
});

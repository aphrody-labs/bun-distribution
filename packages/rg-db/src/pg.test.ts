import { expect, test } from "bun:test";
import { pathToFileURL } from "node:url";

test("store configuration keeps precedence explicit and rejects missing databases without exposing URLs", async () => {
	const child = Bun.spawn({
		cmd: [
			process.execPath,
			"-e",
			`
			import {getDatabaseURL,getInagleDatabaseURL} from ${JSON.stringify(pathToFileURL(`${import.meta.dir}/pg.ts`).href)};
			process.env.RG_DATABASE_URL="postgresql://fixture@supabase.invalid/rg";
			process.env.DATABASE_URL="postgresql://fixture@legacy.invalid/legacy";
			process.env.INAGLE_DATABASE_URL="postgresql://fixture@neon.invalid/inagle";
			process.env.NIE_PG_URL="postgresql://fixture@alias.invalid/old";
			console.log(new URL(getDatabaseURL()).hostname,new URL(getInagleDatabaseURL()).hostname);
			for (const value of ["", "postgresql://fixture@neon.invalid", "https://fixture.invalid/inagle"]) {
				process.env.INAGLE_DATABASE_URL=value;
				try { getInagleDatabaseURL(); throw new Error("Unexpected fallback"); }
				catch(error) { console.log(error.message.startsWith("INAGLE_DATABASE_URL/NIE_PG_URL"),!error.message.includes("fixture")); }
			}
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
	expect(stdout.trim()).toBe("supabase.invalid neon.invalid\ntrue true\ntrue true\ntrue true");
	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
});

test("Postgres dialect defers configuration until a real query and retains the required URL guard", async () => {
	const child = Bun.spawn({
		cmd: [
			process.execPath,
			"-e",
			`
			import { Kysely } from "kysely";
			import { createPgDialect } from ${JSON.stringify(pathToFileURL(`${import.meta.dir}/pg.ts`).href)};
			delete process.env.DATABASE_URL;
			delete process.env.RG_DATABASE_URL;
			delete process.env.ROSE_GRIFFON_DATABASE_URL;
			const db = new Kysely({ dialect: createPgDialect() });
			const query = db.selectFrom("profiles").select("id");
			console.log(query.compile().sql);
			try {
				await query.execute();
				throw new Error("query unexpectedly succeeded without configuration");
			} catch (error) {
				console.log(error.message);
			} finally {
				await db.destroy();
			}
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
		'select "id" from "profiles"\nRG_DATABASE_URL/DATABASE_URL absent ou corrompu : une chaîne Postgres valide est requise.',
	);
	expect(stderr).toBe("");
	expect(exitCode).toBe(0);
});

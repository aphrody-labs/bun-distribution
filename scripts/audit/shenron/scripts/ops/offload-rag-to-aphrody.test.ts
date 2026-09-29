import { afterAll, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "shenron-rag-offload-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function preview(url: string, args: string[] = []): Promise<{ code: number; stdout: string; stderr: string }> {
	const path = join(root, `${crypto.randomUUID()}.db`);
	const db = new Database(path);
	try {
		db.exec("CREATE VIRTUAL TABLE rag_chunks USING fts5(kind, title, url, content, lang, source_id, entity)");
		db.query("INSERT INTO rag_chunks(kind,title,url,content,lang,source_id,entity) VALUES (?,?,?,?,?,?,?)")
			.run("character", "Son Goku", url, "Source de référence", "fr", "manga", "son-goku");
	} finally {
		db.close();
	}
	const process = Bun.spawn(["bun", join(import.meta.dir, "offload-rag-to-aphrody.ts"), "--db", path, ...args], {
		stdout: "pipe", stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
	return { code, stdout, stderr };
}

it("previews a relative citation without writing to Aphrody", async () => {
	const result = await preview("/wiki/son-goku");
	expect(result.code).toBe(0);
	expect(JSON.parse(result.stdout)).toMatchObject({ status: "planned", total: 1, validated: 1, writes: 0 });
});

it("exports a checksumed PostgreSQL CSV with stable id and source metadata", async () => {
	const csvPath = join(root, "fixture.csv");
	const result = await preview("/wiki/son-goku", ["--pg-csv", csvPath]);
	expect(result.code).toBe(0);
	expect(JSON.parse(result.stdout)).toMatchObject({ status: "exported", exported: 1, target: 1 });
	const csv = await Bun.file(csvPath).text();
	expect(csv).toContain('"shenron:1"');
	expect(csv).toContain('"https://dragonballfr.com/wiki/son-goku"');
	expect(csv).toContain('""originSourceId"":""manga""');
});

it("blocks a missing citation URL before the import", async () => {
	const result = await preview("");
	expect(result.code).not.toBe(0);
	expect(result.stderr).toContain("has no source URL");
});

// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

import { describe, expect, test } from "bun:test";
import { chunkMarkdown, ingestDocs, openStore, readJsonl } from "./ingest-rag.ts";

const long = (title: string) =>
	[`# ${title}`, "", `${title} est un Saiyan. `.repeat(60), "", "## Techniques", "", "Kamehameha. ".repeat(80)].join("\n");

describe("chunkMarkdown", () => {
	test("keeps short passages whole", () => {
		expect(chunkMarkdown("Court.", "T")).toEqual([{ heading: "T", text: "Court.", startLine: 1, endLine: 1 }]);
	});

	test("splits long Markdown on headings with line spans", () => {
		const chunks = chunkMarkdown(long("Son Goku"), "Son Goku");
		expect(chunks.length).toBeGreaterThanOrEqual(2);
		expect(chunks.map((c) => c.heading)).toContain("Techniques");
		for (const c of chunks) expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
	});
});

describe("ingestDocs", () => {
	test("writes the aphrody-rag schema, feeds FTS and is idempotent", () => {
		const db = openStore(":memory:");
		const jsonl = [
			{ id: "t:1", name: "Son Goku", url: "https://example.org/goku", markdown: long("Son Goku"), lang: "fr", kind: "wiki" },
			{ id: "t:2", name: "Vide", url: "https://example.org/empty", markdown: "x", lang: "fr" },
		]
			.map((d) => JSON.stringify(d))
			.join("\n");
		const first = ingestDocs(db, readJsonl(jsonl));
		expect(first.docsIngested).toBe(1);
		expect(first.skipped).toBe(1);
		expect(first.chunksCreated).toBeGreaterThanOrEqual(2);

		const hit = db
			.query<{ path: string }, [string]>(
				"SELECT d.path FROM chunks_fts f JOIN chunks c ON c.id = f.rowid JOIN docs d ON d.id = c.doc_id WHERE chunks_fts MATCH ? LIMIT 1",
			)
			.get("kamehameha");
		expect(hit?.path).toBe("https://example.org/goku");

		const second = ingestDocs(db, readJsonl(jsonl));
		expect(second.unchanged).toBe(1);
		expect(second.docsIngested).toBe(0);
		const chunks = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM chunks").get();
		expect(chunks?.n).toBe(first.chunksCreated);
		db.close();
	});
});

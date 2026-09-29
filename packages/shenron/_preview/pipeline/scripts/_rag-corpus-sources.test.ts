// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { corpusSourceId, renderCorpusDocs } from "./_rag-corpus-sources";

describe("shared documentary RAG corpus rendering", () => {
	it("keeps licensed crawl passages and rejects Fandom and duplicate manga shards", () => {
		const rendered = renderCorpusDocs([
			{ id: "kz-42", name: "Kanzenshuu guide", url: "https://www.kanzenshuu.com/guide", markdown: "# Guide\nLe guide explique l'histoire de Dragon Ball." },
			{ id: "fd-en-42", name: "Fandom", url: "https://dragonball.fandom.com/wiki/Goku", markdown: "This must never enter the corpus." },
			{ id: "manga-42", name: "Duplicated manga", url: "https://example.org/manga", markdown: "A passage already rendered from PostgreSQL." },
		]);
		expect(rendered.refusedFandom).toBe(1);
		expect(rendered.passages).toHaveLength(1);
		expect(rendered.passages[0]?.sourceId).toBe("kz");
		expect(rendered.passages[0]?.kind).toBe("source");
		expect(corpusSourceId("wiki-son-goku")).toBe("wikipedia");
	});

	it("preserves Japanese and author metadata", () => {
		const japanese = renderCorpusDocs([{ id: "xv2-ja-1", name: "技", url: "https://example.org/ja/skill", markdown: "界王拳は悟空の技であり、戦闘で使用されます。" }]);
		expect(japanese.passages[0]?.lang).toBe("ja");
		const author = renderCorpusDocs([{ id: "aphrody-1", name: "Toriyama", url: "https://example.org/author", markdown: "Une déclaration documentée de l'auteur.", lang: "fr" }], true);
		expect(author.passages[0]?.sourceId).toBe("aphrody");
		expect(author.passages[0]?.kind).toBe("author");
	});
});

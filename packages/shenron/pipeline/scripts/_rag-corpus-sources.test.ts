// SPDX-License-Identifier: Apache-2.0
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadLiveRagEnv, requireLiveRag, type LiveRag } from "../src/testing/live-rag";
import { prepareSource } from "./_rag-aphrody-sync";

loadLiveRagEnv();
const { CORPUS_DIR, corpusSourceId, isFandom, loadCorpusDocs, renderCorpusDocs } =
  await import("./_rag-corpus-sources");
let live: LiveRag;
beforeAll(async () => {
  live = await requireLiveRag();
}, 120_000);

describe("documentary RAG rendered from the actual private Shenron exports", () => {
  for (const file of ["corpus.json", "corpus-xv2.json", "corpus-aphrody.json"]) {
    test(`${file}: real exported passages resolve to the preloaded PostgreSQL corpus`, async () => {
      const docs = loadCorpusDocs(join(CORPUS_DIR, file));
      expect(docs?.length).toBeGreaterThan(0);
      if (!docs) throw new Error("Real Shenron corpus export is missing");
      const { passages, refusedFandom } = renderCorpusDocs(docs, file.includes("aphrody"));
      expect(passages.length).toBeGreaterThan(0);
      expect(refusedFandom).toBe(docs.filter(isFandom).length);
      expect(passages.every((passage) => !/fandom\.com/i.test(passage.url))).toBe(true);
      const passage = passages[0]!;
      const sameSource = passages.filter((item) => item.sourceId === passage.sourceId);
      const expected = prepareSource(passage.sourceId, sameSource).documents[0]!;
      const stored = await live.client.ragDocument(expected.sourceId);
      expect(stored?.title).toBe(expected.title);
      expect(stored?.url).toBe(expected.url);
      expect(stored?.kind).toBe(file.includes("aphrody") ? "author" : "source");
      const retrieval = await live.client.ragSearchWithMode(passage.title, 3, {
        sourceId: passage.sourceId,
        lang: passage.lang,
      });
      expect(retrieval.mode).toBe("hybrid");
      expect(retrieval.results.length).toBeGreaterThan(0);
      expect(
        retrieval.results.every(
          (hit) => hit.originSourceId === passage.sourceId && hit.lang === passage.lang,
        ),
      ).toBe(true);
    });
  }

  test("preserves Japanese metadata from a real exported documentary passage", async () => {
    const docs = loadCorpusDocs(join(CORPUS_DIR, "corpus.json"))!;
    const { passages } = renderCorpusDocs(docs);
    const passage = passages.find((item) => item.lang === "ja");
    expect(passage).toBeDefined();
    if (!passage) throw new Error("Real Japanese documentary passage is missing");
    const search = await live.client.ragSearchWithMode(passage.title, 3, {
      sourceId: passage.sourceId,
      lang: "ja",
    });
    expect(search.results.length).toBeGreaterThan(0);
    expect(search.results.every((hit) => hit.lang === "ja")).toBe(true);
    expect(corpusSourceId("wiki-son-goku")).toBe("wikipedia");
  });
});

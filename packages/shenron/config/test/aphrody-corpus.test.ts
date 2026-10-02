// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { DOCUMENTS, PARSEUR_NOMS, REFUSÉ } from "../src/aphrody-corpus";

describe("@shenron/config/aphrody-corpus", () => {
  test("motifs are unique and none is refused", () => {
    expect(new Set(DOCUMENTS.map((d) => d.motif)).size).toBe(DOCUMENTS.length);
    for (const doc of DOCUMENTS) expect(REFUSÉ.test(doc.motif)).toBe(false);
  });
  test("every document names known parsers and a source", () => {
    for (const doc of DOCUMENTS) {
      expect(doc.source.length).toBeGreaterThan(0);
      expect(doc.parseurs.length).toBeGreaterThan(0);
      for (const p of doc.parseurs) expect(PARSEUR_NOMS).toContain(p);
    }
  });
  test("fan wiki mirrors are refused", () => {
    for (const nom of ["dragonball_fandom_goku", "wikipedia_dbz", "reddit_thread"]) {
      expect(REFUSÉ.test(nom)).toBe(true);
    }
  });
});

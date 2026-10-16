// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { CollectionReader, DatabookReader, MangaReader } from "@aphrody/m3-reader/source";
import { useFocusTrap } from "@aphrody/m3-reader/use-focus-trap";
import * as shenron from "../src/reader";
import { useFocusTrap as shenronFocusTrap } from "../src/reader/use-focus-trap";
const read = (name: string) => readFile(new URL("../src/" + name, import.meta.url), "utf8");
describe("one reader implementation across Aphrody and Shenron", () => {
  test("all three readers and modal lifecycle share the canonical implementation", () => {
    expect(shenron.CollectionReader).toBe(CollectionReader);
    expect(shenron.DatabookReader).toBe(DatabookReader);
    expect(shenron.MangaReader).toBe(MangaReader);
    expect(shenronFocusTrap).toBe(useFocusTrap);
  });
  test("the Shenron style exports delegate to M3 including the Dragon Ball skin", async () => {
    expect(await read("reader-styles.css")).toContain('@import "@aphrody/m3-reader/styles.css"');
    expect(await read("reader-dragon-ball.css")).toContain(
      '@import "@aphrody/m3-reader/dragon-ball.css"',
    );
  });
});

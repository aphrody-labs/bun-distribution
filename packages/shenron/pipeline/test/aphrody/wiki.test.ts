// SPDX-License-Identifier: Apache-2.0
import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AphrodyWikiSearchService, resolveWikiApiUrl } from "../../src/aphrody/wiki";

const directory = mkdtempSync(join(tmpdir(), "aphrody-wiki-consumer-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
function fixture(name: string, source: string) {
  const bin = join(directory, name);
  writeFileSync(bin, `#!${process.execPath}\n${source}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

describe("MediaWiki endpoint resolution", () => {
  it("preserves localized installations and Wikimedia API paths", () => {
    expect(resolveWikiApiUrl("https://dragonball.fandom.com/fr/wiki/Goku")).toBe(
      "https://dragonball.fandom.com/fr/api.php",
    );
    expect(resolveWikiApiUrl("https://en.wikipedia.org/wiki/Goku")).toBe(
      "https://en.wikipedia.org/w/api.php",
    );
    expect(resolveWikiApiUrl("https://wiki.example/custom/api.php?action=query")).toBe(
      "https://wiki.example/custom/api.php",
    );
    expect(resolveWikiApiUrl("https://wiki.example/custom/index.php?title=Goku")).toBe(
      "https://wiki.example/custom/api.php",
    );
  });
  it("rejects credentials and unsupported URLs instead of guessing a page URL", () => {
    expect(() => resolveWikiApiUrl("file:///tmp/wiki")).toThrow("HTTP(S)");
    expect(() => resolveWikiApiUrl("https://user:password@wiki.example/wiki/Goku")).toThrow(
      "credentials",
    );
    expect(() => resolveWikiApiUrl("https://wiki.example/other/Goku")).toThrow("explicit api.php");
  });
});

describe.skipIf(process.platform === "win32")("MediaWiki Rust CLI contract", () => {
  it("retains API canonical URLs and preserves a Unicode query as one argument", async () => {
    const bin = fixture(
      "wiki-search",
      `const args=process.argv.slice(2);
if(args[0]!=="web"||args[1]!=="wiki-search"||args[2]!=="https://wiki.example/api.php"||args[4]!=="--limit"||args[5]!=="3"||args[6]!=="--json") process.exit(2);
console.log(JSON.stringify([{titre:args[3],url:"https://wiki.example/index.php?title=Goku",taille:80}]));`,
    );
    const hits = await new AphrodyWikiSearchService({ bin }).search(
      "https://wiki.example/",
      "悟空 & canon",
      3,
    );
    expect(hits).toEqual([
      { titre: "悟空 & canon", url: "https://wiki.example/index.php?title=Goku", taille: 80 },
    ]);
  });
  it("propagates remote failures and invalid result shapes", async () => {
    const failure = fixture("wiki-failure", 'console.error("API unavailable");process.exit(4);');
    await expect(
      new AphrodyWikiSearchService({ bin: failure }).search("https://wiki.example/", "Goku"),
    ).rejects.toThrow("exited 4");
    const malformed = fixture("wiki-malformed", "console.log(JSON.stringify({results:[]}));");
    await expect(
      new AphrodyWikiSearchService({ bin: malformed }).search("https://wiki.example/", "Goku"),
    ).rejects.toThrow();
  });
  it("rejects invalid limits before starting the owner CLI", async () => {
    const service = new AphrodyWikiSearchService({ bin: "/does-not-exist" });
    await expect(service.search("https://wiki.example/", "Goku", 101)).rejects.toThrow(
      "between 0 and 100",
    );
    expect(await service.search("https://wiki.example/", "", 10)).toEqual([]);
  });
});

// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("FUT delegates acquisition once and persists captured domain results", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aphrody-fut-owner-"));
  const binary = join(dir, "aphrody-web");
  const log = join(dir, "calls.jsonl");
  await writeFile(
    binary,
    `#!/usr/bin/env bun
const args = process.argv.slice(2);
const logfile = Bun.file(${JSON.stringify(log)});
await Bun.write(logfile, (await logfile.exists() ? await logfile.text() : "") + JSON.stringify(args) + "\\n");
console.log(JSON.stringify({ pages: [{url:"https://www.futbin.com/27/player/42/fixture",depth:0,status:200,title:"Fixture",...(args.includes("https://www.futbin.com/missing-html") ? {} : {html:"<main>Captured fixture</main>"})}],errors:[],stats:{attempts:1,frontierDone:1,frontierPending:0,frontierFailed:0}}));
`,
    { mode: 0o700 },
  );
  const runner = join(dir, "runner.ts");
  const source = (relative: string) =>
    JSON.stringify(fileURLToPath(new URL(relative, import.meta.url)));
  await writeFile(
    runner,
    `
import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import * as nativeService from ${source("../../../web/agent-browser/src/service.ts")};
mock.module("@aphrody/agent-browser/service", () => nativeService);
const captured = [];
mock.module(${source("../src/scraper/universalScraper.ts")}, () => ({ UniversalFutScraper: class {
  async scrapePlayer(url, html) { captured.push(html); return {id:"42",name:"Fixture player"}; }
  close() {}
}}));
const { fetchFutPage } = await import(${source("../src/web.ts")});
const { MassiveFutCrawler } = await import(${source("../src/crawler/massiveCrawler.ts")});
const page = await fetchFutPage("https://www.futbin.com/27/player/42/fixture");
let missingHtmlRejected = false;
try { await fetchFutPage("https://www.futbin.com/missing-html"); } catch(error) {
  missingHtmlRejected = error instanceof Error && error.message.includes("omitted captured HTML");
}
const path = ${JSON.stringify(join(dir, "domain.sqlite"))};
const crawler = new MassiveFutCrawler({dbPath:path,maxPages:3});
crawler.addSeeds([page.url,page.url]);
const stats = await crawler.start();
await crawler.start();
crawler.close();
const db = new Database(path,{readonly:true});
const row = db.query("SELECT name FROM crawled_entities").get();
db.close();
let bounded = false;
try { new MassiveFutCrawler({maxPages:Infinity}); } catch(error) { bounded = error instanceof RangeError; }
console.log(JSON.stringify({stats,captured,row,bounded,missingHtmlRejected}));
`,
  );
  try {
    // Module doubles live only in this child; other FUT test files retain their real imports.
    const child = Bun.spawn([process.execPath, runner], {
      env: { ...process.env, APHRODY_WEB_BIN: binary },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    const result = JSON.parse(stdout) as {
      stats: { crawled: number; success: number };
      captured: string[];
      row: { name: string };
      bounded: boolean;
      missingHtmlRejected: boolean;
    };
    expect(result.stats.crawled).toBe(1);
    expect(result.stats.success).toBe(1);
    expect(result.captured).toEqual(["<main>Captured fixture</main>"]);
    expect(result.row).toEqual({ name: "Fixture player" });
    expect(result.bounded).toBe(true);
    expect(result.missingHtmlRejected).toBe(true);
    const calls = (await Bun.file(log).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(calls).toHaveLength(3);
    expect(
      calls.every(
        (args) => args[0] === "crawl" && args.includes("--max-pages") && args.includes("--render"),
      ),
    ).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

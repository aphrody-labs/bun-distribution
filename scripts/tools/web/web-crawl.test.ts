// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { parseCrawlArgs, summarizeCrawl } from "./web-crawl.ts";
import type { CrawlReport } from "../../../packages/web/agent-browser/src/service.ts";

describe("web-crawl CLI helpers", () => {
  test("parses seeds and options", () => {
    const parsed = parseCrawlArgs([
      "https://a.test/",
      "--max-pages",
      "3",
      "--allow-host",
      "a.test",
      "--no-robots",
      "--json",
    ]);
    expect(parsed.seeds).toEqual(["https://a.test/"]);
    expect(parsed.options).toMatchObject({
      maxPages: 3,
      allowedDomains: ["a.test"],
      obeyRobots: false,
    });
    expect(parsed.json).toBe(true);
  });

  test("rejects missing seeds, unknown flags and bad numbers", () => {
    expect(() => parseCrawlArgs([])).toThrow(/usage/);
    expect(() => parseCrawlArgs(["https://a.test/", "--bogus"])).toThrow(/unknown option/);
    expect(() => parseCrawlArgs(["https://a.test/", "--max-pages", "x"])).toThrow(/integer/);
  });

  test("summary lists pages, duplicates and errors", () => {
    const report = {
      schema: "aphrody-web.crawl/1",
      pages: [
        { url: "https://a.test/", status: 200, depth: 0, wordCount: 120, duplicate: false },
        { url: "https://a.test/x", status: 200, depth: 1, wordCount: 5, duplicate: true },
      ],
      errors: [{ url: "https://a.test/y", error: "HTTP 404" }],
      stats: { pages: 2, robotsBlocked: 1, elapsedMs: 42 },
    } as unknown as CrawlReport;
    const text = summarizeCrawl(report);
    expect(text).toContain("(duplicate)");
    expect(text).toContain("ERR  https://a.test/y: HTTP 404");
    expect(text).toContain("2 pages, 1 errors, robots blocked 1, 42 ms");
  });
});

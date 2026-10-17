// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { parseCrawlReport } from "./live-audit-report.ts";

test("native crawl report carries HTML, statuses, and request errors into the audit", () => {
  const report = parseCrawlReport(
    JSON.stringify({
      schema: "aphrody-web.crawl/1",
      pages: [
        {
          url: "https://example.test/",
          status: 200,
          html: "<a href='/next'>Next</a>",
          title: "Example",
        },
      ],
      errors: [{ url: "https://example.test/broken", error: "request failed" }],
      stats: { attempts: 2 },
    }),
  );
  expect(report.pages).toEqual([
    {
      url: "https://example.test/",
      status: 200,
      html: "<a href='/next'>Next</a>",
    },
  ]);
  expect(report.errors).toEqual([{ url: "https://example.test/broken", error: "request failed" }]);
  expect(
    parseCrawlReport(
      JSON.stringify({
        schema: "aphrody-web.crawl/1",
        pages: [{ url: "https://example.test/missing", status: 404 }],
        errors: [],
      }),
    ).pages,
  ).toEqual([{ url: "https://example.test/missing", status: 404, html: "" }]);
  expect(() =>
    parseCrawlReport(
      JSON.stringify({
        schema: "aphrody-web.crawl/1",
        pages: [{ url: "https://example.test/", status: 200 }],
        errors: [],
      }),
    ),
  ).toThrow("HTML");
  expect(() => parseCrawlReport(JSON.stringify({ schema: "legacy.crawl/1", pages: [], errors: [] }))).toThrow(
    "unsupported",
  );
});

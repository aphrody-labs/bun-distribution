// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  M3_SITEMAP_MAX_URLS,
  m3AbsoluteUrl,
  m3JsonLd,
  m3LlmsTxt,
  m3RobotsTxt,
  m3SitemapXml,
} from "../src/crawl";

const origin = "https://example.com";

describe("m3SitemapXml", () => {
  test("resolves, de-duplicates, sorts and escapes", () => {
    const xml = m3SitemapXml(
      [
        "/b",
        "/a?x=1&y=2",
        { path: "/b", lastmod: "2026-10-01", changefreq: "weekly", priority: 0.8 },
        "https://example.com/c#frag",
      ],
      origin,
    );
    expect(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ),
    ).toBe(true);
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      "https://example.com/a?x=1&amp;y=2",
      "https://example.com/b",
      "https://example.com/c",
    ]);
    expect(xml).toContain("<lastmod>2026-10-01</lastmod>");
    expect(xml).toContain("<priority>0.8</priority>");
    expect(m3SitemapXml(["/z", "/a"], origin)).toBe(m3SitemapXml(["/a", "/z"], origin));
  });

  test("rejects foreign origins, bad dates, bad priorities and oversized lists", () => {
    expect(() => m3SitemapXml(["https://other.com/x"], origin)).toThrow(RangeError);
    expect(() => m3SitemapXml([{ path: "/a", lastmod: "yesterday" }], origin)).toThrow(RangeError);
    expect(() => m3SitemapXml([{ path: "/a", priority: 2 }], origin)).toThrow(RangeError);
    expect(() =>
      m3SitemapXml(
        Array.from({ length: M3_SITEMAP_MAX_URLS + 1 }, (_, i) => `/p${i}`),
        origin,
      ),
    ).toThrow(RangeError);
    expect(() => m3AbsoluteUrl("/a", "ftp://x")).toThrow(TypeError);
  });

  test("an empty route list is still a valid urlset", () => {
    expect(m3SitemapXml([], origin)).toContain("<urlset");
  });
});

describe("m3RobotsTxt", () => {
  test("defaults allow everything and reference the sitemap", () => {
    expect(m3RobotsTxt({ origin })).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml\n",
    );
  });

  test("groups, crawl delay and custom sitemaps", () => {
    const txt = m3RobotsTxt({
      origin,
      rules: [
        { userAgent: "*", disallow: ["/private/"] },
        { userAgent: ["GPTBot", "ClaudeBot"], disallow: ["/"], crawlDelay: 10 },
      ],
      sitemaps: ["/sitemap.xml", "https://example.com/news.xml"],
    });
    expect(txt).toContain("User-agent: *\nDisallow: /private/\n");
    expect(txt).toContain(
      "User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\nCrawl-delay: 10",
    );
    expect(txt.trimEnd().endsWith("Sitemap: https://example.com/news.xml")).toBe(true);
    expect(m3RobotsTxt({ origin, sitemaps: [] })).not.toContain("Sitemap:");
  });

  test("rejects header injection", () => {
    expect(() =>
      m3RobotsTxt({ origin, rules: [{ userAgent: "*", disallow: ["/a\nAllow: /"] }] }),
    ).toThrow(TypeError);
    expect(() => m3RobotsTxt({ origin, rules: [{ userAgent: [] }] })).toThrow(TypeError);
  });
});

describe("m3LlmsTxt (llmstxt.org)", () => {
  test("H1, blockquote summary, details, sections and Optional last", () => {
    const txt = m3LlmsTxt({
      origin,
      name: "Example",
      summary: "One line summary.",
      details: ["First paragraph.", "Second paragraph."],
      sections: [
        { title: "Extras", links: [{ title: "Changelog", path: "/changelog" }], optional: true },
        {
          title: "Docs",
          links: [
            { title: "Guide [v2]", path: "/docs/guide", notes: "Start here" },
            { title: "API", path: "https://api.example.org/ref" },
          ],
        },
      ],
    });
    expect(txt).toBe(
      [
        "# Example",
        "> One line summary.",
        "First paragraph.",
        "Second paragraph.",
        "## Docs\n\n- [Guide \\[v2\\]](https://example.com/docs/guide): Start here\n- [API](https://api.example.org/ref)",
        "## Optional\n\n- [Changelog](https://example.com/changelog)",
      ].join("\n\n") + "\n",
    );
  });

  test("requires a name and forbids headings in details", () => {
    expect(() => m3LlmsTxt({ origin, name: " " })).toThrow(TypeError);
    expect(() => m3LlmsTxt({ origin, name: "X", details: "# not allowed" })).toThrow(TypeError);
    expect(m3LlmsTxt({ origin, name: "X" })).toBe("# X\n");
  });
});

describe("m3JsonLd", () => {
  test("escapes markup so the payload cannot close the script tag", () => {
    const json = m3JsonLd({ name: "</script><b>&", sep: "\u2028" });
    expect(json).not.toMatch(/[<>&\u2028]/);
    expect(JSON.parse(json)).toEqual({ name: "</script><b>&", sep: "\u2028" });
    expect(() => m3JsonLd(undefined)).toThrow(TypeError);
  });
});

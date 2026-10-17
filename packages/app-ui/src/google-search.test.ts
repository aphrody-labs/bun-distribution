// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { parseGoogleSearchResponse, safeSearchUrl, searchGoogle } from "./google-search";

const response = (payload: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(payload) }],
});
describe("native Google search", () => {
  test("rejects executable URLs and credentials while preserving HTTP links", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,test",
      "file:///test",
      "https://user:secret@example.com",
      "/relative",
    ]) {
      expect(safeSearchUrl(url)).toBeNull();
    }
    expect(safeSearchUrl("https://example.com/article")).toBe("https://example.com/article");
  });
  test("parses organic results and filters unsafe destinations", () => {
    expect(
      parseGoogleSearchResponse(
        response({
          query: "Aphrody",
          organic: [
            { title: "Aphrody", url: "https://aphrody.com", snippet: "Native tools" },
            { title: "Unsafe", url: "javascript:alert(1)", snippet: "" },
          ],
        }),
      ),
    ).toEqual({
      query: "Aphrody",
      correctedQuery: undefined,
      organic: [{ title: "Aphrody", url: "https://aphrody.com/", snippet: "Native tools" }],
    });
  });
  test("surfaces MCP errors and rejects malformed success payloads", () => {
    expect(() =>
      parseGoogleSearchResponse({
        isError: true,
        content: [{ type: "text", text: "Consent required" }],
      }),
    ).toThrow("Consent required");
    expect(() => parseGoogleSearchResponse(response({}))).toThrow("invalide");
    expect(() => parseGoogleSearchResponse({ content: [] })).toThrow("invalide");
  });
  test("calls the shared RPC with anonymous safe search and pagination", async () => {
    let actual: unknown;
    const result = await searchGoogle(
      { query: "  Aphrody  ", vertical: "news", hl: "fr", safe: "active", start: 10 },
      async (method, params) => {
        actual = { method, params };
        return { query: "Aphrody", organic: [] };
      },
    );
    expect(actual).toEqual({
      method: "aphrody/google/search",
      params: {
        query: "Aphrody",
        vertical: "news",
        hl: "fr",
        safe: "active",
        start: 10,
        num: 10,
        anonymous: true,
        rich: false,
      },
    });
    expect(result.organic).toEqual([]);
  });
  test("browser search uses the read-only public endpoint and reports unavailable results", async () => {
    const previous = globalThis.fetch;
    let url = "";
    globalThis.fetch = (async input => {
      url = String(input);
      return Response.json({ query: "Aphrody", organic: [] });
    }) as typeof fetch;
    try {
      await searchGoogle({ query: "Aphrody", vertical: "web", hl: "en", safe: "active", start: 0 });
      const actual = new URL(url, "https://aphrody.com");
      expect(actual.pathname).toBe("/api/search");
      expect([...actual.searchParams.keys()].toSorted()).toEqual(["hl", "query", "safe", "start", "vertical"]);
      globalThis.fetch = Object.assign(async () => Response.json({ error: "Search is busy" }, { status: 429 }), {
        preconnect: previous.preconnect,
      });
      await expect(
        searchGoogle({ query: "Aphrody", vertical: "web", hl: "en", safe: "active", start: 0 }),
      ).rejects.toThrow("Search is busy");
    } finally {
      globalThis.fetch = previous;
    }
  });
});

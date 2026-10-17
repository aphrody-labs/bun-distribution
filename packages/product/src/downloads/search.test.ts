import { expect, test } from "bun:test";
import { createHandler, publicSearchResponse } from "./server.ts";
import type { PublicIndexSearch } from "./public-index.ts";

const indexEnvironment = {
  PUBLIC_SEARCH_BACKEND: "public-index",
  PUBLIC_INDEX_DEFAULT_COLLECTION: "public-docs",
};
const indexOwner: PublicIndexSearch = async ({ query, collection }) => ({
  body: {
    query,
    collection,
    source: "public-crawl-cache",
    generatedAt: "2026-10-11T00:00:00Z",
    organic: [
      {
        title: "Bun",
        url: "https://bun.sh/docs",
        snippet: "Public documentation",
      },
    ],
  },
  etag: '"verified-snapshot"',
  cache: "hit",
});

test("M3 search uses the explicit public collection and preserves conditional responses", async () => {
  let googleCalls = 0;
  const google = async () => {
    googleCalls++;
    throw new Error("must not switch providers");
  };
  const request = new Request("https://aphrody.com/api/search?query=Bun&num=2&start=1", {
    headers: { cookie: "private", authorization: "private" },
  });
  const response = await publicSearchResponse(
    request,
    google,
    async (input, signal) => {
      expect(input).toEqual({
        query: "Bun",
        collection: "public-docs",
        num: 2,
        start: 1,
      });
      expect(signal).toBeInstanceOf(AbortSignal);
      return indexOwner(input);
    },
    indexEnvironment,
  );
  expect(response.status).toBe(200);
  expect((await response.json()).source).toBe("public-crawl-cache");
  const conditional = await publicSearchResponse(
    new Request(request.url, {
      headers: { "if-none-match": 'W/"verified-snapshot"' },
    }),
    google,
    indexOwner,
    indexEnvironment,
  );
  expect(conditional.status).toBe(304);
  expect(await conditional.text()).toBe("");
  expect(googleCalls).toBe(0);
});

test("Public search validates requests and fails closed on invalid backend configuration", async () => {
  let calls = 0;
  const owner: PublicIndexSearch = async input => {
    calls++;
    return indexOwner(input);
  };
  const request = new Request("https://aphrody.com/api/search?query=Bun");
  await Promise.all(
    [
      { PUBLIC_SEARCH_BACKEND: "public-index" },
      { ...indexEnvironment, PUBLIC_INDEX_DEFAULT_COLLECTION: "../private" },
      { PUBLIC_SEARCH_BACKEND: "unknown" },
    ].map(async env => {
      const response = await publicSearchResponse(request, undefined, owner, env);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private");
    }),
  );
  const invalid = await publicSearchResponse(
    new Request(request.url + "&cookies=private"),
    undefined,
    owner,
    indexEnvironment,
  );
  expect(invalid.status).toBe(400);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await publicSearchResponse(
    new Request(request.url, { signal: controller.signal }),
    undefined,
    owner,
    indexEnvironment,
  );
  expect(cancelled.status).toBe(503);
  expect(calls).toBe(0);
});

test("Public search projects only anonymous SafeSearch parameters, never request cookies", async () => {
  const response = await publicSearchResponse(
    new Request("https://aphrody.com/api/search?query=Bun&vertical=web&hl=en&safe=active&start=0", {
      headers: { cookie: "private=session", authorization: "private" },
    }),
    async (args, signal) => {
      expect(args).toEqual({
        query: "Bun",
        vertical: "web",
        safe: "active",
        hl: "en",
        start: 0,
        num: 10,
      });
      expect(signal).toBeInstanceOf(AbortSignal);
      return { query: args.query, organic: [], authenticated: false };
    },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    query: "Bun",
    organic: [],
    authenticated: false,
  });
});

test("Public search rejects privileged arguments and returns redacted upstream failures", async () => {
  let calls = 0;
  const search = async () => {
    calls++;
    throw new Error("private-owner-error");
  };
  const invalid = await Promise.all(
    [
      "query=x&safe=off",
      "query=x&cookies=path",
      "query=x&domain=evil.test",
      "query=x&num=100",
      "query=x&query=y",
      "query=x&vertical=images",
    ].map(query => publicSearchResponse(new Request("https://aphrody.com/api/search?" + query), search)),
  );
  for (const response of invalid) expect(response.status).toBe(400);
  expect(calls).toBe(0);
  expect(
    (
      await publicSearchResponse(
        new Request("https://aphrody.com/api/search?query=x", {
          method: "POST",
        }),
        search,
      )
    ).status,
  ).toBe(405);
  const response = await publicSearchResponse(new Request("https://aphrody.com/api/search?query=x"), search);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-owner-error");
});

test("Bun site handler exposes only the search route on declared site hosts", async () => {
  const handler = createHandler(
    "C:/nonexistent-fixture-downloads",
    { root: "C:/nonexistent-fixture-site", hosts: new Set(["aphrody.com"]) },
    async args => ({ query: args.query, organic: [], authenticated: false }),
  );
  expect((await handler(new Request("https://aphrody.com/api/search?query=Bun"))).status).toBe(200);
  expect((await handler(new Request("https://foreign.test/api/search?query=Bun"))).status).toBe(404);
});

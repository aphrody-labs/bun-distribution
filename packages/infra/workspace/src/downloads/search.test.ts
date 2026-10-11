import { expect, test } from "bun:test";
import { createHandler, publicSearchResponse } from "./server.ts";

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
  expect(await response.json()).toEqual({ query: "Bun", organic: [], authenticated: false });
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
    ].map((query) =>
      publicSearchResponse(new Request("https://aphrody.com/api/search?" + query), search),
    ),
  );
  for (const response of invalid) expect(response.status).toBe(400);
  expect(calls).toBe(0);
  expect(
    (
      await publicSearchResponse(
        new Request("https://aphrody.com/api/search?query=x", { method: "POST" }),
        search,
      )
    ).status,
  ).toBe(405);
  const response = await publicSearchResponse(
    new Request("https://aphrody.com/api/search?query=x"),
    search,
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-owner-error");
});

test("Bun site handler exposes only the search route on declared site hosts", async () => {
  const handler = createHandler(
    "C:/nonexistent-fixture-downloads",
    { root: "C:/nonexistent-fixture-site", hosts: new Set(["aphrody.com"]) },
    async (args) => ({ query: args.query, organic: [], authenticated: false }),
  );
  expect((await handler(new Request("https://aphrody.com/api/search?query=Bun"))).status).toBe(200);
  expect((await handler(new Request("https://foreign.test/api/search?query=Bun"))).status).toBe(
    404,
  );
});

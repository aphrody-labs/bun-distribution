// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configuredPublicIndexSearch,
  createHandler,
  publicIndexResponse,
} from "./server.ts";
import type { PublicIndexSearch } from "./public-index.ts";

const url =
  "https://aphrody.com/api/index/search?query=Bun&collection=public-docs";
const owner: PublicIndexSearch = async ({ query, collection }) => ({
  body: {
    query,
    collection,
    source: "public-crawl-cache",
    generatedAt: "2026-10-11T00:00:00Z",
    organic: [
      {
        title: "Bun fixture",
        url: "https://example.test/bun",
        snippet: "Exported public text",
      },
    ],
  },
  etag: '"snapshot-a"',
  cache: "miss",
});

test("public index projects only its explicit public contract and forwards cancellation", async () => {
  const controller = new AbortController();
  const request = new Request(url, {
    signal: controller.signal,
    headers: { cookie: "private", authorization: "private" },
  });
  const response = await publicIndexResponse(request, async (input, signal) => {
    expect(input).toEqual({
      query: "Bun",
      collection: "public-docs",
      num: 10,
      start: 0,
    });
    expect(signal).toBe(request.signal);
    return { ...(await owner(input)), privateMetadata: "must not project" };
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(
    (
      await owner({
        query: "Bun",
        collection: "public-docs",
        num: 10,
        start: 0,
      })
    ).body,
  );
  expect(response.headers.get("etag")).toBe('"snapshot-a"');
  expect(response.headers.get("x-public-index-cache")).toBe("miss");
});

test("public index rejects invalid, duplicate, privileged and overbudget query parameters before owner calls", async () => {
  let calls = 0;
  await Promise.all(
    [
      "query=Bun",
      "query=Bun&collection=../private",
      "query=Bun&collection=public-docs&file=secret",
      "query=Bun&collection=public-docs&query=other",
      "q=Bun&collection=public-docs",
      "query=%0ABun&collection=public-docs",
      "query=Bun&collection=public-docs&num=21",
      "query=Bun&collection=public-docs&num=0",
      "query=Bun&collection=public-docs&start=1001",
      `query=${"é".repeat(2049)}&collection=public-docs`,
    ].map(async (query) => {
      const response = await publicIndexResponse(
        new Request(`https://aphrody.com/api/index/search?${query}`),
        async (input) => {
          calls++;
          return owner(input);
        },
      );
      expect(response.status).toBe(400);
    }),
  );
  expect(calls).toBe(0);
  const response = await publicIndexResponse(
    new Request(url, { method: "POST" }),
    owner,
  );
  expect(response.status).toBe(405);
  expect(response.headers.get("allow")).toBe("GET");
});

test("public index returns empty 304 only after owner verification and reflects changed snapshot ETag", async () => {
  let calls = 0;
  const cached: PublicIndexSearch = async (input) => {
    calls++;
    return { ...(await owner(input)), cache: "hit" };
  };
  const response = await publicIndexResponse(
    new Request(url, {
      headers: { "if-none-match": '"other", W/"snapshot-a"' },
    }),
    cached,
  );
  expect(response.status).toBe(304);
  expect(await response.text()).toBe("");
  expect(response.headers.get("x-public-index-cache")).toBe("hit");
  expect(calls).toBe(1);
  const changed = await publicIndexResponse(
    new Request(url, { headers: { "if-none-match": '"snapshot-a"' } }),
    async (input) => ({ ...(await owner(input)), etag: '"snapshot-b"' }),
  );
  expect(changed.status).toBe(200);
  expect(changed.headers.get("etag")).toBe('"snapshot-b"');
});

test("public index preserves Unicode and punctuation as owner input, without executing a search language", async () => {
  const query = 'Été "Bun" OR (世界):*';
  const response = await publicIndexResponse(
    new Request(
      `${url.replace("query=Bun", `query=${encodeURIComponent(query)}`)}&num=20&start=1000`,
    ),
    async (input) => {
      expect(input).toEqual({
        query,
        collection: "public-docs",
        num: 20,
        start: 1000,
      });
      return owner(input);
    },
  );
  expect(response.status).toBe(200);
  expect((await response.json()).query).toBe(query);
});

const missing: PublicIndexSearch = async (input, signal) =>
  (await configuredPublicIndexSearch({}))(input, signal);

test("public index redacts missing configuration, unsafe owner output and upstream errors", async () => {
  const searches = [
    missing,
    async () => {
      throw new Error("secret /private/home");
    },
    async (input) => {
      const result = await owner(input);
      result.body.organic[0]!.url = "javascript:private";
      return result;
    },
    async (input) => {
      const result = await owner(input);
      result.etag = "private\r\nheader";
      return result;
    },
  ] satisfies PublicIndexSearch[];
  await Promise.all(
    searches.map(async (search) => {
      const response = await publicIndexResponse(new Request(url), search);
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe(
        '{"error":"Public index is unavailable. Please try again."}',
      );
    }),
  );
});

test("public index stops aborted requests before loading and after owner cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  expect(
    (
      await publicIndexResponse(
        new Request(url, { signal: controller.signal }),
        async (input) => {
          calls++;
          return owner(input);
        },
      )
    ).status,
  ).toBe(503);
  expect(calls).toBe(0);
  const later = new AbortController();
  const response = await publicIndexResponse(
    new Request(url, { signal: later.signal }),
    async (input, signal) => {
      later.abort();
      expect(signal?.aborted).toBe(true);
      return owner(input);
    },
  );
  expect(response.status).toBe(503);
});

test("public index route is restricted to declared site hosts", async () => {
  const handler = createHandler(
    join(tmpdir(), "no-fixture-downloads"),
    {
      root: join(tmpdir(), "no-fixture-site"),
      hosts: new Set(["aphrody.com"]),
    },
    undefined,
    owner,
  );
  expect((await handler(new Request(url))).status).toBe(200);
  expect(
    (await handler(new Request(url.replace("aphrody.com", "foreign.test"))))
      .status,
  ).toBe(404);
});

test("explicit SDK configuration resolves real fixture module and standalone server erases type-only imports", async () => {
  const root = await mkdtemp(join(tmpdir(), "public-index-adapter-"));
  try {
    const module = join(root, "sdk.ts");
    await writeFile(
      module,
      `export function createPublicIndexSearch(options) { if (!options.root || !options.collections["public-docs"]) throw Error("bad config"); return async input => ({body:{...input,organic:[],source:"public-crawl-cache",generatedAt:"2026-10-11T00:00:00Z"},etag:'"fixture"',cache:"miss"}); }`,
    );
    const collections = {
      "public-docs": {
        pointer: "public-docs.pointer.json",
        hosts: ["example.test"],
        owner: "fixture-only",
        policySha256: "a".repeat(64),
      },
    };
    const env = {
      PUBLIC_INDEX_SDK_MODULE: module,
      PUBLIC_INDEX_ROOT: root,
      PUBLIC_INDEX_COLLECTIONS: JSON.stringify(collections),
    };
    const configured = await configuredPublicIndexSearch(env);
    expect(
      (await publicIndexResponse(new Request(url), configured)).status,
    ).toBe(200);
    const missingModule: PublicIndexSearch = async (input, signal) =>
      (
        await configuredPublicIndexSearch({
          ...env,
          PUBLIC_INDEX_SDK_MODULE: join(root, "absent.ts"),
        })
      )(input, signal);
    expect(
      (await publicIndexResponse(new Request(url), missingModule)).status,
    ).toBe(503);
    await Promise.all(
      [
        { ...env, PUBLIC_INDEX_ROOT: "relative" },
        { ...env, PUBLIC_INDEX_COLLECTIONS: "{" },
        { ...env, PUBLIC_INDEX_COLLECTIONS: "{}" },
        {
          ...env,
          PUBLIC_INDEX_COLLECTIONS: JSON.stringify({
            "public-docs": {
              ...collections["public-docs"],
              pointer: "../private",
            },
          }),
        },
      ].map(async (invalid) => {
        await expect(configuredPublicIndexSearch(invalid)).rejects.toThrow();
      }),
    );
    await copyFile(join(import.meta.dir, "server.ts"), join(root, "server.ts"));
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import {publicIndexResponse} from ${JSON.stringify(join(root, "server.ts"))}; const r=await publicIndexResponse(new Request(${JSON.stringify(url)}));console.log(r.status);`,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          PUBLIC_INDEX_SDK_MODULE: "",
          PUBLIC_INDEX_ROOT: "",
          PUBLIC_INDEX_COLLECTIONS: "",
        },
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    expect(stdout.trim()).toBe("503");
    expect(stderr).toBe("");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

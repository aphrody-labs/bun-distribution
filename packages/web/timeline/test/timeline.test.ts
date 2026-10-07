// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { collect, normalize, trainingRows, SOURCE, MEDIA_API, AGE_API } from "../src/model.ts";
import { sqlExport } from "../src/storage.ts";
import { query } from "../src/graphql.ts";
import { detailText, crawlDetails } from "../src/crawl.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTimelineHandler } from "../src/server.ts";
import { indexRetrieval } from "../src/retrieval.ts";

const media = {
  source: SOURCE,
  total: 2,
  timelineTotal: 2,
  entries: [
    {
      rank: 1,
      kind: "movie",
      id: 11,
      title: "Bardock's story",
      titleJa: "バーダック",
      series: "DBZ_SPECIAL",
      era: "DB",
      eraLabel: "Dragon Ball",
      number: null,
      date: "1990-10-17",
      href: "https://dragonballfr.com/wiki/movies/bardock",
      api: "https://dragonballfr.com/api/public/wiki/movies/11",
    },
    {
      rank: 2,
      kind: "episode",
      id: 1,
      title: "Le Grand Départ",
      titleJa: null,
      series: "DB",
      era: "DB",
      eraLabel: "Dragon Ball",
      number: 1,
      date: "1986-02-26",
      href: "https://dragonballfr.com/wiki/episodes/1",
      api: "https://dragonballfr.com/api/public/wiki/episodes/1",
    },
  ],
};
const ages = [
  {
    id: 2,
    ageYear: -5000000,
    ageMonth: null,
    ageDay: null,
    era: "pre-history",
    title: "Majin Buu",
    titleJa: null,
    description: "Les Kaïōshins",
    charactersInvolved: ["Buu"],
    sourceRef: "Daizenshuu 7, p.16",
    canon: "1",
    orderIdx: 1,
  },
];

test("native retrieval refresh retires only its namespace after all documents and vectors are acknowledged", async () => {
  const documents = new Map<string, { originSourceId: string; syncGeneration: string }>([
    ["obsolete", { originSourceId: "application:timeline", syncGeneration: "old" }],
    ["other-corpus", { originSourceId: "application:wiki", syncGeneration: "old" }],
  ]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      expect(request.headers.get("Authorization")).toBe("Bearer test-token");
      const body = await request.json();
      if (new URL(request.url).pathname.endsWith("/ingest")) {
        expect(body.content).toContain("Source : " + SOURCE);
        documents.set(body.sourceId, body);
        return Response.json({ sourceId: body.sourceId, indexed: true, vectorIndexed: true });
      }
      expect(body.expectedCount).toBe(3);
      let retired = 0;
      for (const [key, document] of documents)
        if (
          document.originSourceId === body.originSourceId &&
          document.syncGeneration !== body.syncGeneration
        ) {
          documents.delete(key);
          retired++;
        }
      return Response.json({ status: "complete", active: 3, retired });
    },
  });
  try {
    const options = {
      url: server.url.origin,
      token: "test-token",
      originSourceId: "application:timeline",
      requireVectors: true,
    };
    const snapshot = normalize(media, ages);
    expect(await indexRetrieval(snapshot, options)).toEqual({
      indexed: 3,
      vectors: 3,
      retired: 1,
      originSourceId: "application:timeline",
    });
    expect((await indexRetrieval(snapshot, options)).retired).toBe(0);
    expect(documents.size).toBe(4);
    expect(documents.has("other-corpus")).toBe(true);
  } finally {
    await server.stop(true);
  }
});

test("an incomplete or vectorless retrieval pass cannot retire the previous corpus", async () => {
  for (const failure of ["http", "vector", "acknowledgement"]) {
    const calls: string[] = [];
    const snapshot = normalize(media, ages);
    // eslint-disable-next-line no-await-in-loop -- Each failure scenario owns an independent transport.
    await expect(
      indexRetrieval(snapshot, {
        url: "https://backend.example.org",
        token: "protected-token",
        originSourceId: "application:timeline",
        requireVectors: true,
        fetcher: async (input, init) => {
          calls.push(new URL(String(input)).pathname);
          const body = JSON.parse(init!.body as string);
          if (calls.length === 1)
            return Response.json({ sourceId: body.sourceId, indexed: true, vectorIndexed: true });
          return failure === "http"
            ? new Response("private error details", { status: 503 })
            : Response.json({
                sourceId: failure === "acknowledgement" ? "different" : body.sourceId,
                indexed: true,
                vectorIndexed: false,
              });
        },
      }),
    ).rejects.toThrow(/retrieval/);
    expect(calls).toHaveLength(2);
    expect(calls.every((path) => path.endsWith("/ingest"))).toBe(true);
  }
});

test("retrieval count mismatches and absent credentials fail without exposing protected response data", async () => {
  const options = {
    url: "https://backend.example.org",
    token: "protected-token",
    originSourceId: "application:timeline",
    fetcher: async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      return Response.json(
        body.sourceId
          ? { sourceId: body.sourceId, indexed: true }
          : { status: "complete", active: 2, retired: 0 },
      );
    },
  };
  await expect(indexRetrieval(normalize(media, ages), options)).rejects.toThrow("count mismatch");
  await expect(indexRetrieval(normalize(media, ages), { ...options, token: "" })).rejects.toThrow(
    "configuration",
  );
});

test("linked crawl indexes editorial fields and excludes streaming/config payloads", () => {
  expect(
    detailText({
      title: "Goku",
      synopsisFr: "Résumé",
      players: [{ url: "private-stream" }],
      videoUrl: "private-stream",
      officialSourceUrl: "https://lineup.toei-anim.co.jp/",
    }),
  ).toBe("title: Goku\nsynopsisFr: Résumé\nofficialSourceUrl: https://lineup.toei-anim.co.jp/");
  expect(() => detailText([])).toThrow();
});

test("the same native package supports another application source and mounts into Bun.serve", async () => {
  const source = {
    source: "https://example.org/wiki/timeline",
    mediaApi: "https://example.org/api/timeline",
    ageApi: "https://example.org/api/ages",
  };
  const s = normalize(
    {
      ...media,
      source: source.source,
      entries: media.entries.map((e) => ({
        ...e,
        href: e.href.replace("dragonballfr.com", "example.org"),
        api: e.api.replace("dragonballfr.com", "example.org"),
      })),
    },
    ages,
    undefined,
    source,
  );
  expect(s.source).toBe(source.source);
  expect(s.entries[2]!.api).toBe(source.ageApi + "/2");
  const rows = trainingRows(s, {
    subject: "Example",
    originSourceId: "example:timeline",
    content: (entry) => `Verified detail: ${entry.title}`,
  });
  expect(rows[0]!.sourceId).toBe("example:timeline:movie:11");
  expect(rows[0]!.messages[0]!.content).toContain("Example");
  expect(rows[0]!.messages[1]!.content).toBe("Verified detail: Bardock's story");
  const handler = createTimelineHandler(() => s);
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  try {
    const response = await fetch(new URL("/graphql", server.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ timeline { source mediaTotal ageTotal } }" }),
    });
    expect(await response.json()).toEqual({
      data: { timeline: { source: source.source, mediaTotal: 2, ageTotal: 1 } },
    });
    expect((await fetch(new URL("/graphql", server.url))).status).toBe(405);
    expect(
      (await fetch(new URL("/graphql", server.url), { method: "POST", body: "invalid" })).status,
    ).toBe(400);
  } finally {
    await server.stop(true);
  }
});

test("curation precedes broadcast dates; negative ages and print provenance survive every projection", async () => {
  const s = normalize(media, ages, "2026-10-07T00:00:00Z");
  expect(s.entries[0]!.id).toBe(11);
  const db = new Database(":memory:");
  try {
    db.exec(sqlExport(s));
    db.exec(sqlExport(s));
    expect(db.query("SELECT count(*) AS n FROM shenron_timeline").get()).toEqual({ n: 3 });
    const saved = db
      .query("SELECT payload FROM shenron_timeline WHERE entry_key='age:2'")
      .get() as { payload: string };
    expect(JSON.parse(saved.payload)).toEqual(s.entries[2]);
    expect(db.query("SELECT title FROM shenron_timeline WHERE editorial_rank=1").get()).toEqual({
      title: "Bardock's story",
    });
  } finally {
    db.close();
  }
  const result = await query(
    s,
    "query ($key: ID!) { timeline { mediaTotal ageTotal } timelineEntry(key:$key) { ageYear sourceRef canon } }",
    { key: "age:2" },
  );
  expect(result.errors).toBeUndefined();
  expect(JSON.parse(JSON.stringify(result.data))).toEqual({
    timeline: { mediaTotal: 2, ageTotal: 1 },
    timelineEntry: { ageYear: -5000000, sourceRef: "Daizenshuu 7, p.16", canon: true },
  });
});

test("truncated, duplicate, reordered or foreign-source media cannot replace a complete generation", () => {
  expect(() => normalize({ ...media, total: 1 }, ages)).toThrow("incomplete");
  expect(() => normalize({ ...media, entries: media.entries.toReversed() }, ages)).toThrow("rank");
  expect(() => normalize(media, [...ages, ...ages])).toThrow("duplicate");
  expect(() =>
    normalize(
      {
        ...media,
        entries: [{ ...media.entries[0], href: "https://other.test/" }, media.entries[1]],
      },
      ages,
    ),
  ).toThrow("source URL");
  expect(normalize(media, ages, "first").generation).toBe(
    normalize(media, ages, "second").generation,
  );
});

test("age pagination follows every page and rejects unavailable or changing sources", async () => {
  const many = Array.from({ length: 101 }, (_, i) => ({ ...ages[0], id: i + 1 }));
  const calls: string[] = [];
  const fetcher = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const offset = Number(new URL(url).searchParams.get("offset") ?? 0);
    return Response.json(
      url === MEDIA_API ? media : { total: 101, offset, items: many.slice(offset, offset + 100) },
    );
  };
  expect((await collect(fetcher)).ageTotal).toBe(101);
  expect(calls).toEqual([
    MEDIA_API,
    AGE_API + "?limit=100&offset=0",
    AGE_API + "?limit=100&offset=100",
  ]);
  await expect(collect(async () => new Response("offline", { status: 503 }))).rejects.toThrow(
    "unavailable",
  );
});

test("held-out entities stay out of training when content changes", () => {
  const s = normalize(media, ages);
  const before = trainingRows(s);
  const after = trainingRows({
    ...s,
    entries: s.entries.map((e) => ({ ...e, title: e.title + " correction" })),
  });
  expect(before.map((r) => [r.sourceId, r.split])).toEqual(after.map((r) => [r.sourceId, r.split]));
  expect(new Set(before.map((r) => r.sourceId)).size).toBe(s.entries.length);
  expect(before.find((r) => r.sourceId.endsWith("age:2"))!.messages[1]!.content).toContain(
    "Daizenshuu 7",
  );
});

test("GraphQL filters retain original ranks and enforce pagination limits", async () => {
  const s = normalize(media, ages);
  const r = await query(s, "{ timelineEntries(kind:episode) { rank key } }");
  expect(JSON.parse(JSON.stringify(r.data))).toEqual({
    timelineEntries: [{ rank: 2, key: "episode:1" }],
  });
  expect((await query(s, "{ timelineEntries(limit:1001) { key } }")).errors).toHaveLength(1);
});

test("a broken linked source preserves its last successful text and stays eligible for refresh", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shenron-timeline-"));
  try {
    const s = normalize(media, ages);
    const file = join(dir, "crawl-state.json");
    await Bun.write(
      file,
      JSON.stringify({
        entries: {
          "age:2": {
            checkedAt: "2026-01-01T00:00:00Z",
            status: 200,
            failures: 0,
            lastSuccessAt: "2026-01-01T00:00:00Z",
            text: "known good",
          },
        },
      }),
    );
    const fail = await crawlDetails(
      s,
      dir,
      3,
      async () => new Response("offline", { status: 503 }),
      async () => {},
    );
    expect(fail.failed).toBe(3);
    expect(fail.state.entries["age:2"]!.text).toBe("known good");
    const recovered = await crawlDetails(
      s,
      dir,
      3,
      async () => Response.json({ title: "Recovered" }),
      async () => {},
    );
    expect(recovered.failed).toBe(0);
    expect(recovered.state.entries["age:2"]!.failures).toBe(0);
    expect(recovered.state.entries["age:2"]!.text).toBe("title: Recovered");
  } finally {
    await rm(dir, { recursive: true });
  }
});

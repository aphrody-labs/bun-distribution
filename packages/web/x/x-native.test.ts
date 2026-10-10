// SPDX-License-Identifier: Apache-2.0
// @aphrody/x over the real aphrody-ffi library: the thin client, the batch iterator, the store and
// the shared policy data, against a loopback server (no request leaves the machine, no real
// credential). Skips until the cdylib exists (cargo build -p aphrody-ffi, then APHRODY_FFI_DEV=1 or
// APHRODY_FFI_LIB=...).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveNativeLibraryPath } from "@aphrody/bun/src/library";
import policy from "../../../crates/web/x/data/x-policy.json";
import {
  API_BASE,
  Store,
  XClient,
  XError,
  XSession,
  isAuthFailure,
  isTerminalError,
  parsePostCount,
  walkTimelineTweets,
  xBatch,
  xLocal,
} from "./src/index";

let available = false;
try {
  available = resolveNativeLibraryPath() !== undefined;
} catch {
  available = false;
}
const native = test.skipIf(!available);

let server: ReturnType<typeof Bun.serve>;
let dir: string;
const requests: { method: string; path: string; csrf: string | null; cookie: string | null }[] = [];

const USER = {
  data: {
    user: {
      result: {
        rest_id: "7",
        core: { name: "Aphrody", screen_name: "aphrody_code" },
        legacy: { followers_count: 10, friends_count: 5 },
      },
    },
  },
};

const SEARCH = {
  data: {
    search_by_raw_query: {
      search_timeline: {
        timeline: {
          instructions: [
            {
              type: "TimelineAddEntries",
              entries: [
                {
                  entryId: "tweet-1",
                  content: {
                    entryType: "TimelineTimelineItem",
                    itemContent: {
                      tweet_results: {
                        result: {
                          rest_id: "1",
                          core: {
                            user_results: { result: { core: { screen_name: "a", name: "A" } } },
                          },
                          legacy: {
                            id_str: "1",
                            full_text: "hello native",
                            created_at: "Wed May 22 10:00:00 +0000 2026",
                            favorite_count: 3,
                          },
                        },
                      },
                    },
                  },
                },
                {
                  entryId: "cursor-bottom",
                  content: {
                    entryType: "TimelineTimelineCursor",
                    cursorType: "Bottom",
                    value: "CUR",
                  },
                },
              ],
            },
          ],
        },
      },
    },
  },
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "aphx-web-"));
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "GET" ? "" : await request.text();
      requests.push({
        method: request.method,
        path: url.pathname,
        csrf: request.headers.get("x-csrf-token"),
        cookie: request.headers.get("cookie"),
      });
      const rate = {
        "x-rate-limit-limit": "50",
        "x-rate-limit-remaining": "49",
        "x-rate-limit-reset": "4102444800",
      };
      if (url.pathname.endsWith("/UserByScreenName")) return Response.json(USER, { headers: rate });
      if (url.pathname.endsWith("/SearchTimeline")) return Response.json(SEARCH, { headers: rate });
      if (url.pathname.endsWith("/FavoriteTweet")) {
        const id = JSON.parse(body || "{}")?.variables?.tweet_id;
        if (id === "4040")
          return Response.json(
            { errors: [{ code: 144, message: "status not found" }] },
            { status: 404 },
          );
        if (id === "9999")
          return Response.json(
            { errors: [{ code: 32, message: "could not authenticate" }] },
            { status: 401 },
          );
        return Response.json({ data: { favorite_tweet: "Done" } }, { headers: rate });
      }
      return Response.json({ data: {} });
    },
  });
});

afterAll(() => {
  server?.stop(true);
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function client(): XClient {
  return new XClient(
    new XSession({ auth_token: "AUTH_TOKEN_PLACEHOLDER", ct0: "CT0_PLACEHOLDER" }),
    {
      apiBase: `http://127.0.0.1:${server.port}/i/api`,
      uploadBase: `http://127.0.0.1:${server.port}/upload`,
      persistSession: false,
      queryIdsPath: join(dir, "query-ids.json"),
      discoveryPages: [],
    },
  );
}

describe("without the native library", () => {
  test("a client is built lazily and the error classes classify by tables", () => {
    const lazy = new XClient("auth_token=fake; ct0=fake");
    expect(lazy.lastRateLimit).toBeNull();
    expect(isAuthFailure(new XError("x", 32))).toBe(true);
    expect(isAuthFailure(new XError("HTTP 403", -1, 403))).toBe(true);
    expect(isTerminalError(new XError("gone", 144))).toBe(true);
    // A native classification wins over the tables.
    expect(isTerminalError(new XError("whatever", -1, undefined, "terminal"))).toBe(true);
    expect(isAuthFailure(new XError("32 but classified otherwise", 32, undefined, "other"))).toBe(
      false,
    );
  });
});

describe("over aphrody-x", () => {
  native("the policy tables are the one JSON file Rust reads", () => {
    const meta = xLocal<{ policy: typeof policy; surface: { api_base: string } }>("meta");
    expect(meta.policy).toEqual(policy);
    expect(meta.surface.api_base).toBe(API_BASE);
  });

  native("parsers are the native ones", () => {
    expect(parsePostCount("12.3K posts")).toBe(12300);
    const page = walkTimelineTweets(SEARCH);
    expect(page.tweets).toHaveLength(1);
    expect(page.tweets[0]?.text).toBe("hello native");
    expect(page.next_cursor).toBe("CUR");
  });

  native("the client reads, searches and sends the session headers per request", async () => {
    const x = client();
    requests.length = 0;
    const user = await x.userByScreenName("@aphrody_code");
    expect(user).toMatchObject({ id: "7", screen_name: "aphrody_code", followers_count: 10 });
    expect(requests[0]?.csrf).toBe("CT0_PLACEHOLDER");
    expect(requests[0]?.cookie).toContain("auth_token=AUTH_TOKEN_PLACEHOLDER");
    expect(x.lastRateLimit).toMatchObject({ limit: 50, remaining: 49 });

    const page = await x.search("hello", 10);
    expect(page.tweets[0]?.id).toBe("1");
    expect(page.next_cursor).toBe("CUR");
    x.close();
  });

  native("failures throw an XError carrying the Rust classification", async () => {
    const x = client();
    const gone = await x.like("4040").catch((error) => error);
    expect(gone).toBeInstanceOf(XError);
    expect(gone.kind).toBe("terminal");
    expect(isTerminalError(gone)).toBe(true);
    const dead = await x.like("9999").catch((error) => error);
    expect(dead.kind).toBe("auth");
    expect(isAuthFailure(dead)).toBe(true);
    const invalid = await x.call("like", {}).catch((error) => error);
    expect(invalid.kind).toBe("invalid");
    x.close();
  });

  native("xBatch streams results, resumes from its checkpoint and reports a summary", async () => {
    const x = client();
    const checkpoint = join(dir, "batch.jsonl");
    const ops = Array.from({ length: 12 }, (_, i) => ({
      id: `like-${i}`,
      op: "like",
      args: { id: i === 3 ? "4040" : `${5000 + i}` },
    }));
    const progress: number[] = [];
    const run = xBatch(x, ops, {
      concurrency: 4,
      checkpoint,
      onProgress: (p) => progress.push(p.completed),
    });
    const results = [];
    for await (const result of run) results.push(result);
    expect(results).toHaveLength(12);
    expect(new Set(results.map((r) => r.id)).size).toBe(12);
    expect(run.summary).toMatchObject({
      total: 12,
      ok: 11,
      failed: 1,
      resumed: 0,
      stopped_by: null,
    });
    expect(progress.at(-1)).toBe(12);
    expect(readFileSync(checkpoint, "utf8")).not.toContain("AUTH_TOKEN_PLACEHOLDER");

    requests.length = 0;
    const again = xBatch(x, ops, { concurrency: 4, checkpoint });
    const replayed = await again.collect();
    expect(replayed.every((r) => r.resumed === true)).toBe(true);
    expect(again.summary?.resumed).toBe(12);
    expect(requests).toHaveLength(0);
    x.close();
  });

  native("aborting a batch stops the iteration and cancels the native work", async () => {
    const x = client();
    const controller = new AbortController();
    const ops = Array.from({ length: 500 }, (_, i) => ({
      id: `n${i}`,
      op: "like",
      args: { id: `${9000 + i}` },
    }));
    const run = xBatch(x, ops, { concurrency: 1, signal: controller.signal });
    let seen = 0;
    for await (const _result of run) {
      seen++;
      if (seen === 3) controller.abort();
    }
    expect(seen).toBeLessThan(500);
    expect(run.summary?.stopped_by).toBe("aborted");
    x.close();
  });

  native("the store lives in Rust and answers read-only SQL", () => {
    const store = new Store(":memory:");
    store.upsertTweet({
      id: "999888",
      text: "hello bun and sqlite database",
      author: { username: "aphrody_code", name: "Aphrody" },
      like_count: 5,
    } as never);
    expect(store.stats().tweets).toBe(1);
    expect(store.query<{ id: string }>("SELECT id FROM tweets")).toEqual([{ id: "999888" }]);
    expect(() => store.query("DELETE FROM tweets")).toThrow(XError);
    store.close();
    expect(() => store.stats()).toThrow("closed");
  });
});

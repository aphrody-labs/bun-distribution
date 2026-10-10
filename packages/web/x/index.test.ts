// SPDX-License-Identifier: Apache-2.0
import { expect, test, describe } from "bun:test";
import { XSession } from "./src/core/session";
import { XClient } from "./src/core/client";
import { getOperation, allOperations } from "./src/config/catalog";
import { featuresFor } from "./src/core/features";
import { parsePostCount } from "./src/services/news";
import { Store, edge } from "./src/db/store";
import { parseArchiveArray, archiveTweetToTweet } from "./src/db/archive";
import {
  rankPosts,
  rankTweets,
  toPostCandidate,
  tweetToPostCandidate,
  type PostCandidate,
  type RankingContext,
} from "./src/algo";
import type { Tweet } from "./src/core/schemas";

describe("X Client Unit Tests", () => {
  test("catalog resolves operations", () => {
    const op = getOperation("Viewer");
    expect(op).toBeDefined();
    expect(op?.name).toBe("Viewer");
    expect(op?.operationType).toBe("query");

    const all = allOperations();
    expect(all.length).toBeGreaterThan(100);
  });

  test("feature flag lookup", () => {
    const op = getOperation("CreateTweet");
    expect(op).toBeDefined();
    const feat = featuresFor(op!);
    expect(feat).toBeDefined();
    expect(feat.responsive_web_graphql_timeline_navigation_enabled).toBe(true);
  });

  test("post count parsing", () => {
    expect(parsePostCount("12.3K posts")).toBe(12300);
    expect(parsePostCount("5M posts")).toBe(5000000);
    expect(parsePostCount("42 posts")).toBe(42);
    expect(parsePostCount("no number here")).toBeNull();
  });

  test("session string parsing", () => {
    const cookieStr = "auth_token=abc123xyz; ct0=csrf456tuv";
    const session = XSession.fromCookieString(cookieStr);
    expect(session.auth_token).toBe("abc123xyz");
    expect(session.ct0).toBe("csrf456tuv");
  });

  test("SQLite store operations", () => {
    const store = new Store(":memory:");
    const sampleTweet = {
      id: "999888",
      text: "hello bun and sqlite database",
      author: { username: "aphrody_code", name: "Aphrody" },
      reply_count: 1,
      retweet_count: 2,
      like_count: 5,
      quote_count: 0,
      is_note_tweet: false,
    };

    store.upsertTweet(sampleTweet);
    store.addEdge("viewer", edge.AUTHORED, sampleTweet.id);

    const stats = store.stats();
    expect(stats.tweets).toBe(1);
    expect(stats.edges).toBe(1);

    const results = store.search("sqlite", 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("999888");
    expect(results[0].author_username).toBe("aphrody_code");
    expect(results[0].like_count).toBe(5);

    const digest = store.digest(5);
    expect(digest.top_authors[0][0]).toBe("aphrody_code");
    expect(digest.top_tweets[0].id).toBe("999888");

    store.close();
  });

  test("archive parsing and conversion", () => {
    const raw = `window.YTD.tweets.part0 = [
      { "tweet" : { "id_str": "12345", "full_text": "hello archive", "favorite_count": "12", "created_at": "Wed May 22 10:00:00 +0000 2026" } }
    ]`;
    const arr = parseArchiveArray(raw);
    expect(arr.length).toBe(1);

    const owner = { username: "viewer", name: "Viewer" };
    const tweet = archiveTweetToTweet(arr[0], owner);
    expect(tweet).not.toBeNull();
    expect(tweet?.id).toBe("12345");
    expect(tweet?.text).toBe("hello archive");
    expect(tweet?.like_count).toBe(12);
    expect(tweet?.author.username).toBe("viewer");
  });
});

describe("X Algo (For You ranking - from x-algorithm)", () => {
  const now = Math.floor(Date.now() / 1000);

  const baseCandidate: PostCandidate = {
    id: "1",
    author_id: "u1",
    author_handle: "user1",
    text: "Hello world this is a test post with media and good engagement",
    created_at: now - 3600, // 1h ago
    like_count: 1200,
    reply_count: 80,
    repost_count: 300,
    quote_count: 40,
    is_reply: false,
    is_repost: false,
    has_media: true,
    in_network: true,
  };

  test("rankPosts applies filters and scores correctly", () => {
    const candidates: PostCandidate[] = [
      { ...baseCandidate, id: "1", author_id: "u1", in_network: true },
      {
        ...baseCandidate,
        id: "2",
        author_id: "u2",
        like_count: 5,
        text: "short",
        created_at: now - 100000,
        in_network: false,
      },
      {
        ...baseCandidate,
        id: "3",
        author_id: "u1",
        text: "duplicate id? no",
        created_at: now - 10,
      },
    ];

    const ctx: RankingContext = {
      viewer_id: "viewer",
      followed_author_ids: ["u1"],
      recent_engagement_author_ids: ["u1"],
      muted_keywords: ["spam"],
      now_unix: now,
      max_age_secs: 7 * 24 * 3600,
    };

    // add a muted one
    const muted = {
      ...baseCandidate,
      id: "4",
      author_id: "u3",
      text: "this contains spam keyword",
      created_at: now - 1000,
    };

    const ranked = rankPosts([...candidates, muted], ctx, 10);

    // dupe filter, self (none), blocked (none), muted (filtered), age (none filtered)
    expect(ranked.length).toBe(3); // 1,2,3 (4 muted out)
    expect(ranked[0].post.id).toBe("1"); // highest: in_network + eng + history + fresh + media
    expect(ranked[0].reasons.some((r) => r.includes("in_network"))).toBe(true);
    expect(ranked[0].reasons.some((r) => r.includes("engagement"))).toBe(true);
    expect(ranked.some((r) => r.post.id === "4")).toBe(false); // muted filtered
  });

  test("author diversity attenuates repeats", () => {
    // Clean low-base candidates: c1 high, c2 same-author medium, c3 other-author slightly lower; pen drops c2 below c3
    const make = (id: string, author: string, like: number) =>
      ({
        id,
        author_id: author,
        author_handle: author,
        text: "test " + id,
        created_at: now - 3600,
        like_count: like,
        reply_count: 0,
        repost_count: 0,
        quote_count: 0,
        is_reply: false,
        is_repost: false,
        has_media: false,
        in_network: false,
      }) as PostCandidate;

    const c1 = make("a1", "same", 500);
    const c2 = make("a2", "same", 200);
    const c3 = make("a3", "other", 180);

    const ranked = rankPosts([c1, c2, c3], { now_unix: now }, 5);
    // c1 highest, then c3 (diversity over penalized c2)
    expect(ranked[0].post.id).toBe("a1");
    expect(ranked[1].post.id).toBe("a3");
    expect(ranked[2].post.id).toBe("a2");
    expect(
      ranked.find((r) => r.post.id === "a2")!.reasons.some((r) => r.includes("diversity_penalty")),
    ).toBe(true);
  });

  test("toPostCandidate and tweetToPostCandidate roundtrip", () => {
    const raw = {
      id: "raw123",
      text: "raw post",
      author: { id: "au1" }, // no username -> stays in raw path
      author_id: "au1",
      created_at: "2026-06-01T00:00:00Z",
      like_count: 10,
      reply_count: 1,
      repost_count: 2,
      quote_count: 0,
      is_reply: false,
      is_repost: true,
      has_media: true,
      in_network: undefined,
    };
    const fromRaw = toPostCandidate(raw);
    expect(fromRaw).not.toBeNull();
    expect(fromRaw!.id).toBe("raw123");
    expect(fromRaw!.author_handle).toBeUndefined();
    expect(fromRaw!.in_network).toBeUndefined();

    const tweet: Tweet = {
      id: "t123",
      text: "typed tweet",
      author: { username: "typed", name: "Typed" },
      author_id: "au2",
      created_at: "2026-06-01T00:00:00Z",
      like_count: 99,
      reply_count: 5,
      retweet_count: 10,
      quote_count: 1,
      is_note_tweet: false,
      quoted_tweet: null,
      media: [{ type: "photo" }],
    } as any;

    const fromTweet = tweetToPostCandidate(tweet, true);
    expect(fromTweet.id).toBe("t123");
    expect(fromTweet.in_network).toBe(true);
    expect(fromTweet.has_media).toBe(true);
    expect(fromTweet.is_repost).toBe(false); // based on quoted_tweet

    // raw with typed shape
    const fromTypedRaw = toPostCandidate(tweet as any);
    expect(fromTypedRaw!.author_id).toBe("au2");
  });

  test("rankTweets converts and ranks", () => {
    const tweets: Tweet[] = [
      {
        id: "rt1",
        text: "high",
        author: { username: "h", name: "H" },
        author_id: "hu",
        like_count: 1000,
        reply_count: 100,
        retweet_count: 200,
        quote_count: 10,
        created_at: new Date(now * 1000 - 1000).toISOString(),
        is_note_tweet: false,
      } as any,
      {
        id: "rt2",
        text: "low",
        author: { username: "l", name: "L" },
        author_id: "lu",
        like_count: 1,
        reply_count: 0,
        retweet_count: 0,
        quote_count: 0,
        created_at: new Date(now * 1000 - 100000).toISOString(),
        is_note_tweet: false,
      } as any,
    ];

    const ranked = rankTweets(tweets, { viewer_id: "v", now_unix: now }, 5);
    expect(ranked.length).toBe(2);
    expect(ranked[0].post.id).toBe("rt1");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  test("algo ranks results from mock XClient search (integration unit)", async () => {
    // Simulate fetching from XClient then ranking locally (no network)
    const mockSearchResults: Tweet[] = [
      {
        id: "s1",
        text: "popular post about topic",
        author: { username: "p1", name: "P1" },
        author_id: "p1id",
        like_count: 5000,
        reply_count: 200,
        retweet_count: 1000,
        quote_count: 50,
        created_at: new Date(now * 1000 - 500).toISOString(),
        is_note_tweet: false,
      } as any,
      {
        id: "s2",
        text: "low engagement",
        author: { username: "p2", name: "P2" },
        author_id: "p2id",
        like_count: 10,
        reply_count: 0,
        retweet_count: 1,
        quote_count: 0,
        created_at: new Date(now * 1000 - 10000).toISOString(),
        is_note_tweet: false,
      } as any,
    ];

    const ranked = rankTweets(
      mockSearchResults,
      { viewer_id: "viewer", now_unix: now, followed_author_ids: ["p1id"] },
      5,
    );
    expect(ranked.length).toBe(2);
    expect(ranked[0].post.id).toBe("s1"); // high eng + in_network (followed)
    expect(
      ranked[0].reasons.some((r) => r.includes("in_network") || r.includes("engagement")),
    ).toBe(true);
  });
});

describe("X Client Integration Tests", () => {
  test("whoami & getNews integration", async () => {
    if (process.env.SKIP_NETWORK_TESTS) {
      return;
    }
    let session: XSession;
    try {
      session = XSession.load();
    } catch {
      console.warn("Skipping live integration tests: no session file found.");
      return;
    }

    const client = new XClient(session);
    console.log("Session loaded successfully. Resolving whoami...");

    try {
      const user = await client.whoami();
      console.log(`Successfully authenticated as @${user.screen_name} (ID: ${user.id})`);
      expect(user.id).toBeDefined();
      expect(user.screen_name).toBeDefined();
      expect(user.name).toBeDefined();

      console.log("Fetching news from Explore tabs...");
      const news = await client.getNews(5);
      console.log(`Fetched ${news.length} news items:`);
      for (const item of news) {
        console.log(`- [${item.category}] ${item.headline} (${item.post_count ?? 0} posts)`);
      }
      expect(news.length).toBeGreaterThanOrEqual(0);
    } catch (err: any) {
      console.error("Live integration test failed:", err.message);
      throw err;
    }
  });
});

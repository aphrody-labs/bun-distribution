// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  X_TOOL_NAMES,
  XSession,
  XTools,
  isXToolName,
  xNativeTools,
  xNewsToolDef,
  xSearchToolDef,
  xTweetsToolDef,
  xWhoamiToolDef,
  type XToolsClient,
} from "./src/index";

function mockClient(calls: string[]): XToolsClient {
  return {
    whoami: async () => {
      calls.push("whoami");
      return { id: "1", name: "Viewer", screen_name: "viewer" };
    },
    userByScreenName: async (handle: string) => {
      calls.push(`userByScreenName:${handle}`);
      return { id: "u1", name: "Test", screen_name: handle };
    },
    userTweets: async (id: string, count: number) => {
      calls.push(`userTweets:${id}:${count}`);
      return {
        tweets: [{ id: "t1", text: "hi", author: { username: "bar", name: "Bar" }, like_count: 3 }],
      };
    },
    getNews: async (count: number) => {
      calls.push(`getNews:${count}`);
      return [
        {
          id: "n1",
          headline: "Headline",
          category: "Tech",
          post_count: 1200,
          url: "https://x.com/i/trending/n1",
        },
      ];
    },
    search: async (query: string, count: number, _cursor?: string, product?: string) => {
      calls.push(`search:${query}:${count}:${product}`);
      return {
        tweets: [{ id: "s1", text: `about ${query}`, author: { username: "a", name: "A" } }],
        next_cursor: "c2",
      };
    },
  } as unknown as XToolsClient;
}

describe("X function tools", () => {
  test("advertises every tool once, in the declared order", () => {
    expect(xNativeTools.map((tool) => tool.function.name)).toEqual([...X_TOOL_NAMES]);
    expect(xSearchToolDef.function.parameters.required).toEqual(["query"]);
    expect(xTweetsToolDef.function.parameters.required).toEqual(["handle"]);
    expect(xWhoamiToolDef.function.parameters.properties).toEqual({});
    expect(isXToolName("x_news")).toBe(true);
    expect(isXToolName("web_search")).toBe(false);
  });

  test("builds a client from a cookie string or a session without network access", () => {
    expect(new XTools("auth_token=fake; ct0=fake")).toBeInstanceOf(XTools);
    expect(new XTools(XSession.fromCookieString("auth_token=fake; ct0=fake"))).toBeInstanceOf(
      XTools,
    );
  });

  test("maps each tool onto the injected X client", async () => {
    const calls: string[] = [];
    const tools = new XTools(mockClient(calls));

    const search = await tools.search({ query: "aphrody", count: 5 });
    expect(search).toEqual({
      tweets: [
        {
          id: "s1",
          text: "about aphrody",
          author: "a",
          created_at: undefined,
          like_count: undefined,
          retweet_count: undefined,
        },
      ],
      next_cursor: "c2",
    });
    await tools.profile({ handle: "@foo" });
    const tweets = await tools.tweets({ handle: "bar" });
    expect(tweets.user).toEqual({ id: "u1", screen_name: "bar", name: "Test" });
    expect(tweets.tweets[0]?.author).toBe("bar");
    const news = await tools.news({ count: 5 });
    expect(news.items[0]?.headline).toBe("Headline");
    await tools.whoami();

    expect(calls).toEqual([
      "search:aphrody:5:Latest",
      "userByScreenName:foo",
      "userByScreenName:bar",
      "userTweets:u1:20",
      "getNews:5",
      "whoami",
    ]);
  });

  test("execute dispatches by tool name and validates the model's arguments", async () => {
    const calls: string[] = [];
    const tools = new XTools(mockClient(calls));

    await tools.execute("x_search", { query: " rust ", mode: "Top" });
    await tools.execute("x_news", {});
    await tools.execute("x_whoami", undefined);
    expect(calls).toEqual(["search:rust:10:Top", "getNews:10", "whoami"]);

    await expect(tools.execute("x_search", { query: "" })).rejects.toThrow(
      'non-empty string "query"',
    );
    await expect(tools.execute("x_tweets", { handle: "a", count: 2.5 })).rejects.toThrow(
      "positive integer",
    );
    await expect(tools.execute("x_search", { query: "a", mode: "Hot" })).rejects.toThrow(
      '"Latest" or "Top"',
    );
    await expect(tools.execute("web_search", {})).rejects.toThrow("Unknown X tool: web_search");
    expect(xNewsToolDef.function.name).toBe("x_news");
  });
});

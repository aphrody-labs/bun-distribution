// SPDX-License-Identifier: Apache-2.0
/**
 * X capabilities exposed as OpenAI-compatible function tools.
 *
 * The definitions are plain JSON Schema, so any tool-calling model endpoint can request them;
 * {@link XTools} fulfils the calls with the native cookie-authenticated {@link XClient} (no X API
 * key). This module owns the X side of such agent loops; the model client that drives a loop
 * belongs to its caller (`@aphrody/xai` in aphrody-ai).
 */

import { XClient } from "../core/client";
import type { XSession } from "../core/session";

export interface XSearchToolArgs {
  query: string;
  count?: number;
  mode?: "Latest" | "Top";
}

export interface XProfileToolArgs {
  handle: string;
}

export interface XTweetsToolArgs {
  handle: string;
  count?: number;
}

export interface XNewsToolArgs {
  count?: number;
}

/** Names of the X function tools, in the order they are advertised to a model. */
export const X_TOOL_NAMES = ["x_search", "x_profile", "x_news", "x_tweets", "x_whoami"] as const;

export type XToolName = (typeof X_TOOL_NAMES)[number];

/** True when a model-requested tool name is one of the X tools. */
export function isXToolName(name: string): name is XToolName {
  return (X_TOOL_NAMES as readonly string[]).includes(name);
}

/** The {@link XClient} methods the tools call; callers and tests may inject their own. */
export type XToolsClient = Pick<
  XClient,
  "search" | "userByScreenName" | "userTweets" | "whoami" | "getNews"
>;

function stripAt(handle: string): string {
  return handle.replace(/^@/, "");
}

function requireString(args: Record<string, unknown>, key: string, tool: XToolName): string {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${tool} requires a non-empty string "${key}"`);
  }
  return value.trim();
}

function optionalCount(args: Record<string, unknown>, tool: XToolName): number | undefined {
  const value = args.count;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${tool} "count" must be a positive integer`);
  }
  return value;
}

/** Fulfils X function-tool calls with the native X client. */
export class XTools {
  private readonly x: XToolsClient;

  /**
   * @param source a ready client (anything implementing {@link XToolsClient}), an {@link XSession},
   *   a raw cookie string (`auth_token=...; ct0=...`), or nothing: the native client then
   *   discovers the credentials as `aphrody x` does (`X_COOKIE_STRING`, `~/.aphrody/x-session.json`,
   *   `X_AUTH_TOKEN` + `X_CT0`) when the first tool call runs.
   */
  constructor(source?: XToolsClient | XSession | string) {
    if (
      source &&
      typeof source === "object" &&
      typeof (source as Partial<XToolsClient>).search === "function"
    ) {
      this.x = source as XToolsClient;
    } else {
      this.x = new XClient(source as XSession | string | undefined);
    }
  }

  async search(args: XSearchToolArgs) {
    const page = await this.x.search(
      args.query,
      args.count ?? 10,
      undefined,
      args.mode ?? "Latest",
    );
    return {
      tweets: (page.tweets ?? []).map((t) => ({
        id: t.id,
        text: t.text,
        author: t.author?.username,
        created_at: t.created_at,
        like_count: t.like_count,
        retweet_count: t.retweet_count,
      })),
      next_cursor: page.next_cursor,
    };
  }

  async profile(args: XProfileToolArgs) {
    return this.x.userByScreenName(stripAt(args.handle));
  }

  /** The account the X session is logged in as. */
  async whoami() {
    return this.x.whoami();
  }

  async tweets(args: XTweetsToolArgs) {
    const user = await this.x.userByScreenName(stripAt(args.handle));
    const page = await this.x.userTweets(user.id, args.count ?? 20);
    return {
      user: { id: user.id, screen_name: user.screen_name, name: user.name },
      tweets: (page.tweets ?? []).map((t) => ({
        id: t.id,
        text: t.text,
        created_at: t.created_at,
        like_count: t.like_count,
        retweet_count: t.retweet_count,
        author: t.author?.username,
      })),
      next_cursor: page.next_cursor,
    };
  }

  /** Explore-tab news items (headline, category, post count, link). */
  async news(args: XNewsToolArgs = {}) {
    return { items: await this.x.getNews(args.count ?? 10) };
  }

  /**
   * Run the X tool a model requested, with its decoded JSON arguments. Throws on an unknown tool
   * name or on arguments that do not match the tool's schema.
   */
  async execute(name: string, args: unknown): Promise<unknown> {
    if (!isXToolName(name)) throw new Error(`Unknown X tool: ${name}`);
    const input = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    switch (name) {
      case "x_search": {
        const mode = input.mode;
        if (mode !== undefined && mode !== "Latest" && mode !== "Top") {
          throw new Error('x_search "mode" must be "Latest" or "Top"');
        }
        return this.search({
          query: requireString(input, "query", name),
          count: optionalCount(input, name),
          mode,
        });
      }
      case "x_profile":
        return this.profile({ handle: requireString(input, "handle", name) });
      case "x_tweets":
        return this.tweets({
          handle: requireString(input, "handle", name),
          count: optionalCount(input, name),
        });
      case "x_news":
        return this.news({ count: optionalCount(input, name) });
      case "x_whoami":
        return this.whoami();
    }
  }
}

export const xSearchToolDef = {
  type: "function" as const,
  function: {
    name: "x_search" as const,
    description:
      "Search the X (Twitter) Latest or Top timeline using the native Aphrody Web X client. Use for real-time posts, trends, user content.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "number", description: "Max results (default 10, max 50)" },
        mode: { type: "string", enum: ["Latest", "Top"], description: "Search mode" },
      },
      required: ["query"],
    },
  },
};

export const xProfileToolDef = {
  type: "function" as const,
  function: {
    name: "x_profile" as const,
    description: "Fetch public X profile info (followers, bio, etc) using native client.",
    parameters: {
      type: "object",
      properties: {
        handle: { type: "string", description: "@username or username" },
      },
      required: ["handle"],
    },
  },
};

export const xWhoamiToolDef = {
  type: "function" as const,
  function: {
    name: "x_whoami" as const,
    description:
      "Resolve the currently authenticated X/Twitter account (viewer) using the native Aphrody Web X session. No args.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const xTweetsToolDef = {
  type: "function" as const,
  function: {
    name: "x_tweets" as const,
    description:
      "Fetch recent tweets from a specific X user handle using native client (stealth, cookie, full archive access).",
    parameters: {
      type: "object",
      properties: {
        handle: { type: "string", description: "@username or username" },
        count: { type: "number", description: "Max tweets (default 20)" },
      },
      required: ["handle"],
    },
  },
};

export const xNewsToolDef = {
  type: "function" as const,
  function: {
    name: "x_news" as const,
    description:
      "Fetch trending news / Explore tab items from X using the native client (real-time, no keys).",
    parameters: {
      type: "object",
      properties: {
        count: { type: "number", description: "Max items (default 10)" },
      },
    },
  },
};

/** Every X tool definition, ready to pass as `tools` to an OpenAI-compatible chat request. */
export const xNativeTools = [
  xSearchToolDef,
  xProfileToolDef,
  xNewsToolDef,
  xTweetsToolDef,
  xWhoamiToolDef,
] as const;

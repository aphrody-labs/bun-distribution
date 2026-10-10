// SPDX-License-Identifier: Apache-2.0
//
// The X client of Bun scripts: a thin binding over the native client of aphrody-x
// (crates/web/x), reached in process through aphrody-ffi (`@aphrody/bun/x`). Requests, cookie
// rotation, queryId recovery, parsing, retry, rate-limit waiting and pacing are all Rust; this
// class names the operations and turns their envelopes into values and `XError`s.
//
// The native library is opened with the first call, never when the class is constructed, so
// building a client (or `XTools`) needs no native code.

import {
  xBatchSubmit,
  xClientClose,
  xClientOpen,
  xSubmit,
  type XBatchOpInput,
  type XBatchOptions,
  type XCallOptions,
  type XClientHandle,
  type XClientOptions,
  type XEnvelope,
  type XRetryPolicy,
} from "@aphrody/bun/x";
import { QueryIdStore } from "../config/query-ids";
import type { NewsItem, NewsOptions } from "../services/news";
import { XError, xErrorFromInfo } from "./error";
import { defined } from "./local";
import type { Tweet, TweetPage, UserPage } from "./parse";
import { XSession } from "./session";

export const API_BASE = "https://x.com/i/api";

export type { XClientOptions };

export interface RateLimit {
  limit: number;
  remaining: number;
  reset_epoch: number; // Unix epoch seconds
}

export interface TweetResult {
  id: string;
  text: string;
}

export interface UserInfo {
  id: string;
  name: string;
  screen_name: string;
  followers_count?: number;
  friends_count?: number;
}

export interface ListInfo {
  id: string;
  name: string;
  member_count?: number;
  subscriber_count?: number;
  mode?: string;
}

export interface TimelineTweet {
  id: string;
  text: string;
}

/** What the services read of a client's session. */
export interface XClientSession {
  handle?: string;
}

/** Options of one call (see `@aphrody/bun/x`): caller id, timeout, retry policy, abort signal. */
export type XClientCallOptions = XCallOptions;

/** What a client opens its session from. */
export type XClientSessionInput = XSession | string | null | undefined;

/** Options of `search` beyond the query: the `querySource` of the request (Radar uses `radar`). */
export interface XSearchOptions {
  querySource?: string;
}

/** A `Response`-like view of an authenticated raw request. */
export type XRawResponse = Response;

export class XClient {
  /** The session handle (screen name) when one is known; the credentials stay inside Rust. */
  public session: XClientSession;
  /** The rate-limit window seen by the latest call (the purge governors fold it into their pacing). */
  public lastRateLimit: RateLimit | null = null;

  private readonly source: XClientSessionInput;
  private readonly options: XClientOptions;
  private readonly retry: XRetryPolicy | undefined;
  private native: XClientHandle | null = null;

  /**
   * @param session an {@link XSession}, a cookie string (`auth_token=...; ct0=...`), or nothing: the
   *   credentials are then discovered by Rust as `aphrody x` does (`X_COOKIE_STRING`,
   *   `~/.aphrody/x-session.json`, `X_AUTH_TOKEN` + `X_CT0`) when the first call opens the client.
   * @param options native client options (`apiBase`, `timeoutMs`, `queryIdsPath`, ...) and the
   *   default retry policy of every call.
   */
  constructor(
    session?: XClientSessionInput,
    options: XClientOptions & { retry?: XRetryPolicy } = {},
  ) {
    const { retry, ...native } = options;
    this.source = session;
    this.options = native;
    this.retry = retry;
    this.session = { handle: session instanceof XSession ? session.handle : undefined };
  }

  // -------------------------------------------------------------------------
  // Native handle
  // -------------------------------------------------------------------------

  /** The native client handle, opening it (and so the native library) on first use. */
  public handle(): XClientHandle {
    if (!this.native) {
      const source = this.source;
      const wire =
        source instanceof XSession
          ? source.toWire()
          : typeof source === "string"
            ? { cookie_string: source }
            : null;
      this.native = xClientOpen(wire, this.options);
      if (this.native.handle) this.session = { handle: this.native.handle };
    }
    return this.native;
  }

  /** The numeric native handle, for `xBatch` and `@aphrody/bun/x`. */
  public get id(): number {
    return this.handle().client;
  }

  /** Release the native client. Calls still running finish; the next call opens a new one. */
  public close(): void {
    if (this.native) xClientClose(this.native.client);
    this.native = null;
  }

  /** The queryId cache of this client (native; refreshed from the live bundles on demand). */
  public get queryIds(): QueryIdStore {
    return new QueryIdStore(this);
  }

  // -------------------------------------------------------------------------
  // Generic calls
  // -------------------------------------------------------------------------

  /**
   * Run any native operation (see `meta`) and return its envelope: failures are data
   * (`ok: false`, with a `kind`), only an aborted `signal` rejects.
   */
  public async envelope<T = unknown>(
    op: string,
    args: Record<string, unknown> = {},
    options: XClientCallOptions = {},
  ): Promise<XEnvelope<T>> {
    const retry = options.retry ?? this.retry;
    const result = await xSubmit<T>(this.id, op, args, {
      ...options,
      ...(retry ? { retry } : {}),
    });
    if (result.rate_limit) this.lastRateLimit = result.rate_limit;
    return result;
  }

  /** Run any native operation and return its data, or throw its failure as an {@link XError}. */
  public async call<T = unknown>(
    op: string,
    args: Record<string, unknown> = {},
    options: XClientCallOptions = {},
  ): Promise<T> {
    const result = await this.envelope<T>(op, defined(args), options);
    if (!result.ok) throw xErrorFromInfo(result.error);
    return result.data;
  }

  /** Start a batch of operations on this client (`xBatch` wraps it as an async iterator). */
  public batchSubmit(ops: readonly XBatchOpInput[], options: XBatchOptions = {}) {
    return xBatchSubmit(this.id, ops, options);
  }

  // -------------------------------------------------------------------------
  // Raw access
  // -------------------------------------------------------------------------

  /** A GraphQL operation by name (queryId, features and 414/404 fallbacks are native). */
  public async graphql(opName: string, variables: unknown, extraFeatures?: unknown): Promise<any> {
    return this.call("graphql", {
      operation: opName,
      variables,
      features: extraFeatures,
    });
  }

  /** {@link graphql} that waits out an exhausted rate-limit window (at most `maxWaitMs`). */
  public async graphqlWaiting(
    opName: string,
    variables: unknown,
    extraFeatures?: unknown,
    maxWaitMs = 15 * 60 * 1000,
  ): Promise<any> {
    return this.call("graphql", {
      operation: opName,
      variables,
      features: extraFeatures,
      wait: true,
      max_wait_secs: Math.ceil(maxWaitMs / 1000),
    });
  }

  /**
   * An authenticated request to an X host (the session is never sent anywhere else). The native
   * answer is rebuilt as a `Response`.
   */
  public async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = Object.fromEntries(new Headers(init.headers ?? {}).entries());
    const method = (init.method ?? "GET").toUpperCase();
    const args: Record<string, unknown> = { method, url, headers };
    const body = init.body;
    if (body instanceof URLSearchParams) args.form = Object.fromEntries(body.entries());
    else if (typeof body === "string") {
      if ((headers["content-type"] ?? "").includes("application/x-www-form-urlencoded"))
        args.form = Object.fromEntries(new URLSearchParams(body).entries());
      else args.body = body;
    } else if (body !== undefined && body !== null) {
      throw new TypeError("XClient.request accepts string and URLSearchParams bodies only");
    }
    const answer = await this.call<{
      status: number;
      headers: Record<string, string>;
      body: string;
    }>("request", args);
    return new Response(answer.body, { status: answer.status, headers: answer.headers });
  }

  // -------------------------------------------------------------------------
  // Posts
  // -------------------------------------------------------------------------

  public createTweet(text: string, replyTo?: string): Promise<TweetResult> {
    return this.call("create_tweet", { text, reply_to: replyTo });
  }

  public createTweetWithMedia(
    text: string,
    replyTo?: string,
    mediaIds: string[] = [],
  ): Promise<TweetResult> {
    return this.call("create_tweet", { text, reply_to: replyTo, media_ids: mediaIds });
  }

  public createTweetRest(text: string, replyTo?: string): Promise<TweetResult> {
    return this.call("create_tweet_rest", { text, reply_to: replyTo });
  }

  public noteTweet(tweetText: string | null, noteText: string): Promise<TweetResult> {
    return this.call("note_tweet", { tweet_text: tweetText ?? undefined, note_text: noteText });
  }

  public async deleteTweet(id: string): Promise<void> {
    await this.call("delete_tweet", { id });
  }
  public async like(tweetId: string): Promise<void> {
    await this.call("like", { id: tweetId });
  }
  public async unlike(tweetId: string): Promise<void> {
    await this.call("unlike", { id: tweetId });
  }
  public async retweet(tweetId: string): Promise<void> {
    await this.call("retweet", { id: tweetId });
  }
  public async unretweet(tweetId: string): Promise<void> {
    await this.call("unretweet", { id: tweetId });
  }
  public async bookmark(tweetId: string): Promise<void> {
    await this.call("bookmark", { id: tweetId });
  }
  public async unbookmark(tweetId: string): Promise<void> {
    await this.call("unbookmark", { id: tweetId });
  }
  public async pinTweet(tweetId: string): Promise<void> {
    await this.call("pin_tweet", { id: tweetId });
  }
  public async unpinTweet(tweetId: string): Promise<void> {
    await this.call("unpin_tweet", { id: tweetId });
  }

  // -------------------------------------------------------------------------
  // Graph and messages
  // -------------------------------------------------------------------------

  public async follow(userId: string): Promise<void> {
    await this.call("follow", { user_id: userId });
  }
  public async unfollow(userId: string): Promise<void> {
    await this.call("unfollow", { user_id: userId });
  }
  public async block(userId: string): Promise<void> {
    await this.call("block", { user_id: userId });
  }
  public async unblock(userId: string): Promise<void> {
    await this.call("unblock", { user_id: userId });
  }
  public async mute(userId: string): Promise<void> {
    await this.call("mute", { user_id: userId });
  }
  public async unmute(userId: string): Promise<void> {
    await this.call("unmute", { user_id: userId });
  }
  public async sendDm(recipientId: string, text: string): Promise<void> {
    await this.call("send_dm", { recipient_id: recipientId, text });
  }

  // -------------------------------------------------------------------------
  // Identity and reads
  // -------------------------------------------------------------------------

  public userByScreenName(handle: string): Promise<UserInfo> {
    return this.call("user_by_screen_name", { handle });
  }

  public async userIdFor(handle: string): Promise<string> {
    const answer = await this.call<{ id: string }>("user_id_for", { handle });
    if (!answer.id) throw new XError(`Could not resolve user id for @${handle}`, -1);
    return answer.id;
  }

  public whoami(): Promise<UserInfo> {
    return this.call("whoami");
  }

  public homeTimeline(count: number): Promise<TimelineTweet[]> {
    return this.call("home_timeline", { count });
  }

  public timelineTweets(op: string, variables: unknown, quoteDepth?: number): Promise<TweetPage> {
    return this.call("timeline_tweets", { operation: op, variables, quote_depth: quoteDepth });
  }

  public timelineUsers(op: string, variables: unknown): Promise<UserPage> {
    return this.call("timeline_users", { operation: op, variables });
  }

  public getTweet(tweetId: string, quoteDepth?: number): Promise<Tweet | null> {
    return this.call("get_tweet", { id: tweetId, quote_depth: quoteDepth });
  }

  public thread(tweetId: string, cursor?: string, quoteDepth?: number): Promise<TweetPage> {
    return this.call("thread", { id: tweetId, cursor, quote_depth: quoteDepth });
  }

  public tweetDetailRaw(tweetId: string, cursor?: string): Promise<any> {
    return this.call("tweet_detail_raw", { id: tweetId, cursor });
  }

  public search(
    query: string,
    count: number,
    cursor?: string,
    product = "Latest",
    quoteDepth?: number,
    options: XSearchOptions = {},
  ): Promise<TweetPage> {
    return this.call("search", {
      query,
      count,
      cursor,
      product,
      quote_depth: quoteDepth,
      query_source: options.querySource,
    });
  }

  public userTweets(
    userId: string,
    count: number,
    cursor?: string,
    quoteDepth?: number,
  ): Promise<TweetPage> {
    return this.call("user_tweets", { user_id: userId, count, cursor, quote_depth: quoteDepth });
  }

  /** A user's timeline **including replies** (`userTweets` omits them). */
  public userTweetsAndReplies(
    userId: string,
    count: number,
    cursor?: string,
    quoteDepth?: number,
  ): Promise<TweetPage> {
    return this.call("user_tweets_and_replies", {
      user_id: userId,
      count,
      cursor,
      quote_depth: quoteDepth,
    });
  }

  /** A user's media tab (posts carrying photos, videos and GIFs). */
  public userMedia(
    userId: string,
    count: number,
    cursor?: string,
    quoteDepth?: number,
  ): Promise<TweetPage> {
    return this.call("user_media", { user_id: userId, count, cursor, quote_depth: quoteDepth });
  }

  public home(
    count: number,
    cursor?: string,
    latest = false,
    quoteDepth?: number,
  ): Promise<TweetPage> {
    return this.call("home", { count, cursor, latest, quote_depth: quoteDepth });
  }

  public likes(
    userId: string,
    count: number,
    cursor?: string,
    quoteDepth?: number,
  ): Promise<TweetPage> {
    return this.call("likes", { user_id: userId, count, cursor, quote_depth: quoteDepth });
  }

  public bookmarks(count: number, cursor?: string, quoteDepth?: number): Promise<TweetPage> {
    return this.call("bookmarks", { count, cursor, quote_depth: quoteDepth });
  }

  public following(userId: string, count: number, cursor?: string): Promise<UserPage> {
    return this.call("following", { user_id: userId, count, cursor });
  }

  public followers(userId: string, count: number, cursor?: string): Promise<UserPage> {
    return this.call("followers", { user_id: userId, count, cursor });
  }

  public listTimeline(
    listId: string,
    count: number,
    cursor?: string,
    quoteDepth?: number,
  ): Promise<TweetPage> {
    return this.call("list_timeline", { list: listId, count, cursor, quote_depth: quoteDepth });
  }

  public lists(userId: string, memberOf: boolean, count: number): Promise<ListInfo[]> {
    return this.call("lists", { user_id: userId, member_of: memberOf, count });
  }

  /** Community metadata by rest id (the number of `/i/communities/ID`). */
  public communityByRestId(communityId: string): Promise<any> {
    return this.call("community_by_rest_id", { community: communityId });
  }

  public communityTimeline(
    communityId: string,
    count: number,
    cursor?: string,
    quoteDepth?: number,
  ): Promise<TweetPage> {
    return this.call("community_timeline", {
      community: communityId,
      count,
      cursor,
      quote_depth: quoteDepth,
    });
  }

  /** Community metadata and the first page of its timeline. */
  public communityInfoAndTimeline(
    communityId: string,
    count = 20,
    quoteDepth = 0,
  ): Promise<{ info: any; tweets: TweetPage }> {
    return this.call("community_info_and_timeline", {
      community: communityId,
      count,
      quote_depth: quoteDepth,
    });
  }

  public async uploadMedia(filePath: string, alt?: string): Promise<string> {
    const answer = await this.call<{ media_id: string }>("upload_media", { path: filePath, alt });
    return answer.media_id;
  }

  public getNews(count: number, options: NewsOptions = {}): Promise<NewsItem[]> {
    return this.call("get_news", { count, tabs: options.tabs, ai_only: options.ai_only });
  }
}

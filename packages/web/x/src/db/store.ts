// SPDX-License-Identifier: Apache-2.0
//
// The local SQLite store of tweets, users, edges and the follow graph. The schema, the SQL and the
// full-text index are aphrody-x (crates/web/x/src/store.rs, same file `~/.aphrody/x-store.sqlite`
// as `aphrody x db`); a store lives inside the native library and this class holds its handle.
// Read-only SQL of your own goes through {@link Store.query}.

import { homedir } from "node:os";
import { join } from "node:path";
import { local } from "../core/local";
import type { Tweet, User } from "../core/parse";

export const edge = {
  AUTHORED: "authored",
  LIKED: "liked",
  BOOKMARKED: "bookmarked",
  TIMELINE: "timeline",
  MENTION: "mention",
} as const;

export interface StoredTweet {
  id: string;
  author_username: string;
  author_name: string;
  text: string;
  created_at?: string;
  like_count: number;
}

export interface Stats {
  path: string;
  tweets: number;
  users: number;
  edges: number;
  follows: number;
  by_kind: [string, number][];
}

export interface Digest {
  top_authors: [string, number][];
  top_tweets: StoredTweet[];
}

/** Rows written in one transaction by {@link Store.ingest}. */
export interface IngestBatch {
  users?: User[];
  tweets?: Tweet[];
  edges?: { account: string; kind: string; tweet_id: string }[];
  follows?: { account: string; direction: "following" | "follower"; user: User }[];
}

export class Store {
  /** The native store handle. */
  public readonly handle: number;
  /** The database file (`:memory:` for a private database). */
  public readonly path: string;
  private closed = false;

  /** Open (creating if needed) the store at `path`; default `~/.aphrody/x-store.sqlite`. */
  constructor(path?: string) {
    const opened = local<{ store: number; path: string }>("store_open", path ? { path } : {});
    this.handle = opened.store;
    this.path = opened.path;
  }

  public static defaultPath(): string {
    return join(homedir() || ".", ".aphrody", "x-store.sqlite");
  }

  private run<T>(op: string, args: Record<string, unknown> = {}): T {
    if (this.closed) throw new Error("the X store is closed");
    return local<T>(op, { store: this.handle, ...args });
  }

  public upsertTweet(tweet: Tweet): void {
    this.run("store_upsert_tweet", { tweet });
  }

  public addEdge(account: string, kind: string, tweetId: string): void {
    this.run("store_add_edge", { account, kind, tweet_id: tweetId });
  }

  public upsertUser(user: User): void {
    this.run("store_upsert_user", { user });
  }

  public addFollow(account: string, direction: string, user: User): void {
    this.run("store_add_follow", { account, direction, user });
  }

  /** Write many rows in one transaction (rolled back as a whole when one fails). */
  public ingest(batch: IngestBatch): {
    users: number;
    tweets: number;
    edges: number;
    follows: number;
  } {
    return this.run("store_ingest", { ...batch });
  }

  /** Upsert every user found anywhere under a `user_results.result` key of a response. */
  public ingestUsers(json: unknown): number {
    return this.run<{ users: number }>("store_ingest_users", { json }).users;
  }

  public search(query: string, limit: number): StoredTweet[] {
    return this.run("store_search", { query, limit });
  }

  public stats(): Stats {
    return this.run("store_stats", { path: this.path });
  }

  public exportTweets(): any[] {
    return this.run("store_export");
  }

  public digest(top: number): Digest {
    return this.run("store_digest", { top });
  }

  public mutuals(account: string): string[] {
    return this.run("store_mutuals", { account });
  }

  public nonMutualFollowing(account: string): string[] {
    return this.run("store_non_mutual", { account });
  }

  public knownUsernames(): string[] {
    return this.run("store_known_usernames");
  }

  public knownCommunities(): string[] {
    return this.run("store_known_communities");
  }

  /** Read-only SQL (`SELECT`, `WITH`, `VALUES`, `EXPLAIN`) with `?` / `?N` parameters. */
  public query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
    limit = 1000,
  ): T[] {
    return this.run("store_query", { sql, params, limit });
  }

  /** Import a Twitter archive (`tweets.js`) for `owner`; returns how many tweets were imported. */
  public importArchive(path: string, owner: string): number {
    return this.run<{ imported: number }>("import_archive", { path, owner }).imported;
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    local("store_close", { store: this.handle });
  }
}

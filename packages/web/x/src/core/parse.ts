// SPDX-License-Identifier: Apache-2.0
//
// Parsing of X timeline trees. The parser is the one of aphrody-x (crates/web/x/src/parse.rs),
// reached through the native pure operations `parse_*`; nothing is re-implemented here. Each call
// opens the native library on first use (never on import).

import { defined, local } from "./local";
import type { Tweet, User } from "./schemas";

export { type Author, type Media, type Tweet, type User } from "./schemas";
export { XError, checkApiErrors } from "./error";

export interface TweetPage {
  tweets: Tweet[];
  next_cursor?: string;
}

export interface UserPage {
  users: User[];
  next_cursor?: string;
}

/** Walk a timeline response and extract all tweets and the bottom cursor. */
export function walkTimelineTweets(root: unknown, quoteDepth?: number): TweetPage {
  return local<TweetPage>(
    "parse_timeline_tweets",
    defined({ json: root, quote_depth: quoteDepth }),
  );
}

/** Walk a user list timeline and extract all users and the bottom cursor. */
export function walkTimelineUsers(root: unknown): UserPage {
  return local<UserPage>("parse_timeline_users", { json: root });
}

/** Parse a `tweet_results.result` node into a Tweet. */
export function parseTweetResult(result: unknown, quoteDepth?: number): Tweet | null {
  return local<Tweet | null>(
    "parse_tweet_result",
    defined({ json: result, quote_depth: quoteDepth }),
  );
}

/** Parse a `user_results.result` node into a User. */
export function parseUserResult(result: unknown): User | null {
  return local<User | null>("parse_user_result", { json: result });
}

/** Find a single tweet by its id in a response tree. */
export function parseSingleTweet(root: unknown, tweetId: string): Tweet | null {
  return local<Tweet | null>("parse_single_tweet", { json: root, id: tweetId });
}

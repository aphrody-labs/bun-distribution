// SPDX-License-Identifier: Apache-2.0
// X ranking is implemented once in aphrody-x (module algorithm) and exposed by aphrody-ffi.
import { webXAlgorithmRank } from "@aphrody/bun/web";

export interface PostCandidate {
  id: string;
  author_id: string;
  author_handle?: string;
  text: string;
  created_at: number; // unix seconds
  like_count: number;
  reply_count: number;
  repost_count: number;
  quote_count: number;
  is_reply?: boolean;
  is_repost?: boolean;
  has_media?: boolean;
  in_network?: boolean;
}

export interface RankingContext {
  viewer_id?: string;
  followed_author_ids?: string[];
  recent_engagement_author_ids?: string[];
  muted_keywords?: string[];
  blocked_author_ids?: string[];
  now_unix?: number;
  max_age_secs?: number;
}

export interface ScoredPost {
  post: PostCandidate;
  score: number;
  reasons: string[];
}

/** Rank posts in the shared Rust implementation while preserving caller post shapes. */
export function rankPosts(
  candidates: PostCandidate[],
  context: RankingContext = {},
  topK = 20,
): ScoredPost[] {
  if (!candidates?.length) return [];
  const ranked = webXAlgorithmRank(candidates, { ...context }, topK);
  if (!Array.isArray(ranked)) {
    const error =
      ranked && typeof ranked === "object" && "error" in ranked
        ? String(ranked.error)
        : "invalid native ranking response";
    throw new Error(`X ranking failed: ${error}`);
  }

  const originals = new Map<string, PostCandidate>();
  for (const post of candidates) {
    if (!originals.has(post.id)) originals.set(post.id, post);
  }
  return (ranked as ScoredPost[]).map((scored) => {
    scored.post = originals.get(scored.post.id) ?? scored.post;
    return scored;
  });
}

export async function rankPostsNative(
  candidates: PostCandidate[],
  context: RankingContext = {},
  topK = 20,
): Promise<ScoredPost[]> {
  return rankPosts(candidates, context, topK);
}

import type { Tweet } from "./core/parse";

/**
 * Convert a raw X post object or a typed `Tweet` (from this package's parser)
 * into a `PostCandidate` for the local X For You ranking algorithm.
 *
 * This is the TS equivalent of `tweet_to_algo_candidate` in the Rust x-client.
 */
export function toPostCandidate(raw: any): PostCandidate | null {
  if (!raw || !raw.id) return null;

  // If it's already a typed Tweet from the package, use the dedicated converter
  if (raw.author && typeof raw.author === "object" && "username" in raw.author) {
    return tweetToPostCandidate(raw as Tweet);
  }

  const author = raw.author || raw.user || {};
  const metrics = raw.public_metrics || raw.metrics || raw.legacy || {};
  return {
    id: String(raw.id),
    author_id: String(author.id || raw.author_id || raw.user_id || ""),
    author_handle: author.username || author.handle || raw.username,
    text: raw.text || raw.full_text || raw.legacy?.full_text || "",
    created_at: raw.created_at
      ? Math.floor(new Date(raw.created_at).getTime() / 1000)
      : raw.timestamp
        ? Math.floor(raw.timestamp / 1000)
        : 0,
    like_count: Number(metrics.like_count ?? metrics.favorite_count ?? 0),
    reply_count: Number(metrics.reply_count ?? 0),
    repost_count: Number(metrics.repost_count ?? metrics.retweet_count ?? 0),
    quote_count: Number(metrics.quote_count ?? 0),
    is_reply: !!raw.is_reply || !!raw.in_reply_to_status_id,
    is_repost: !!raw.is_repost || !!raw.retweeted_status,
    has_media: !!(raw.media || raw.extended_entities || raw.entities?.media),
    in_network: raw.in_network,
  };
}

/**
 * Convert a typed `Tweet` (from @aphrody/x parser / XClient results) into
 * a `PostCandidate` for ranking.
 *
 * `inNetwork` should be true for posts from followed accounts (HomeTimeline etc.).
 * Mirrors the Rust integration in rust-bridge/crates/x-client.
 */
export function tweetToPostCandidate(tweet: Tweet, inNetwork = false): PostCandidate {
  let createdAt = 0;
  if (tweet.created_at) {
    const d = new Date(tweet.created_at);
    if (!isNaN(d.getTime())) {
      createdAt = Math.floor(d.getTime() / 1000);
    }
  }

  return {
    id: tweet.id,
    author_id: tweet.author_id || "",
    author_handle: tweet.author?.username,
    text: tweet.text || "",
    created_at: createdAt,
    like_count: tweet.like_count ?? 0,
    reply_count: tweet.reply_count ?? 0,
    repost_count: tweet.retweet_count ?? 0,
    quote_count: tweet.quote_count ?? 0,
    is_reply: !!tweet.in_reply_to_status_id,
    is_repost: !!tweet.quoted_tweet,
    has_media: !!(tweet as any).media && (tweet as any).media.length > 0,
    in_network: inNetwork,
  };
}

/**
 * Rank a list of typed `Tweet`s (from XClient.search, userTweets, etc.)
 * using the local X For You style algorithm.
 *
 * This is the high-level TS equivalent of `rank_tweets` in the Rust x-client.
 * Returns scored posts with explainable reasons.
 */
export function rankTweets(tweets: Tweet[], context: RankingContext = {}, topK = 20): ScoredPost[] {
  const candidates = tweets
    .map((t) => tweetToPostCandidate(t, false))
    .filter((c): c is PostCandidate => c !== null);
  return rankPosts(candidates, context, topK);
}

export async function rankTweetsNative(
  tweets: Tweet[],
  context: RankingContext = {},
  topK = 20,
): Promise<ScoredPost[]> {
  return rankPostsNative(
    tweets.map((tweet) => tweetToPostCandidate(tweet, false)),
    context,
    topK,
  );
}

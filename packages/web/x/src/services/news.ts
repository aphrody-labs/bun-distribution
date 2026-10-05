// SPDX-License-Identifier: Apache-2.0
//
// X Explore news. Parsing and fetching are aphrody-x (crates/web/x/src/news.rs); this file keeps
// the public names and types over the native operations.

import type { XClient } from "../core/client";
import { defined, local } from "../core/local";

export interface NewsOptions {
  tabs?: string[];
  ai_only?: boolean;
}

export interface NewsItem {
  id: string;
  headline: string;
  category: string;
  time_ago?: string;
  post_count?: number;
  description?: string;
  url?: string;
}

/** Parse a K/M/B-suffixed post count like "12.3K posts" or "5M posts". */
export function parsePostCount(text: string): number | null {
  return local<number | null>("parse_post_count", { text });
}

/** Parse one itemContent node into a NewsItem, applying the AI filter. */
export function parseNewsItem(
  itemContent: unknown,
  entryId: string,
  source: string,
  aiOnly: boolean,
): NewsItem | null {
  return local<NewsItem | null>("parse_news_item", {
    item_content: itemContent,
    entry_id: entryId,
    source,
    ai_only: aiOnly,
  });
}

/** Parse all news items from a GenericTimelineById response. */
export function parseTabItems(
  data: unknown,
  source: string,
  maxCount: number,
  aiOnly: boolean,
): NewsItem[] {
  return local<NewsItem[]>("parse_tab_items", {
    json: data,
    source,
    max_count: maxCount,
    ai_only: aiOnly,
  });
}

/** Fetch news / trending items from the requested Explore tabs. */
export function getNews(
  client: XClient,
  count: number,
  options: NewsOptions = {},
): Promise<NewsItem[]> {
  return client.call("get_news", defined({ count, tabs: options.tabs, ai_only: options.ai_only }));
}

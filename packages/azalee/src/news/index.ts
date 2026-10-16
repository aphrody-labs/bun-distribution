/**
 * @file news/index.ts
 * @description Editorial, articles, changelogs and RSS feed models for Rose Griffon.
 * Dedicated non-IEVR module tailored for `@rosegriffon/website` and editorial pipelines.
 */

export type ArticleStatus = "draft" | "published" | "archived";

export interface ArticleAuthor {
  id: string;
  name: string;
  avatarUrl?: string;
  role?: string;
  socials?: {
    twitter?: string;
    discord?: string;
    github?: string;
  };
}

export interface NewsTag {
  id: string;
  name: string;
  slug: string;
  color?: string;
}

export interface TagCloudItem extends NewsTag {
  count: number;
}

export type NewsCategory =
  | "announcement"
  | "game-update"
  | "guide"
  | "community"
  | "tournament"
  | "patch-notes"
  | "dev-blog";

export interface Article {
  id: string;
  slug: string;
  title: string;
  summary: string;
  content: string; // Markdown or HTML
  category: NewsCategory;
  tags: string[];
  author: ArticleAuthor;
  featuredImageUrl?: string;
  status: ArticleStatus;
  publishedAt: string; // ISO 8601
  updatedAt?: string;
  readingTimeMinutes: number;
  featured?: boolean;
  pinned?: boolean;
}

export interface TrendingArticle {
  article: Article;
  views: number;
  trendingRank: number;
}

export interface NewsPost {
  id: string;
  title: string;
  snippet: string;
  category: NewsCategory;
  url: string;
  publishedAt: string;
  authorName: string;
  badge?: string;
}

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid?: string;
  author?: string;
  category?: string;
  enclosureUrl?: string;
}

export interface FeedChannel {
  title: string;
  link: string;
  description: string;
  language?: string;
  lastBuildDate?: string;
  generator?: string;
}

export interface FeedFilter {
  category?: NewsCategory;
  tag?: string;
  status?: ArticleStatus;
  limit?: number;
  offset?: number;
  searchQuery?: string;
}

/** Compute estimated reading time in minutes based on 200 words per minute */
export function calculateReadTime(content: string): number {
  if (!content) return 1;
  const wordCount = content.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(wordCount / 200));
}

/** Standard slugifier for news and article headlines */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Extract a clean text summary from markdown or html content */
export function extractSummary(content: string, maxLength = 160): string {
  if (!content) return "";
  const cleaned = content
    .replace(/<[^>]*>/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[#*`_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.slice(0, maxLength - 1).trim() + "…";
}

/** Filter and paginate feed items */
export function filterFeed(items: Article[], filter: FeedFilter = {}): Article[] {
  let result = [...items];

  if (filter.status) {
    result = result.filter((a) => a.status === filter.status);
  } else {
    // Default to published only
    result = result.filter((a) => a.status === "published");
  }

  if (filter.category) {
    result = result.filter((a) => a.category === filter.category);
  }

  if (filter.tag) {
    const t = filter.tag.toLowerCase();
    result = result.filter((a) => a.tags.some((tag) => tag.toLowerCase() === t));
  }

  if (filter.searchQuery) {
    const q = filter.searchQuery.toLowerCase();
    result = result.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }

  result.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  const offset = filter.offset ?? 0;
  const limit = filter.limit ?? 20;
  return result.slice(offset, offset + limit);
}

/** Generate standard RSS 2.0 XML from channel metadata and items */
export function generateRssFeed(channel: FeedChannel, items: FeedItem[]): string {
  const itemsXml = items
    .map(
      (item) => `    <item>
      <title><![CDATA[${item.title}]]></title>
      <link>${item.link}</link>
      <guid isPermaLink="${item.guid ? "false" : "true"}">${item.guid ?? item.link}</guid>
      <description><![CDATA[${item.description}]]></description>
      <pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>
      ${item.author ? `<author>${item.author}</author>` : ""}
      ${item.category ? `<category>${item.category}</category>` : ""}
    </item>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title><![CDATA[${channel.title}]]></title>
    <link>${channel.link}</link>
    <description><![CDATA[${channel.description}]]></description>
    <language>${channel.language ?? "fr-FR"}</language>
    <lastBuildDate>${channel.lastBuildDate ?? new Date().toUTCString()}</lastBuildDate>
    <generator>${channel.generator ?? "Rose Griffon Editorial Engine"}</generator>
${itemsXml}
  </channel>
</rss>`;
}

/* eslint-disable no-console */
import * as cheerio from "cheerio";

// --- Types ---

export interface TopicSummary {
  id: string;
  title: string;
  date: string;
  url: string;
  category?: string;
  thumbnail?: string | null;
}

export interface TopicDetail extends TopicSummary {
  content_html: string;
  images?: string[];
}

// --- Config ---

const BASE_URL = "https://www.inazuma.jp/victory-road/fr/topics";
const HOME_URL = "https://www.inazuma.jp/victory-road/fr/";

// --- Scraper ---

export async function scrapeTopicList(): Promise<TopicSummary[]> {
  console.log(`[Scraper] Fetching topics list from: ${BASE_URL}/ and ${HOME_URL}`);

  try {
    const topics: TopicSummary[] = [];

    // helper function to avoid duplicates and push
    const addTopic = (topic: TopicSummary) => {
      if (
        !topic.id ||
        topics.find((t) => t.id === topic.id) ||
        topic.id === "fr" ||
        topic.id === "topics"
      )
        return;
      topics.push(topic);
    };

    // 1. Scrape the home page for most recent topics (often more up to date)
    const homeRes = await fetch(HOME_URL);
    if (homeRes.ok) {
      const homeHtml = await homeRes.text();
      const $home = cheerio.load(homeHtml);
      $home(".slideTopics .swiper-slide").each((_, el) => {
        const link = $home(el).find("a");
        const href = link.attr("href") || "";
        const dt = $home(el).find("dt").text().trim();
        const title = $home(el).find("dd").text().trim();
        const img = $home(el).find("img").first();

        if (!href || !title) return;

        const absoluteUrl = href.startsWith("http") ? href : new URL(href, HOME_URL).toString();

        const id = absoluteUrl.split("/").filter(Boolean).pop() || "";

        let thumbnail: string | null = null;
        if (img.length) {
          const src = img.attr("src");
          if (src) {
            thumbnail = src.startsWith("http") ? src : new URL(src, HOME_URL).toString();
          }
        }

        addTopic({
          id,
          title,
          date: dt,
          url: absoluteUrl,
          category: "General",
          thumbnail,
        });
      });
    }

    // 2. Scrape the main topics index
    const res = await fetch(`${BASE_URL}/`);
    if (!res.ok) throw new Error(`Failed to fetch list: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Try the official list structure first
    if ($("ul.list li").length > 0) {
      $("ul.list li").each((_, el) => {
        const dt = $(el).find("dt").text().trim();
        const dd = $(el).find("dd");
        const link = dd.find("a");
        const href = link.attr("href") || "";
        const title = link.text().trim();

        if (!href || !title) return;

        const absoluteUrl = href.startsWith("http")
          ? href
          : new URL(href, `${BASE_URL}/`).toString();

        const id = absoluteUrl.split("/").filter(Boolean).pop() || "";

        // Date format YYYY.MM.DD
        let date = dt;
        if (!date && /^\d{6}/.test(id)) {
          const y = id.substring(0, 2);
          const m = id.substring(2, 4);
          const d = id.substring(4, 6);
          date = `20${y}.${m}.${d}`;
        }

        addTopic({
          id,
          title,
          date,
          url: absoluteUrl,
          category: "General",
          thumbnail: null,
        });
      });
    }

    // Fallback to searching all links (original method)
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      if (href.includes("/topics/") && !href.endsWith("/topics/")) {
        const absoluteUrl = href.startsWith("http") ? href : `https://www.inazuma.jp${href}`;
        const id = absoluteUrl.split("/").filter(Boolean).pop() || "";

        const fullText = $(el).text().trim();
        const dateMatch = fullText.match(/(\d{4}\.\d{1,2}\.\d{1,2})/);
        let date = dateMatch ? dateMatch[0] : "";

        if (!date && /^\d{6}/.test(id)) {
          const y = id.substring(0, 2);
          const m = id.substring(2, 4);
          const d = id.substring(4, 6);
          date = `20${y}.${m}.${d}`;
        }

        let title = fullText.replace(date, "").replace("NEW", "").trim();

        if (!title && $(el).find(".text, .title, dd").length) {
          title = $(el).find(".text, .title, dd").text().trim();
        }

        if (!title) title = "Topic Inazuma Eleven";

        // FILTER: Exclude Patch Notes, Bugs, and Technical Updates
        const lowerTitle = title.toLowerCase();
        const lowerUrl = absoluteUrl.toLowerCase();
        if (
          lowerTitle.includes("patch note") ||
          lowerTitle.includes("ver.") ||
          lowerTitle.includes("bug") ||
          lowerTitle.includes("issue") ||
          lowerTitle.includes("apology") ||
          lowerTitle.includes("notice regarding") ||
          lowerUrl.includes("patch") ||
          lowerUrl.includes("update")
        ) {
          return;
        }

        let thumbnail: string | null = null;
        const img = $(el).find("img").first();
        if (img.length) {
          const src = img.attr("src");
          if (src) {
            if (src.startsWith("http")) {
              thumbnail = src;
            } else {
              thumbnail = `https://www.inazuma.jp${src}`;
            }
          }
        }

        addTopic({
          id,
          title,
          date,
          url: absoluteUrl,
          category: "General",
          thumbnail,
        });
      }
    });

    topics.sort((a, b) => b.date.localeCompare(a.date));

    return topics;
  } catch (error) {
    console.error("[Scraper] Error parsing topic list:", error);
    return [];
  }
}

export async function scrapeTopicDetail(url: string): Promise<{
  content: string;
  thumbnail: string | null;
  images: string[];
} | null> {
  console.log(`[Scraper] Fetching topic detail from: ${url}`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch detail: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Prioritize .contentArea, then fallback to others
    let $content = $(".contentArea");
    if (!$content.length) $content = $("main");
    if (!$content.length) $content = $("article");
    if (!$content.length) $content = $(".content");
    if (!$content.length) $content = $("body");

    // Remove unwanted elements
    const elementsToRemove = [
      "header",
      "footer",
      "nav",
      "script",
      "style",
      ".cookie-banner",
      ".header",
      ".footer",
      ".breadcrumb",
      "#navAreaH",
      "#navAreaF",
      ".btnMenu",
      ".logo",
      ".gnav",
      ".topicsTit", // Big "ACTUALITES" title with image
      ".innerB", // Footer inner content
      ".productBox", // Footer product info
      ".bnrBox", // Banners
      ".link", // Footer links
      ".subLink",
      ".bnrLink",
      ".notes",
      ".copyRight",
      "#store", // Store modal
      ".updateBtn",
      ".guideLink",
      ".btnClose",
      ".slideLine",
      ".rBox", // Header right box (socials/lang)
      ".logoIn", // Inner logo in nav
    ];

    $content.find(elementsToRemove.join(", ")).remove();

    // Also remove any duplicate H1s that might be logos
    $content.find("h1 img").closest("h1").remove();

    // Fix relative URLs in content
    // If url ends in .html, new URL(rel, url) works correctly (resolves to sibling).
    // If url is a directory without slash, we must append slash.
    let baseUrl = url;
    if (!baseUrl.endsWith("/") && !baseUrl.match(/\.[a-zA-Z0-9]+$/)) {
      baseUrl += "/";
    }

    const images: string[] = [];

    $content.find("img").each((_, el) => {
      const src = $(el).attr("src");
      if (src && !src.startsWith("http")) {
        let absoluteSrc = src;
        if (src.startsWith("/")) {
          absoluteSrc = `https://www.inazuma.jp${src}`;
        } else {
          try {
            absoluteSrc = new URL(src, baseUrl).toString();
          } catch {
            /* ignore */
          }
        }
        $(el).attr("src", absoluteSrc);
        images.push(absoluteSrc);
      } else if (src) {
        images.push(src);
      }
    });

    let thumbnail = null;
    if (images.length > 0) {
      thumbnail = images[0];
    }

    return {
      content: $content.html() || "",
      thumbnail: (thumbnail as string | null) || null,
      images,
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

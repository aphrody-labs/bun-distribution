import { describe, expect, test } from "bun:test";
import {
  calculateReadTime,
  extractSummary,
  filterFeed,
  generateRssFeed,
  slugifyTitle,
  type Article,
} from "../src/news/index.js";
import {
  buildNotificationWebhook,
  createBotEmbed,
  EMBED_COLORS,
  formatDiscordTimestamp,
  type BotNotification,
} from "../src/bot/index.js";
import { FORMATIONS, encodeTeamCode, decodeTeamCode, translateEffect, GAIJI, news, bot } from "../src/index.js";

describe("Azalée News Module", () => {
  test("calculates reading time accurately", () => {
    const shortText = "Hello world";
    expect(calculateReadTime(shortText)).toBe(1);

    const longText = Array(450).fill("word").join(" ");
    expect(calculateReadTime(longText)).toBe(3);
  });

  test("slugifies titles cleanly", () => {
    expect(slugifyTitle("Mise à jour 1.2.0: Nouvelles Formations!")).toBe("mise-a-jour-1-2-0-nouvelles-formations");
  });

  test("extracts text summary without markdown symbols", () => {
    const md = "## Title\nThis is **bold** text with [links](https://example.com).";
    const summary = extractSummary(md);
    expect(summary).toBe("Title This is bold text with links.");
  });

  test("filters articles feed", () => {
    const articles: Article[] = [
      {
        id: "1",
        slug: "post-1",
        title: "Changelog 1.0",
        summary: "Summary 1",
        content: "Content 1",
        category: "patch-notes",
        tags: ["v1", "release"],
        author: { id: "a1", name: "Admin" },
        status: "published",
        publishedAt: "2026-09-01T10:00:00Z",
        readingTimeMinutes: 1,
      },
      {
        id: "2",
        slug: "post-2",
        title: "Draft Guide",
        summary: "Summary 2",
        content: "Content 2",
        category: "guide",
        tags: ["guide"],
        author: { id: "a1", name: "Admin" },
        status: "draft",
        publishedAt: "2026-09-02T10:00:00Z",
        readingTimeMinutes: 2,
      },
    ];

    const published = filterFeed(articles);
    expect(published).toHaveLength(1);
    expect(published[0].title).toBe("Changelog 1.0");

    const drafts = filterFeed(articles, { status: "draft" });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].title).toBe("Draft Guide");
  });

  test("generates RSS 2.0 XML", () => {
    const rss = generateRssFeed(
      {
        title: "Rose Griffon News",
        link: "https://azalee.rosegriffon.fr",
        description: "All news",
      },
      [
        {
          id: "item-1",
          title: "First Post",
          link: "https://azalee.rosegriffon.fr/news/first",
          description: "Description of first post",
          pubDate: "2026-09-01T12:00:00Z",
        },
      ],
    );
    expect(rss).toContain('<rss version="2.0">');
    expect(rss).toContain("<title><![CDATA[Rose Griffon News]]></title>");
    expect(rss).toContain("<link>https://azalee.rosegriffon.fr/news/first</link>");
  });
});

describe("Azalée Bot Module", () => {
  test("creates formatted bot embeds with brand colors", () => {
    const embed = createBotEmbed({
      title: "Tournament Victory",
      description: "Match ended 3-1",
    });
    expect(embed.color).toBe(EMBED_COLORS.primary);
    expect(embed.title).toBe("Tournament Victory");
    expect(embed.footer?.text).toContain("Rose Griffon Bot");
    expect(embed.timestamp).toBeDefined();
  });

  test("formats Discord timestamps into markdown tags", () => {
    const date = new Date("2026-10-01T12:00:00Z");
    const tag = formatDiscordTimestamp(date, "R");
    expect(tag).toMatch(/<t:\d+:R>/);
  });

  test("builds webhook notification payloads", () => {
    const notification: BotNotification = {
      id: "notif-1",
      title: "Server Update",
      message: "Version 2.0 has been deployed.",
      priority: "high",
      createdAt: "2026-10-01T12:00:00Z",
      metadata: { Version: "2.0.4", Environment: "Production" },
    };
    const webhook = buildNotificationWebhook(notification);
    expect(webhook.username).toBe("Rose Griffon Alerts");
    expect(webhook.embeds?.[0].title).toBe("Server Update");
    expect(webhook.embeds?.[0].color).toBe(EMBED_COLORS.gold);
    expect(webhook.embeds?.[0].fields).toHaveLength(2);
  });
});

describe("Azalée Backward Compatibility via Inagle Re-exports", () => {
  test("re-exports game rules and formations from inagle", () => {
    expect(FORMATIONS).toBeDefined();
    expect(FORMATIONS.length).toBe(8);
  });

  test("re-exports team code codec from inagle", () => {
    const encoded = encodeTeamCode("form_442", [{ slot: "field-0", charaId: "c01000010" }]);
    const decoded = decodeTeamCode(encoded);
    expect(decoded.formationId).toBe("form_442");
    expect(decoded.slots[0].charaId).toBe("c01000010");
  });

  test("re-exports translation and gaiji glyphs from inagle", () => {
    expect(translateEffect("Shot AT +10%")).toBe("Tir ATT +10%");
    expect(GAIJI.plus1).toBeDefined();
  });

  test("exports news and bot namespaces on root azalee", () => {
    expect(news).toBeDefined();
    expect(typeof news.calculateReadTime).toBe("function");
    expect(bot).toBeDefined();
    expect(typeof bot.createBotEmbed).toBe("function");
  });
});

import { describe, expect, test } from "bun:test";
import { parseOfficialCategories, parseOfficialEpisodes, parseYoutubeAtom } from "./inazuma-tv";

describe("Inazuma TV pure adapters", () => {
  test("reads official JSON-LD categories and episode numbers from URLs", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@type": "ItemList",
      name: "Categories",
      itemListElement: [{ position: 1, name: "Saison 1", url: "https://example.test/tv/saison1" }],
    })}</script><script type="application/ld+json">${JSON.stringify({
      "@type": "ItemList",
      name: "Episodes",
      itemListElement: [
        { position: 1, name: "Épisode 12 - Le match", url: "https://example.test/ep-12" },
      ],
    })}</script>`;
    expect(parseOfficialCategories(html)[0]?.slug).toBe("saison1");
    expect(parseOfficialEpisodes(html)[0]?.number).toBe(12);
  });

  test("reads the finite Atom feed without scraping a rendered YouTube page", () => {
    const xml = `<feed><title>Inazuma TV</title><entry><yt:videoId>abc12345678</yt:videoId><title>Episode 1</title><published>2026-01-01</published></entry></feed>`;
    expect(parseYoutubeAtom(xml)[0]).toMatchObject({
      videoId: "abc12345678",
      channel: "Inazuma TV",
    });
  });
});

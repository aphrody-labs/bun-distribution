import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { bxc, resolveBxcPath } from "../../src/bxc/index";
import { FramesService } from "../../src/bxc/services";

process.env.DRAGONBALLCN_SNAPSHOT_DIR = resolve(import.meta.dir, "fixtures/dragonballcn");
const framesFixture = resolve(import.meta.dir, "fixtures/bxc-frames-stats.mjs");

describe("BxcBridge Native Client Suite", () => {
  it("resolves valid bxc path", () => {
    const path = resolveBxcPath();
    expect(typeof path).toBe("string");
    expect(path.length).toBeGreaterThan(0);
  });

  it("checks bxc version", async () => {
    const v = await bxc.version();
    expect(v).toContain("bxc");
  });

  it("Anime-Sama: search and getEpisodes typings and execution", async () => {
    const results = await bxc.animesama.search("inazuma");
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const item = results[0];
    expect(item).toHaveProperty("slug");
    expect(item).toHaveProperty("titre");
    expect(item).toHaveProperty("url");

    // Test episodes
    const eps = await bxc.animesama.getEpisodes(item.slug, { season: "saison1", lang: "vf" });
    expect(eps).toHaveProperty("episodes");
    expect(Array.isArray(eps.episodes)).toBe(true);
    expect(eps.episodes.length).toBeGreaterThan(0);
    expect(eps.episodes[0]).toHaveProperty("lecteurs");
  });

  it("VoirAnime: search and getAnime", async () => {
    const results = await bxc.voiranime.search("inazuma");
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    const first = results[0];
    expect(first).toHaveProperty("slug");
    expect(first).toHaveProperty("title");

    const info = await bxc.voiranime.getAnime(first.slug);
    expect(info).toHaveProperty("title");
    expect(info).toHaveProperty("slug");
    expect(Array.isArray(info.episodes)).toBe(true);
  }, 30000);

  it("MediaWiki: search and markdown", async () => {
    // Wiki MediaWiki hors Fandom (source interdite dans ce dépôt) ; l'API de
    // recherche de Wikipédia ne répond pas à cet endpoint, wiki.gg oui.
    const results = await bxc.wiki.search("https://terraria.wiki.gg/wiki/Terraria_Wiki", "boss", 5);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("titre");
    expect(results[0]).toHaveProperty("url");

    const md = await bxc.wiki.markdown("https://terraria.wiki.gg/wiki/Bosses");
    expect(typeof md).toBe("string");
    expect(md.length).toBeGreaterThan(100);
  }, 30000);

  it("Google Translate: translate with multi-provider fallback", async () => {
    const res = await bxc.google.translate("Bonjour le monde", "en", "fr");
    expect(res).toHaveProperty("translatedText");
    expect(res.translatedText.toLowerCase()).toContain("world");
    expect(["bxc-cli", "lingva", "mymemory", "cache"]).toContain(res.provider);
  });

  it("DragonballCN: catalog", async () => {
    const volumes = await bxc.dragonballcn.catalog("full_color");
    expect(Array.isArray(volumes)).toBe(true);
    expect(volumes).toHaveLength(1);
    const vol1 = volumes[0];
    expect(vol1.id).toBe("0-10-1");
    expect(vol1.title).toBe("卷1 孫悟空修業編1");
    expect(vol1.category).toBe("full_color");
  }, 15000);

  it("DragonballCN: versioned volume inventory preserves public-page boundaries", async () => {
    const info = await bxc.dragonballcn.info("0-10-1");
    expect(info.id).toBe("0-10-1");
    expect(info.totalPages).toBe(2);
    expect(Array.isArray(info.pages)).toBe(true);
    expect(info.pages).toHaveLength(2);

    const firstPage = info.pages[0];
    expect(firstPage.pageNumber).toBe(1);
    expect(firstPage.name).toBe("000-x2h.jpg");
    expect(firstPage.imageUrl).toBe("");
    expect(firstPage.pageUrl).toBe("https://comic.dragonballcn.com/list/gain_1.php?did=0-10-1");

    const viewed = await bxc.dragonballcn.view("0-10-1", 1);
    if ("totalPages" in viewed) throw new Error("expected a single page view");
    expect(viewed).toMatchObject({
      pageNumber: firstPage.pageNumber,
      name: firstPage.name,
      imageUrl: firstPage.imageUrl,
      pageUrl: firstPage.pageUrl,
    });
  }, 50000);

  it("Frames: local index stats", async () => {
    const stats = await new FramesService({ bxcPath: framesFixture }).stats();
    expect(stats).toEqual({ path: "/fixture/frames.sqlite", media: 1, frames: 8, durationMs: 12 });
  });

  it("BxcDbBridge: does not invent absent image URLs and normalizes players", async () => {
    const payload = await bxc.db.buildChapterPagesPayload("0-10-1");
    expect(payload.totalPages).toBe(2);
    expect(payload.pages).toEqual([]);

    const normalizedPlayers = bxc.db.formatEpisodePlayers([
      { name: "Sibnet", provider: "sibnet", embedUrl: "https://video.sibnet.ru/shell.php?videoid=1234", lang: "vf" },
    ]);
    expect(normalizedPlayers.length).toBe(1);
    expect(normalizedPlayers[0].name).toBe("Sibnet");
  }, 50000);
});

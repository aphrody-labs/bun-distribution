/**
 * rosegriffon.fr core pages: every page must render its real data server-side
 * (Postgres-backed Server Components), not just answer 200.
 */

import { describe, expect, test } from "bun:test";
import {
  RG,
  T_FLOW,
  T_PAGE,
  brokenUrls,
  excerpt,
  expectNoErrorMarkers,
  getJson,
  imagesIn,
  linksIn,
  mainHtml,
  textOf,
  withPage,
} from "./_lib.ts";

/** Internal links of the page's main content, checked < 400. */
async function expectMainLinksResolve(html: string, base: string, max = 60) {
  const links = linksIn(html, base)
    .filter((url) => url.startsWith(RG) && !url.includes("/api/"))
    .slice(0, max);
  expect(
    await brokenUrls(links),
    `broken links in main content of ${base}`,
  ).toEqual([]);
}

describe("rosegriffon.fr — core pages", () => {
  test(
    "home renders the association intro, projects and Discord servers",
    () =>
      withPage(`${RG}/`, async (page) => {
        expect(await page.title()).toContain("Rose Griffon");
        await expectNoErrorMarkers(page, "/");
        const intro = await page
          .locator("h1#about-heading")
          .textContent({ timeout: 5_000 });
        expect(
          intro?.trim().length,
          "home h1#about-heading is empty",
        ).toBeGreaterThan(5);
        expect(
          await page.locator('[aria-label*="Discord"]').count(),
          "Discord servers section",
        ).toBeGreaterThan(0);
        expect(
          await page.locator("h2, h3").count(),
          "home sections",
        ).toBeGreaterThan(3);
        await expectMainLinksResolve(await mainHtml(page), `${RG}/`);
      }),
    T_PAGE,
  );

  test(
    "/news lists articles and tweets, an article opens with a body",
    async () => {
      const slug = await withPage(`${RG}/news`, async (page) => {
        await expectNoErrorMarkers(page, "/news");
        expect(
          await page.locator("h1").first().textContent({ timeout: 5_000 }),
        ).toContain("Actualités");
        const cards = page.locator('a[href^="/news/"] article');
        expect(await cards.count(), "article cards on /news").toBeGreaterThan(
          0,
        );
        const html = await mainHtml(page);
        expect(textOf(html)).not.toContain("Aucune actualité");
        const articles = linksIn(html, RG)
          .map((url) => new URL(url).pathname)
          .filter((path) => /^\/news\/(?!tweet\/|tag\/)[a-z0-9-]+$/.test(path));
        expect(articles.length, "article links on /news").toBeGreaterThan(0);
        expect(
          linksIn(html, RG).some((url) => url.includes("/news/tweet/")),
          "tweet links on /news",
        ).toBe(true);
        await expectMainLinksResolve(html, `${RG}/news`);
        return articles[0] as string;
      });
      await withPage(`${RG}${slug}`, async (page) => {
        await expectNoErrorMarkers(page, slug);
        const title = await page
          .locator("article#main-content h1")
          .first()
          .textContent({ timeout: 5_000 });
        expect(
          title?.trim().length,
          `article title on ${slug}`,
        ).toBeGreaterThan(5);
        const body = await page
          .locator("article#main-content .article-content")
          .first()
          .textContent({ timeout: 5_000 });
        expect(
          body?.length ?? 0,
          `article body length on ${slug}`,
        ).toBeGreaterThan(400);
        expect(
          await page.locator("article#main-content .article-content p").count(),
          `paragraphs on ${slug}`,
        ).toBeGreaterThan(2);
      });
    },
    T_FLOW,
  );

  test(
    "/news pagination and category filters render (links, not client state)",
    async () => {
      const firstPage = await withPage(`${RG}/news`, async (page) =>
        linksIn(await mainHtml(page), RG),
      );
      const categories = firstPage.filter((url) => /[?&]category=/.test(url));
      expect(
        categories.length,
        "category filter links on /news",
      ).toBeGreaterThan(0);
      await withPage(`${RG}/news?page=2`, async (page) => {
        await expectNoErrorMarkers(page, "/news?page=2");
        const second = linksIn(await mainHtml(page), RG).filter((url) =>
          url.includes("/news/"),
        );
        expect(second.length, "items on /news?page=2").toBeGreaterThan(0);
        expect(
          second.some((url) => !firstPage.includes(url)),
          "page 2 shows different items than page 1",
        ).toBe(true);
      });
      const empty: string[] = [];
      for (const url of categories) {
        await withPage(url, async (page) => {
          await expectNoErrorMarkers(page, url);
          if (textOf(await mainHtml(page)).includes("Aucune actualité"))
            empty.push(new URL(url).search);
        });
      }
      expect(
        empty,
        "news categories offered as filters but rendering « Aucune actualité »",
      ).toEqual([]);
    },
    T_FLOW,
  );

  test(
    "/wiki landing renders stats, news and sections",
    () =>
      withPage(`${RG}/wiki`, async (page) => {
        await expectNoErrorMarkers(page, "/wiki");
        expect(
          (await page.locator("h1").first().textContent({ timeout: 5_000 }))
            ?.length,
        ).toBeGreaterThan(5);
        const html = await mainHtml(page);
        const sections = linksIn(html, RG).filter((url) =>
          /\/wiki\/[a-z-]+$/.test(url),
        );
        expect(sections.length, "wiki section links").toBeGreaterThan(3);
        await expectMainLinksResolve(html, `${RG}/wiki`);
      }),
    T_PAGE,
  );

  test(
    "/wiki/chara lists characters; two character sheets have stats, techniques and images",
    async () => {
      const characters = await withPage(`${RG}/wiki/chara`, async (page) => {
        await expectNoErrorMarkers(page, "/wiki/chara");
        const rows = page.locator('table tbody tr a[href^="/wiki/chara/"]');
        const count = await rows.count();
        expect(count, "character rows on /wiki/chara").toBeGreaterThan(20);
        return [
          (await rows.nth(0).getAttribute("href")) as string,
          (await rows
            .nth(Math.min(count - 1, 57))
            .getAttribute("href")) as string,
        ];
      });
      for (const path of characters) {
        await withPage(`${RG}${path}`, async (page) => {
          await expectNoErrorMarkers(page, path);
          const name = await page
            .locator("h1")
            .first()
            .textContent({ timeout: 5_000 });
          expect(
            name?.trim().length,
            `character name on ${path}`,
          ).toBeGreaterThan(1);
          const headings = textOf(
            (await page.content()).match(/<h2[\s\S]*?<\/h2>/g)?.join(" ") ?? "",
          );
          for (const section of ["Statistiques", "Techniques", "Profil"]) {
            expect(headings, `section « ${section} » on ${path}`).toContain(
              section,
            );
          }
          const text = textOf(await mainHtml(page));
          for (const stat of [
            "Frappe",
            "Contrôle",
            "Technique",
            "Pression",
            "Physique",
            "Agilité",
            "Intelligence",
          ]) {
            expect(text, `stat « ${stat} » on ${path}`).toContain(stat);
          }
          const images = imagesIn(await mainHtml(page), `${RG}${path}`).slice(
            0,
            25,
          );
          expect(images.length, `images on ${path}`).toBeGreaterThan(0);
          expect(await brokenUrls(images), `broken images on ${path}`).toEqual(
            [],
          );
        });
      }
    },
    T_FLOW,
  );

  test(
    "/azalee redirects to the wiki and the wiki renders",
    () =>
      withPage(`${RG}/azalee`, async (page) => {
        await expectNoErrorMarkers(page, "/azalee");
        expect(await page.title()).toContain("Azalée");
        expect(await page.locator('a[href^="/wiki/"]').count()).toBeGreaterThan(
          3,
        );
      }),
    T_PAGE,
  );

  test(
    "/community renders the Discord hierarchy with members",
    () =>
      withPage(`${RG}/community`, async (page) => {
        await expectNoErrorMarkers(page, "/community");
        expect(
          await page.locator("h1").first().textContent({ timeout: 5_000 }),
        ).toContain("Communauté");
        const text = textOf(await mainHtml(page));
        expect(text).toContain("Hiérarchie");
        expect(text).not.toContain("Aucun membre ne porte ce nom");
        expect(await page.locator("h3").count(), "role groups").toBeGreaterThan(
          3,
        );
        expect(
          await page
            .locator('img[src*="discordapp.com"], div[class*="rounded-xl"]')
            .count(),
          "member cards",
        ).toBeGreaterThan(10);
        const views = linksIn(await mainHtml(page), RG)
          .filter((url) => /[?&](vue|serveur)=/.test(url))
          .slice(0, 6);
        expect(
          await brokenUrls(views),
          "community view/server switches",
        ).toEqual([]);
      }),
    T_PAGE,
  );

  test(
    "/evenements shell renders and both event feeds it calls return data",
    async () => {
      await withPage(`${RG}/evenements`, async (page) => {
        await expectNoErrorMarkers(page, "/evenements");
        expect(
          await page.locator("h1").first().textContent({ timeout: 5_000 }),
        ).toContain("Événements");
      });
      const calendar = await getJson<{ data?: { events?: unknown[] } }>(
        `${RG}/api/calendar-events`,
      );
      expect(calendar.status).toBe(200);
      expect(
        calendar.body.data?.events?.length ?? 0,
        "Google Calendar events",
      ).toBeGreaterThan(0);
      const discord = await getJson<{
        data?: { events?: unknown[] };
        reason?: string;
      }>(`${RG}/api/discord/scheduled-events`);
      expect(discord.status).toBe(200);
      expect(
        discord.body.reason,
        `/api/discord/scheduled-events degraded: ${excerpt(discord.body)}`,
      ).toBeUndefined();
    },
    T_PAGE,
  );

  test(
    "/sondages lists polls and a poll page opens",
    async () => {
      const poll = await withPage(`${RG}/sondages`, async (page) => {
        await expectNoErrorMarkers(page, "/sondages");
        expect(textOf(await mainHtml(page))).not.toContain(
          "Aucun sondage à afficher",
        );
        expect(await page.locator("h2").count(), "poll cards").toBeGreaterThan(
          2,
        );
        const polls = linksIn(await mainHtml(page), RG).filter((url) =>
          /\/sondages\/[^/?]+$/.test(url),
        );
        expect(polls.length, "poll links").toBeGreaterThan(0);
        return polls[0] as string;
      });
      await withPage(poll, async (page) => {
        await expectNoErrorMarkers(page, poll);
        expect(
          (await page.locator("h1, h2").first().textContent({ timeout: 5_000 }))
            ?.length,
        ).toBeGreaterThan(5);
      });
    },
    T_PAGE,
  );

  test(
    "/notre-equipe shows the teams and their members",
    () =>
      withPage(`${RG}/notre-equipe`, async (page) => {
        await expectNoErrorMarkers(page, "/notre-equipe");
        expect(
          await page.locator("h1").first().textContent({ timeout: 5_000 }),
        ).toContain("Notre équipe");
        expect(
          await page.locator('section[aria-labelledby^="titre-"]').count(),
          "team sections",
        ).toBeGreaterThan(1);
        expect(
          await page.locator("h3").count(),
          "member names",
        ).toBeGreaterThan(5);
        expect(textOf(await mainHtml(page))).toMatch(/\d+ contributeurs/);
        const images = imagesIn(
          await mainHtml(page),
          `${RG}/notre-equipe`,
        ).slice(0, 30);
        expect(await brokenUrls(images), "broken member avatars").toEqual([]);
      }),
    T_PAGE,
  );

  test(
    "/search?q= returns results server-side and its tabs render",
    async () => {
      const tabs = await withPage(`${RG}/search?q=evans`, async (page) => {
        await expectNoErrorMarkers(page, "/search?q=evans");
        expect(
          await page.locator('form[role="search"] input[name="q"]').count(),
        ).toBe(1);
        const html = await mainHtml(page);
        const text = textOf(html);
        expect(text).not.toContain(
          "La recherche est temporairement indisponible",
        );
        expect(text).not.toContain("Aucun résultat trouvé");
        expect(
          await page.locator("section[aria-label] h2").count(),
          "result groups",
        ).toBeGreaterThan(0);
        const results = linksIn(html, RG).filter((url) =>
          /\/(wiki|news|achillea)\//.test(url),
        );
        expect(results.length, "result links").toBeGreaterThan(0);
        expect(
          await brokenUrls(results.slice(0, 20)),
          "broken search results",
        ).toEqual([]);
        return linksIn(html, RG).filter((url) => /[?&]tab=/.test(url));
      });
      expect(tabs.length, "search tabs").toBeGreaterThan(1);
      for (const tab of tabs)
        await withPage(tab, (page) => expectNoErrorMarkers(page, tab));
    },
    T_FLOW,
  );
});

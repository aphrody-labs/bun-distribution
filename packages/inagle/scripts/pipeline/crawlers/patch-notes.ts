/* eslint-disable no-console */
import * as cheerio from "cheerio";
import type { PatchNoteSummary } from "./types.ts";

// --- Config ---

const BASE_URL = "https://www.inazuma.jp/victory-road";
const BASE_URL_EN = `${BASE_URL}/en/patchnote`;

// --- Scraper ---

export async function scrapePatchNoteList(
  platform: "ps-steam" | "switch" | "xbox" = "ps-steam",
): Promise<PatchNoteSummary[]> {
  const url = `${BASE_URL_EN}/${platform}/`;
  console.log(`[Scraper] Fetching list from: ${url}`);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch list: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    const notes: PatchNoteSummary[] = [];

    // The links to versions usually contain '/ver_'
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      if (href.includes("/ver_")) {
        const fullText = $(el).text().trim();
        const dateMatch = fullText.match(/(\d{4}\.\d{1,2}\.\d{1,2})/);
        const date = dateMatch ? dateMatch[0] : "";

        let title = fullText.replace(date, "").replace("[JST]", "").replace(/\s+/g, " ").trim();

        // Fallback for title
        if (!title && $(el).find(".text").length) {
          title = $(el).find(".text").text().trim();
        }

        const absoluteUrl = href.startsWith("http") ? href : `https://www.inazuma.jp${href}`;
        const id = absoluteUrl.split("/").filter(Boolean).pop() || "";

        if (!notes.find(n => n.id === id)) {
          notes.push({
            id,
            title: title || "Patch Note",
            date,
            platform: platform === "ps-steam" ? ["ps4", "ps5", "steam"] : [platform],
            url: absoluteUrl,
          });
        }
      }
    });

    return notes;
  } catch (error) {
    console.error("[Scraper] Error parsing list:", error);
    return [];
  }
}

export async function scrapePatchNoteDetail(
  url: string,
): Promise<{ content: string; featured_image: string | null } | null> {
  console.log(`[Scraper] Fetching detail from: ${url}`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch detail: ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);

    // Extract Featured Image (h2 figure img)
    let featured_image: string | null = null;
    const mainImg = $("h2 figure img").first();
    if (mainImg.length) {
      const src = mainImg.attr("src");
      if (src) {
        if (src.startsWith("http")) {
          featured_image = src;
        } else if (src.startsWith("/")) {
          featured_image = `https://www.inazuma.jp${src}`;
        } else {
          const baseUrl = url.endsWith("/") ? url : `${url}/`;
          featured_image = new URL(src, baseUrl).toString();
        }
      }
    }

    // Remove non-content elements
    const elementsToRemove = [
      "header",
      "footer",
      "nav",
      "script",
      "style",
      ".cookie-banner",
      ".header",
      ".footer",
      "#navAreaH",
      "#navAreaF",
      ".btnMenu",
      ".logo",
      ".gnav",
      ".topicsTit",
      ".innerB",
      ".productBox",
      ".bnrBox",
      ".link",
      ".subLink",
      ".bnrLink",
      ".notes",
      ".copyRight",
      "#store",
      ".updateBtn",
      ".guideLink",
      ".btnClose",
      ".rBox",
      ".logoIn",
    ];

    $(elementsToRemove.join(", ")).remove();

    // Also remove any duplicate H1s that might be logos
    $("h1 img").closest("h1").remove();

    // Fix relative URLs in content
    let baseUrl = url;
    if (!baseUrl.endsWith("/") && !baseUrl.match(/\.[a-zA-Z0-9]+$/)) {
      baseUrl += "/";
    }

    $("img").each((_, el) => {
      const src = $(el).attr("src");
      if (src && !src.startsWith("http")) {
        if (src.startsWith("/")) {
          $(el).attr("src", `https://www.inazuma.jp${src}`);
        } else {
          try {
            $(el).attr("src", new URL(src, baseUrl).toString());
          } catch {
            /* ignore */
          }
        }
      }
    });

    $("a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && !href.startsWith("http") && !href.startsWith("#")) {
        if (href.startsWith("/")) {
          $(el).attr("href", `https://www.inazuma.jp${href}`);
        } else {
          try {
            $(el).attr("href", new URL(href, baseUrl).toString());
          } catch {
            /* ignore */
          }
        }
      }
    });

    const main = $("main");
    let content = main.length ? main.html() : "";
    if (!content) {
      content = $(".contentArea").html() || $("body").html() || "";
    }

    return {
      content: content || "",
      featured_image,
    };
  } catch (e) {
    console.error(e);
    return null;
  }
}

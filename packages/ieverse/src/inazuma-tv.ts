import type { MediaEntry, WorkRef } from "./work";
import { mediaId, workId } from "./work";
import { runtimeForMediaKind } from "./runtime";

export interface OfficialCategory {
  position: number;
  name: string;
  url: string;
  slug: string;
}

export interface OfficialEpisode {
  number: number;
  title: string;
  url: string;
}

export interface AtomVideo {
  videoId: string;
  title: string;
  url: string;
  published: string | null;
  channel: string | null;
}

export function slugFromUrl(url: string): string {
  const path = url.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");
  return path.slice(path.lastIndexOf("/") + 1);
}

export function parseOfficialCategories(html: string): OfficialCategory[] {
  return parseItemList(html, (name) => /categor/i.test(name))
    .map((item) => ({ ...item, slug: slugFromUrl(item.url) }))
    .filter((item) => item.slug.length > 0);
}

export function parseOfficialEpisodes(html: string): OfficialEpisode[] {
  return parseItemList(html, (name) => /episode/i.test(name))
    .map((item) => ({
      number: Number.parseInt(/\/ep-(\d+)/i.exec(item.url)?.[1] ?? String(item.position), 10),
      title: item.name.replace(/^\s*(?:episode|épisode)\s*\d+\s*[-–—:]\s*/i, "").trim(),
      url: item.url,
    }))
    .filter((episode) => Number.isFinite(episode.number));
}

export function parseYoutubeAtom(xml: string): AtomVideo[] {
  const beforeEntries = xml.split("<entry>", 1)[0] ?? "";
  const channel = textTag(beforeEntries, "title");
  const entries: AtomVideo[] = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const body = match[1]!;
    const videoId = textTag(body, "yt:videoId");
    const title = textTag(body, "title");
    if (!videoId || !title) continue;
    entries.push({
      videoId,
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      published: textTag(body, "published"),
      channel,
    });
  }
  return entries;
}

export function officialEpisodeEntry(
  category: OfficialCategory,
  episode: OfficialEpisode,
  work: WorkRef = {
    id: workId("inazuma_eleven"),
    kind: "anime",
    title: "Inazuma Eleven",
    series: "inazuma_eleven",
  },
): MediaEntry {
  return {
    id: mediaId("episode", `${category.slug}_${episode.number}`),
    kind: "episode",
    work,
    title: episode.title,
    season: category.position,
    episode: episode.number,
    runtime: runtimeForMediaKind("episode"),
    sources: [
      {
        platform: "official_page",
        id: episode.url,
        url: episode.url,
        official: true,
        verified: true,
      },
    ],
  };
}

function parseItemList(
  html: string,
  accepts: (name: string) => boolean,
): { position: number; name: string; url: string }[] {
  for (const object of jsonLdObjects(html)) {
    if (
      object["@type"] !== "ItemList" ||
      !accepts(typeof object.name === "string" ? object.name : "")
    )
      continue;
    if (!Array.isArray(object.itemListElement)) continue;
    return object.itemListElement
      .map((raw, index) => {
        const item = raw as Record<string, unknown>;
        return {
          position: typeof item.position === "number" ? item.position : index + 1,
          name: typeof item.name === "string" ? item.name.trim() : "",
          url: typeof item.url === "string" ? item.url.trim() : "",
        };
      })
      .filter((item) => item.name.length > 0 && item.url.length > 0);
  }
  return [];
}

function jsonLdObjects(html: string): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const value: unknown = JSON.parse(match[1]!);
      for (const root of Array.isArray(value) ? value : [value]) {
        if (!root || typeof root !== "object") continue;
        const object = root as Record<string, unknown>;
        const graph = object["@graph"];
        if (Array.isArray(graph))
          result.push(
            ...graph.filter((item): item is Record<string, unknown> =>
              Boolean(item && typeof item === "object"),
            ),
          );
        else result.push(object);
      }
    } catch {
      // One malformed JSON-LD block must not hide the other structured blocks.
    }
  }
  return result;
}

function textTag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? decodeXml(match[1]!) : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

// SPDX-License-Identifier: Apache-2.0
/** MediaWiki search consumer; HTTP and page URL resolution belong to Rust Aphrody Web. */
import { z } from "zod";
import { runAphrodyCli, type AphrodyCliOptions } from "./cli";

export const WikiSearchResultSchema = z.object({
  titre: z.string(),
  url: z.string(),
  taille: z.number().optional(),
});
export type WikiSearchResult = z.infer<typeof WikiSearchResultSchema>;

export interface AphrodyWikiOptions extends Omit<AphrodyCliOptions, "json"> {
  /** Overrides endpoint inference for wikis with a custom installation path. */
  apiUrl?: string;
}

export const WikiSectionSchema = z.object({
  niveau: z.number().default(1),
  titre: z.string(),
  ancre: z.string().default(""),
});
export type WikiSection = z.infer<typeof WikiSectionSchema>;
export const WikiPageDossierSchema = z.object({
  url: z.string(),
  titre: z.string(),
  api: z.string().default("api.php"),
  revid: z.number().nullable().optional(),
  sections: z.array(WikiSectionSchema).default([]),
  infobox: z.array(z.record(z.string(), z.unknown())).default([]),
  tableaux: z.array(z.unknown()).default([]),
  images: z.array(z.unknown()).default([]),
  categories: z.array(z.string()).default([]),
  liens_externes: z.array(z.string()).default([]),
  markdown: z.string().optional(),
  wikitext: z.string().nullable().optional(),
  mesures: z.record(z.string(), z.number()).optional(),
});
export type WikiPageDossier = z.infer<typeof WikiPageDossierSchema>;

export function resolveWikiApiUrl(raw: string): string {
  const url = new URL(raw);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("MediaWiki search requires an HTTP(S) URL without credentials");
  }
  url.search = "";
  url.hash = "";
  if (url.pathname.endsWith("/api.php")) return url.href;
  if (
    /\.(?:wikipedia|wikimedia|wiktionary|wikisource|wikibooks|wikiquote|wikiversity|wikivoyage|wikinews)\.org$/.test(
      url.hostname,
    )
  ) {
    url.pathname = "/w/api.php";
    return url.href;
  }
  const wikiPath = url.pathname.indexOf("/wiki/");
  if (wikiPath >= 0) url.pathname = `${url.pathname.slice(0, wikiPath)}/api.php`;
  else if (url.pathname.endsWith("/index.php"))
    url.pathname = url.pathname.replace(/index\.php$/, "api.php");
  else if (url.pathname.endsWith("/wiki")) url.pathname = url.pathname.replace(/wiki$/, "api.php");
  else if (url.pathname.endsWith("/")) url.pathname += "api.php";
  else throw new Error("Provide a wiki base URL, article URL or explicit api.php endpoint");
  return url.href;
}

export class AphrodyWikiSearchService {
  constructor(protected readonly defaults: AphrodyWikiOptions = {}) {}

  async search(
    wikiUrl: string,
    query: string,
    limit = 20,
    options: AphrodyWikiOptions = {},
  ): Promise<WikiSearchResult[]> {
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 100)
      throw new Error("MediaWiki search limit must be an integer between 0 and 100");
    if (!query.trim() || limit === 0) return [];
    const merged = { ...this.defaults, ...options };
    const apiUrl = resolveWikiApiUrl(merged.apiUrl ?? wikiUrl);
    const result = await runAphrodyCli<unknown>(
      ["web", "wiki-search", apiUrl, "--limit", String(limit), "--json", "--", query],
      {
        timeoutMs: 60_000,
        ...merged,
        json: true,
      },
    );
    if (result.kind === "exit" && result.ok)
      return z.array(WikiSearchResultSchema).parse(result.data);
    if (result.kind === "not_found")
      throw new Error(`Aphrody Wiki CLI unavailable: ${result.message}`);
    if (result.kind === "timeout")
      throw new Error(`Aphrody Wiki search timed out after ${result.timeoutMs} ms`);
    if (result.kind === "invalid_json")
      throw new Error(`Aphrody Wiki search returned invalid JSON: ${result.error}`);
    throw new Error(
      `Aphrody Wiki search exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

/** Page parsing, image resolution and Markdown conversion belong to Rust Aphrody. */
export class AphrodyWikiService extends AphrodyWikiSearchService {
  async page(
    url: string,
    options: AphrodyWikiOptions & { includeContent?: boolean; includeImages?: boolean } = {},
  ): Promise<WikiPageDossier> {
    const result = await this.runPage(url, options);
    if (!result || typeof result !== "object")
      throw new Error("Aphrody Wiki returned an invalid dossier");
    const raw = result as Record<string, unknown>;
    for (const field of [
      "sections",
      "infobox",
      "tableaux",
      "images",
      "categories",
      "liens_externes",
    ]) {
      if (!Array.isArray(raw[field])) throw new Error(`Aphrody Wiki dossier is missing ${field}`);
    }
    if (!("revid" in raw) || !raw.mesures || typeof raw.mesures !== "object") {
      throw new Error("Aphrody Wiki dossier is missing revision or measurements");
    }
    const dossier = WikiPageDossierSchema.parse(result);
    if (dossier.url !== new URL(url).href)
      throw new Error("Aphrody Wiki returned a different page URL");
    return dossier;
  }

  async markdown(url: string, options: AphrodyWikiOptions = {}): Promise<string> {
    const result = await this.runPage(url, { ...options, markdownOnly: true });
    if (typeof result !== "string") throw new Error("Aphrody Wiki returned invalid Markdown");
    return result;
  }

  md(url: string, options: AphrodyWikiOptions = {}): Promise<string> {
    return this.markdown(url, options);
  }

  private async runPage(
    url: string,
    options: AphrodyWikiOptions & {
      includeContent?: boolean;
      includeImages?: boolean;
      markdownOnly?: boolean;
    },
  ): Promise<unknown> {
    const merged = { ...this.defaults, ...options };
    const pageUrl = new URL(url);
    const apiUrl = resolveWikiApiUrl(merged.apiUrl ?? url);
    const args = ["web", "wiki-page", "--api-url", apiUrl, "--json"];
    if (options.markdownOnly) args.push("--markdown");
    if (options.includeContent) args.push("--include-content");
    if (options.includeImages === false) args.push("--no-images");
    args.push("--", pageUrl.href);
    const result = await runAphrodyCli<unknown>(args, {
      timeoutMs: 120_000,
      ...merged,
      json: true,
    });
    if (result.kind === "exit" && result.ok) return result.data;
    if (result.kind === "not_found")
      throw new Error(`Aphrody Wiki CLI unavailable: ${result.message}`);
    if (result.kind === "timeout")
      throw new Error(`Aphrody Wiki page timed out after ${result.timeoutMs} ms`);
    if (result.kind === "invalid_json")
      throw new Error(`Aphrody Wiki page returned invalid JSON: ${result.error}`);
    throw new Error(
      `Aphrody Wiki page exited ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

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
  constructor(private readonly defaults: AphrodyWikiOptions = {}) {}

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
      ["web", "wiki-search", apiUrl, query, "--limit", String(limit), "--json"],
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

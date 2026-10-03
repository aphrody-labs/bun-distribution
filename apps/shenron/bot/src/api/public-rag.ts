// SPDX-License-Identifier: Apache-2.0
/** Public route bodies shared by the bot and live HTTP qualification. */
import type { Database } from "bun:sqlite";
import { resolveSiteUrl } from "@shenron/config/public-urls";
import { buildRagContext, hybridSearch } from "../lib/rag";

export async function searchPublicRag(req: Request, db: Database | null) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 8), 1), 25);
  if (q.length < 2) return { q, results: [], mode: "lexical" as const };
  try {
    const { results, mode } = await hybridSearch(db, q, limit, {
      lang: url.searchParams.get("lang") || undefined,
      entity: url.searchParams.get("entity") || undefined,
      sourceId: url.searchParams.get("sourceId") || undefined,
      kind: url.searchParams.get("kind") || undefined,
      lexicalOnly: url.searchParams.get("lexicalOnly") === "true",
    });
    return { q, results, mode };
  } catch {
    return { q, results: [], error: "index_unavailable" };
  }
}

export async function contextPublicRag(req: Request, db: Database | null) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 6), 1), 12);
  const maxChars = Math.min(
    Math.max(Number(url.searchParams.get("maxChars") ?? 6000), 500),
    16_000,
  );
  if (q.length < 2) return { q, mode: "lexical" as const, context: "", sources: [] };
  try {
    return await buildRagContext(db, q, {
      limit,
      maxChars,
      lang: url.searchParams.get("lang") || undefined,
      entity: url.searchParams.get("entity") || undefined,
      sourceId: url.searchParams.get("sourceId") || undefined,
      kind: url.searchParams.get("kind") || undefined,
      siteBase: resolveSiteUrl(Bun.env),
    });
  } catch {
    return { q, mode: "lexical" as const, context: "", sources: [], error: "index_unavailable" };
  }
}

// SPDX-License-Identifier: Apache-2.0

export type SearchVertical = "web" | "images" | "news" | "videos" | "books";
export interface GoogleSearchRequest {
  query: string;
  vertical: SearchVertical;
  hl: string;
  safe: "active" | "off";
  start: number;
}
export interface GoogleSearchHit {
  title: string;
  url: string;
  snippet: string;
}
export interface GoogleSearchPage {
  query: string;
  organic: GoogleSearchHit[];
  correctedQuery?: string;
}
type Rpc = (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;

export function safeSearchUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function parseGoogleSearchResponse(response: Record<string, unknown>): GoogleSearchPage {
  const content = Array.isArray(response.content) ? response.content : [];
  const text = content
    .filter(
      (item): item is { type: string; text: string } =>
        typeof item === "object" && item !== null && item.type === "text" && typeof item.text === "string",
    )
    .map(item => item.text)
    .join("\n");
  if (response.isError === true) throw new Error(text || "La recherche native a échoué.");
  let payload: unknown = response;
  try {
    if (!("organic" in response)) payload = JSON.parse(text);
  } catch {
    throw new Error("Réponse de recherche native invalide.");
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("organic" in payload) ||
    !Array.isArray(payload.organic) ||
    !("query" in payload) ||
    typeof payload.query !== "string"
  ) {
    throw new Error("Réponse de recherche native invalide.");
  }
  const organic: GoogleSearchHit[] = [];
  const seen = new Set<string>();
  for (const hit of payload.organic) {
    if (typeof hit !== "object" || hit === null) continue;
    const url = safeSearchUrl(hit.url);
    if (url && typeof hit.title === "string" && typeof hit.snippet === "string" && !seen.has(url + hit.title)) {
      seen.add(url + hit.title);
      organic.push({ title: hit.title, url, snippet: hit.snippet });
    }
  }
  return {
    query: payload.query,
    organic,
    correctedQuery:
      "correctedQuery" in payload && typeof payload.correctedQuery === "string" ? payload.correctedQuery : undefined,
  };
}

export async function searchGoogle(
  request: GoogleSearchRequest,
  rpc: Rpc = async (_method, params = {}) => {
    const query = new URLSearchParams();
    for (const key of ["query", "vertical", "hl", "safe", "start"]) query.set(key, String(params[key] ?? ""));
    const response = await fetch(`/api/search?${query}`);
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Search is unavailable");
    return body;
  },
): Promise<GoogleSearchPage> {
  const query = request.query.trim();
  if (!query) throw new Error("Saisissez une recherche.");
  const response = await rpc("aphrody/google/search", {
    ...request,
    query,
    num: 10,
    anonymous: true,
    rich: false,
  });
  return parseGoogleSearchResponse(response);
}

/** Minimal MediaWiki API client: resolve a wiki from a page URL, list files of pages/categories/prefixes. */

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface WikiFile {
  title: string;
  name: string;
  url: string;
  size: number;
  width: number;
  height: number;
  mime: string;
  descriptionUrl: string;
}

export interface Target {
  apiUrl: string;
  /** Page title extracted from the URL, when the URL pointed at a page. */
  title?: string;
}

const USER_AGENT = "creator-kit/0.1 (local wiki image fetch; contact: see README)";

export function wikiHeaders(): Record<string, string> {
  return { "user-agent": USER_AGENT, accept: "application/json" };
}

/** `https://x.fandom.com/wiki/Sol_Badguy/Gallery` -> title `Sol Badguy/Gallery`. */
export function titleFromPath(url: URL): string | undefined {
  const wikiMarker = url.pathname.match(/\/wiki\/(.+)$/);
  const raw = wikiMarker?.[1] ?? url.searchParams.get("title") ?? undefined;
  if (!raw) return undefined;
  return decodeURIComponent(raw).replaceAll("_", " ");
}

/** Find the api.php of the wiki serving `pageUrl` (RSD link in the HTML, then common paths). */
export async function resolveTarget(input: string, fetchImpl: Fetch = fetch): Promise<Target> {
  const url = new URL(input);
  if (url.pathname.endsWith("api.php")) return { apiUrl: url.toString() };
  const title = titleFromPath(url);
  const candidates: string[] = [];
  try {
    const html = await (await fetchImpl(url.toString(), { headers: { "user-agent": USER_AGENT } })).text();
    const rsd = html.match(/<link[^>]+rel=["']EditURI["'][^>]+href=["']([^"']+)["']/i)?.[1];
    if (rsd) candidates.push(new URL(rsd.replaceAll("&amp;", "&"), url).toString().replace(/\?.*$/, ""));
  } catch {
    // fall through to the common paths
  }
  const prefix = url.pathname.match(/^(\/[a-z]{2}(?:-[a-z]{2})?)\/wiki\//i)?.[1] ?? "";
  candidates.push(`${url.origin}${prefix}/api.php`, `${url.origin}/w/api.php`, `${url.origin}/api.php`);
  for (const candidate of new Set(candidates)) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- candidates are probed in preference order; the first valid api.php must win, without parallel hits on the wiki
      const res = await fetchImpl(`${candidate}?action=query&meta=siteinfo&format=json`, {
        headers: wikiHeaders(),
      });
      // oxlint-disable-next-line no-await-in-loop -- same ordered probe: the body decides whether this candidate wins before the next one is tried
      if (res.ok && (await res.json())?.query) return { apiUrl: candidate, title };
    } catch {
      // try next
    }
  }
  throw new Error(`api.php introuvable pour ${input} (passe l'URL de l'API avec --api)`);
}

interface ApiPage {
  title: string;
  imageinfo?: {
    url: string;
    size: number;
    width: number;
    height: number;
    mime: string;
    descriptionurl: string;
  }[];
}

type ApiResponse = {
  continue?: Record<string, string>;
  query?: { pages?: Record<string, ApiPage> };
  error?: { code: string; info: string };
};

async function* query(apiUrl: string, params: Record<string, string>, fetchImpl: Fetch): AsyncGenerator<ApiPage> {
  const base: Record<string, string> = {
    action: "query",
    format: "json",
    formatversion: "1",
    prop: "imageinfo",
    iiprop: "url|size|mime",
    iilimit: "1",
    maxlag: "5",
    ...params,
  };
  let cont: Record<string, string> = {};
  const seen = new Map<string, ApiPage>();
  for (let guard = 0; guard < 10_000; guard += 1) {
    const search = new URLSearchParams({ ...base, ...cont });
    // oxlint-disable-next-line no-await-in-loop -- MediaWiki continuation chain: each request needs the continue token of the previous response
    const res = await fetchWithRetry(`${apiUrl}?${search}`, fetchImpl);
    // oxlint-disable-next-line no-await-in-loop -- same continuation chain: the body carries the next continue token
    const body = (await res.json()) as ApiResponse;
    if (body.error) throw new Error(`API MediaWiki : ${body.error.code} ${body.error.info}`);
    for (const [id, page] of Object.entries(body.query?.pages ?? {})) {
      const known = seen.get(id);
      if (known) known.imageinfo ??= page.imageinfo;
      else seen.set(id, page);
    }
    if (!body.continue) break;
    cont = body.continue;
  }
  yield* seen.values();
}

export async function fetchWithRetry(url: string, fetchImpl: Fetch, attempts = 5): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- retries are sequential by design: each attempt follows the backoff of the previous one
      const res = await fetchImpl(url, { headers: wikiHeaders() });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
        lastError = new Error(`HTTP ${res.status}`);
        // oxlint-disable-next-line no-await-in-loop -- honours the server's retry-after before the next attempt
        await Bun.sleep(Math.min(wait, 30) * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        // oxlint-disable-next-line no-await-in-loop -- exponential backoff between sequential attempts
        await Bun.sleep(2 ** attempt * 500);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function toFile(page: ApiPage): WikiFile | undefined {
  const info = page.imageinfo?.[0];
  if (!info?.url) return undefined;
  return {
    title: page.title,
    name: page.title.replace(/^[^:]+:/, ""),
    url: info.url,
    size: info.size,
    width: info.width,
    height: info.height,
    mime: info.mime,
    descriptionUrl: info.descriptionurl,
  };
}

async function collect(source: AsyncGenerator<ApiPage>): Promise<WikiFile[]> {
  const files: WikiFile[] = [];
  for await (const page of source) {
    const file = toFile(page);
    if (file) files.push(file);
  }
  return files;
}

/** Files embedded in / linked from pages (batches of 50 titles). Covers `<gallery>` tags. */
export async function filesOfPages(apiUrl: string, titles: string[], fetchImpl: Fetch = fetch): Promise<WikiFile[]> {
  const out: WikiFile[] = [];
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50).join("|");
    // oxlint-disable-next-line no-await-in-loop -- batches run one after another to respect the wiki's maxlag/rate limits and keep output order
    const files = await collect(query(apiUrl, { generator: "images", gimlimit: "max", titles: batch }, fetchImpl));
    out.push(...files);
  }
  return out;
}

/** Files of a category, optionally walking sub-categories. */
export async function filesOfCategory(
  apiUrl: string,
  category: string,
  fetchImpl: Fetch = fetch,
  depth = 0,
): Promise<WikiFile[]> {
  const title = /^Category:/i.test(category) ? category : `Category:${category}`;
  const files = await collect(
    query(
      apiUrl,
      {
        generator: "categorymembers",
        gcmtitle: title,
        gcmtype: "file",
        gcmlimit: "max",
      },
      fetchImpl,
    ),
  );
  if (depth <= 0) return files;
  const subs: string[] = [];
  for await (const page of query(
    apiUrl,
    {
      generator: "categorymembers",
      gcmtitle: title,
      gcmtype: "subcat",
      gcmlimit: "max",
      prop: "info",
    },
    fetchImpl,
  )) {
    subs.push(page.title);
  }
  for (const sub of subs) {
    // oxlint-disable-next-line no-await-in-loop -- sub-categories are walked one by one to respect the wiki's rate limits and keep output order
    const subFiles = await filesOfCategory(apiUrl, sub, fetchImpl, depth - 1);
    files.push(...subFiles);
  }
  return files;
}

/** Every uploaded file whose name starts with `prefix` (use sparingly on large wikis). */
export async function filesOfPrefix(apiUrl: string, prefix: string, fetchImpl: Fetch = fetch): Promise<WikiFile[]> {
  return collect(query(apiUrl, { generator: "allimages", gaiprefix: prefix, gailimit: "max" }, fetchImpl));
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Safe file name on Windows, macOS and Linux. */
export function safeName(name: string): string {
  const printable = [...name].filter(char => char.charCodeAt(0) >= 32).join("");
  let out =
    printable
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/[. ]+$/, "")
      .trim() || "file";
  if (WINDOWS_RESERVED.test(out)) out = `_${out}`;
  if (out.length <= 180) return out;
  const dot = out.lastIndexOf(".");
  return dot > 0 && out.length - dot <= 10 ? `${out.slice(0, 160)}${out.slice(dot)}` : out.slice(0, 170);
}

/**
 * Incremental crawler for developer.android.com, source.android.com and the
 * documentation repositories of android.googlesource.com.
 */
import { mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { htmlToMarkdown } from "./convert.ts";
import { DocsStore } from "./store.ts";

export interface DocSource {
  name: string;
  origin: string;
  sitemap: string;
  /** Path prefixes to keep; empty keeps the whole site. */
  prefixes: string[];
}

export const SOURCES: DocSource[] = [
  {
    name: "developer",
    origin: "https://developer.android.com",
    sitemap: "https://developer.android.com/sitemap.xml",
    prefixes: [
      "/guide",
      "/reference",
      "/kotlin",
      "/jetpack",
      "/studio",
      "/ndk",
      "/games",
      "/training",
      "/develop",
      "/topic",
      "/tools",
      "/build",
      "/compose",
      "/privacy-and-security",
      "/media",
      "/google/play",
      "/about/versions",
    ],
  },
  {
    name: "source",
    origin: "https://source.android.com",
    sitemap: "https://source.android.com/sitemap.xml",
    prefixes: ["/docs", "/security"],
  },
];

/**
 * Shallow clones of the AOSP repositories that carry Markdown documentation.
 * The full AOSP tree (100+ GB) is out of scope: source.android.com already
 * publishes its docs, and these repositories hold the build/runtime READMEs
 * that are not on the site.
 */
export const DOC_REPOS = [
  "platform/build/soong",
  "platform/build",
  "platform/bionic",
  "platform/art",
  "platform/system/sepolicy",
  "platform/tools/repohooks",
  "platform/manifest",
];

const USER_AGENT = "bun-android-docs/1.0 (+https://github.com/aphrody-labs)";

async function robots(origin: string): Promise<string[]> {
  const response = await fetch(`${origin}/robots.txt`, {
    headers: { "user-agent": USER_AGENT },
  });
  if (!response.ok) return [];
  const disallow: string[] = [];
  let applies = false;
  for (const raw of (await response.text()).split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    const [key, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(key ?? "")) applies = value === "*";
    else if (applies && /^disallow$/i.test(key ?? "") && value)
      disallow.push(value);
  }
  return disallow;
}

async function sitemapUrls(
  url: string,
  out: Map<string, string | null>,
): Promise<void> {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const xml = await response.text();
  const nested: string[] = [];
  const isIndex = xml.includes("<sitemapindex");
  for (const block of xml.matchAll(
    /<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/g,
  )) {
    const loc = block[1]!.match(/<loc>\s*([^<]+?)\s*<\/loc>/)?.[1];
    if (!loc) continue;
    const lastmod =
      block[1]!.match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/)?.[1] ?? null;
    if (isIndex) nested.push(loc.replaceAll("&amp;", "&"));
    else out.set(loc.replaceAll("&amp;", "&"), lastmod);
  }
  for (const child of nested) await sitemapUrls(child, out);
}

function keep(url: URL, source: DocSource, disallow: string[]): boolean {
  if (url.origin !== source.origin || url.search) return false;
  if (disallow.some((path) => url.pathname.startsWith(path))) return false;
  return (
    source.prefixes.length === 0 ||
    source.prefixes.some((prefix) => url.pathname.startsWith(prefix))
  );
}

function pagePath(home: string, url: URL): string {
  let path = url.pathname.replace(/\/+$/, "/index").replace(/\.html?$/, "");
  path = path.replace(/[<>:"|?*]/g, "_");
  return join(home, "pages", url.host, `${path}.md`);
}

export interface CrawlOptions {
  sources?: string[];
  concurrency?: number;
  limit?: number;
  refreshSitemaps?: boolean;
  log?: (line: string) => void;
}

export async function crawl(options: CrawlOptions = {}): Promise<void> {
  const store = new DocsStore();
  const log = options.log ?? ((line) => console.error(line));
  const concurrency = options.concurrency ?? 8;
  const selected = SOURCES.filter(
    (source) =>
      !options.sources?.length || options.sources.includes(source.name),
  );
  store.retryFailed();
  try {
    for (const source of selected) {
      const disallow = await robots(source.origin);
      if (options.refreshSitemaps !== false) {
        const urls = new Map<string, string | null>();
        await sitemapUrls(source.sitemap, urls);
        let kept = 0;
        store.db.transaction(() => {
          for (const [href, lastmod] of urls) {
            const url = new URL(href);
            if (!keep(url, source, disallow)) continue;
            store.enqueue(url.href, source.name, lastmod);
            kept++;
          }
        })();
        log(`${source.name}: ${kept} URLs in scope (${urls.size} in sitemap)`);
      }
      let budget = options.limit ?? Number.POSITIVE_INFINITY;
      let done = 0;
      while (budget > 0) {
        const batch = store.pending(source.name, Math.min(500, budget));
        if (batch.length === 0) break;
        budget -= batch.length;
        let next = 0;
        const worker = async () => {
          while (next < batch.length) {
            const item = batch[next++]!;
            await fetchPage(store, source, item.url, item.etag, disallow);
            if (++done % 250 === 0) log(`${source.name}: ${done} fetched`);
          }
        };
        await Promise.all(Array.from({ length: concurrency }, worker));
      }
      log(`${source.name}: ${done} fetched this run`);
    }
  } finally {
    store.close();
  }
}

async function fetchPage(
  store: DocsStore,
  source: DocSource,
  href: string,
  etag: string | null,
  disallow: string[],
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response: Response;
    try {
      response = await fetch(href, {
        headers: {
          "user-agent": USER_AGENT,
          ...(etag ? { "if-none-match": etag } : {}),
        },
        redirect: "follow",
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      await Bun.sleep(1000 * 2 ** attempt);
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      await Bun.sleep(
        Number(response.headers.get("retry-after") ?? 0) * 1000 ||
          2000 * 2 ** attempt,
      );
      continue;
    }
    if (response.status === 304)
      return store.save(href, source.name, 200, etag);
    if (!response.ok)
      return store.save(href, source.name, response.status, null);
    const finalUrl = new URL(response.url || href);
    if (finalUrl.origin !== source.origin)
      return store.save(href, source.name, 301, null);
    const page = await htmlToMarkdown(await response.text(), finalUrl.href);
    const body = page.markdown;
    const file = pagePath(store.home, new URL(href));
    mkdirSync(dirname(file), { recursive: true });
    await Bun.write(
      file,
      `---\ntitle: ${JSON.stringify(page.title)}\nurl: ${href}\n---\n\n${body}\n`,
    );
    for (const link of page.links) {
      try {
        const url = new URL(link);
        if (keep(url, source, disallow))
          store.enqueue(url.href, source.name, null);
      } catch {}
    }
    return store.save(
      href,
      source.name,
      200,
      response.headers.get("etag"),
      page.title,
      body,
    );
  }
  store.save(href, source.name, -1, null);
}

/** Shallow-clone or update the documentation repositories and index their Markdown. */
export async function syncRepos(
  log: (line: string) => void = (line) => console.error(line),
): Promise<void> {
  const store = new DocsStore();
  try {
    for (const repo of DOC_REPOS) {
      const dir = join(store.home, "git", repo.replaceAll("/", "_"));
      const remote = `https://android.googlesource.com/${repo}`;
      const exists = await Bun.file(join(dir, ".git", "HEAD")).exists();
      const command = exists
        ? ["git", "-C", dir, "pull", "--depth=1", "--ff-only", "-q"]
        : ["git", "clone", "--depth=1", "--single-branch", "-q", remote, dir];
      if (!exists) mkdirSync(dirname(dir), { recursive: true });
      const proc = Bun.spawn(command, { stdout: "ignore", stderr: "inherit" });
      if ((await proc.exited) !== 0) {
        log(`${repo}: git failed`);
        continue;
      }
      let count = 0;
      for await (const file of new Bun.Glob("**/*.md").scan({
        cwd: dir,
        dot: false,
      })) {
        const path = relative(dir, join(dir, file)).replaceAll("\\", "/");
        const url = `${remote}/+/HEAD/${path}`;
        const text = await Bun.file(join(dir, file)).text();
        const title =
          text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? `${repo}/${path}`;
        store.enqueue(url, "aosp-git", null);
        store.save(url, "aosp-git", 200, null, title, text);
        count++;
      }
      log(`${repo}: ${count} Markdown files indexed`);
    }
  } finally {
    store.close();
  }
}

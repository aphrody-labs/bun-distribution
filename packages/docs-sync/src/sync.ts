import { rename, readdir, appendFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, sep, extname } from "node:path";

export type Source = { id: string; kind: string; [key: string]: unknown };
export type Topic = { id: string; title: string; sources: Source[] };
export type Config = {
  schemaVersion: number;
  concurrency: number;
  requestTimeoutMs: number;
  retries: number;
  maxFileBytes: number;
  maxCatalogEntries: number;
  freshnessHours: number;
  allowedHosts: string[];
  topics: Topic[];
};
type Item = {
  id: string;
  path: string;
  url?: string;
  local?: string;
  blob?: Blob;
  source: string;
  sourceRef?: string;
  expectedSha256?: string;
};
type RecordEntry = Omit<Item, "blob"> & {
  sha256: string;
  bytes: number;
  checkedAt: string;
  etag?: string;
  lastModified?: string;
  status: "ok" | "error";
  error?: string;
};
type Manifest = {
  schemaVersion: number;
  topic: string;
  title: string;
  status: string;
  catalogComplete: boolean;
  configHash: string;
  catalogHash: string;
  expected: number;
  succeeded: number;
  failed: number;
  syncedAt: string;
  sources: unknown[];
  errors: string[];
  files: RecordEntry[];
};
type Discovery = { items: Item[]; provenance: Record<string, unknown> };
type CacheEntry = {
  sha256: string;
  etag?: string;
  lastModified?: string;
  checkedAt: string;
  finalUrl: string;
};

export const sha256 = (data: string | Uint8Array | ArrayBuffer) =>
  new Bun.CryptoHasher("sha256").update(data).digest("hex");

export function inside(root: string, path: string): string {
  if (isAbsolute(path) || path.includes("\\") || path.split("/").some(part => part === ".." || part.includes(":")))
    throw new Error(`Unsafe documentation path: ${path}`);
  const full = resolve(root, path);
  if (full !== resolve(root) && !full.startsWith(resolve(root) + sep))
    throw new Error(`Path escapes documentation root: ${path}`);
  return full;
}

async function json<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await Bun.file(path).text());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export async function atomicWrite(path: string, data: Uint8Array | string) {
  const temp = `${path}.partial-${process.pid}-${crypto.randomUUID()}`;
  try {
    await Bun.write(temp, data);
    await rename(temp, path);
  } finally {
    await Bun.file(temp)
      .delete()
      .catch(() => {});
  }
}

const canonical = (url: string) => {
  const value = new URL(url);
  value.hash = "";
  value.search = "";
  return value.href;
};
const decodeXml = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
const safeId = (value: string) => {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) throw new Error(`Unsafe source/topic identifier: ${value}`);
  return value;
};
const stringify = (value: unknown) => JSON.stringify(value, null, 2) + "\n";

export class SyncEngine {
  readonly config: Config;
  readonly output: string;
  readonly checkout: string;
  readonly signal: AbortSignal;
  readonly testOrigins: string[];
  private shared = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

  constructor(
    config: Config,
    options: { output: string; checkout: string; signal?: AbortSignal; testOrigins?: string[] },
  ) {
    this.config = config;
    this.output = resolve(options.output);
    this.checkout = resolve(options.checkout);
    this.signal = options.signal ?? new AbortController().signal;
    this.testOrigins = options.testOrigins ?? [];
    if (config.schemaVersion !== 1 || config.concurrency < 1 || config.concurrency > 32)
      throw new Error("Invalid documentation sync configuration");
  }

  guardUrl(input: string): URL {
    const url = new URL(input);
    if (url.username || url.password) throw new Error("Credentials are forbidden in documentation URLs");
    if (
      !(url.protocol === "https:" && this.config.allowedHosts.includes(url.hostname)) &&
      !this.testOrigins.includes(url.origin)
    )
      throw new Error(`Unofficial or unsafe documentation origin: ${url.origin}`);
    return url;
  }

  private async response(input: string, headers: HeadersInit = {}): Promise<Response> {
    let url = this.guardUrl(input);
    for (let redirects = 0; redirects < 6; redirects++) {
      this.signal.throwIfAborted();
      const response = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": "AphrodyAndroidDocs/1.0", ...headers },
        signal: AbortSignal.any([this.signal, AbortSignal.timeout(this.config.requestTimeoutMs)]),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("Redirect without Location");
        url = this.guardUrl(new URL(location, url).href);
        continue;
      }
      return response;
    }
    throw new Error("Documentation redirect limit exceeded");
  }

  private async bytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
    if (Number(response.headers.get("content-length") ?? 0) > this.config.maxFileBytes) {
      await response.body?.cancel();
      throw new Error("Documentation response exceeds maxFileBytes");
    }
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        this.signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > this.config.maxFileBytes) throw new Error("Documentation response exceeds maxFileBytes");
        chunks.push(chunk.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    }
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  private async retry<T>(operation: () => Promise<T>): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      this.signal.throwIfAborted();
      try {
        return await operation();
      } catch (error) {
        last = error;
        if (this.signal.aborted) throw error;
      }
    }
    throw last;
  }

  async metadata(url: string): Promise<Uint8Array<ArrayBuffer>> {
    const existing = this.shared.get(url);
    if (existing) return existing;
    const loading = this.retry(async () => {
      const key = sha256(url);
      const cacheDir = inside(this.output, "autosync/cache");
      const path = inside(cacheDir, `${key}.body`);
      const metaPath = inside(cacheDir, `${key}.json`);
      const previous = await json<CacheEntry | null>(metaPath, null);
      let valid = false;
      if (previous) {
        try {
          valid = sha256(await Bun.file(path).bytes()) === previous.sha256;
        } catch {}
      }
      const headers: Record<string, string> = {};
      if (valid && previous?.etag) headers["If-None-Match"] = previous.etag;
      if (valid && previous?.lastModified) headers["If-Modified-Since"] = previous.lastModified;
      const response = await this.response(url, headers);
      const body =
        response.status === 304 && valid
          ? await Bun.file(path).bytes()
          : response.ok
            ? await this.bytes(response)
            : (() => {
                throw new Error(`HTTP ${response.status}: ${url}`);
              })();
      if (!body.length) throw new Error(`Empty documentation metadata: ${url}`);
      await atomicWrite(path, body);
      await atomicWrite(
        metaPath,
        stringify({
          sha256: sha256(body),
          etag: response.headers.get("etag") ?? previous?.etag,
          lastModified: response.headers.get("last-modified") ?? previous?.lastModified,
          checkedAt: new Date().toISOString(),
          finalUrl: response.url,
        }),
      );
      return body;
    });
    this.shared.set(url, loading);
    return loading;
  }

  private text(url: string) {
    return this.metadata(url).then(bytes => new TextDecoder().decode(bytes));
  }

  async sitemap(url: string): Promise<string[]> {
    const pending = [url];
    const visited = new Set<string>();
    const pages = new Set<string>();
    while (pending.length) {
      const next = pending.shift()!;
      if (visited.has(next)) continue;
      visited.add(next);
      let body = await this.metadata(next);
      if (next.endsWith(".gz")) body = Bun.gunzipSync(body);
      const xml = new TextDecoder().decode(body);
      if (/<!DOCTYPE/i.test(xml) || !/<(?:sitemapindex|urlset)(?:\s|>)/.test(xml))
        throw new Error(`Invalid sitemap document: ${next}`);
      const locations = [...xml.matchAll(/<loc>(.*?)<\/loc>/gs)].map(match => decodeXml(match[1].trim()));
      if (!locations.length) throw new Error(`Empty sitemap: ${next}`);
      if (/<sitemapindex(?:\s|>)/.test(xml)) {
        for (const child of locations) {
          this.guardUrl(child);
          pending.push(child);
        }
      } else
        for (const page of locations) {
          this.guardUrl(page);
          pages.add(canonical(page));
        }
      if (this.config.maxCatalogEntries > 0 && pages.size > this.config.maxCatalogEntries)
        throw new Error("Sitemap exceeds explicitly configured catalogue limit; catalogue incomplete");
    }
    return [...pages].sort();
  }

  private item(source: Source, url: string, path?: string, ref?: string): Item {
    this.guardUrl(url);
    const u = new URL(url);
    const sourcePath =
      path ??
      `${u.pathname.replace(/^\//, "").replace(/\/$/, "/index") || "index"}${extname(u.pathname) ? "" : ".html"}`;
    inside(this.output, `${safeId(source.id)}/${sourcePath}`);
    return {
      id: `${source.id}:${url}`,
      source: source.id,
      path: `${source.id}/${sourcePath}`,
      url,
      sourceRef: ref,
    };
  }

  private async walk(directory: string): Promise<string[]> {
    const result: string[] = [];
    const pending = [directory];
    while (pending.length) {
      this.signal.throwIfAborted();
      const current = pending.pop()!;
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const path = resolve(current, entry.name);
        if (entry.isSymbolicLink())
          throw new Error(`Symlink in documentation source is not copied: ${relative(directory, path)}`);
        if (entry.isDirectory()) pending.push(path);
        else if (entry.isFile()) result.push(path);
      }
    }
    return result.sort();
  }

  async discover(source: Source): Promise<Discovery> {
    safeId(source.id);
    this.signal.throwIfAborted();
    if (source.kind === "local-bun") {
      const directory = inside(this.checkout, String(source.directory));
      const child = Bun.spawn(["git", "-C", this.checkout, "rev-parse", "HEAD"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const revision = (await new Response(child.stdout).text()).trim();
      if (await child.exited) throw new Error("Cannot resolve owner Bun checkout revision");
      const status = Bun.spawn(["git", "-C", this.checkout, "status", "--porcelain", "--", String(source.directory)], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const changes = (await new Response(status.stdout).text()).trim();
      if (await status.exited) throw new Error("Cannot inspect owner Bun documentation state");
      const paths = await this.walk(directory);
      return {
        items: paths.map(path => ({
          id: `${source.id}:${relative(directory, path).replaceAll("\\", "/")}`,
          source: source.id,
          path: `${source.id}/${relative(directory, path).replaceAll("\\", "/")}`,
          local: path,
          sourceRef: revision,
        })),
        provenance: {
          id: source.id,
          kind: source.kind,
          revision,
          workingTreeModified: !!changes,
          scope: String(source.directory),
          catalogueComplete: true,
          count: paths.length,
        },
      };
    }
    if (source.kind === "llms") {
      const catalog = await this.text(String(source.url));
      const filter = new RegExp(String(source.include));
      const urls = [
        ...new Set(
          [...catalog.matchAll(/https:\/\/[^\s<>()[\]]+/g)].map(match => match[0]).filter(url => filter.test(url)),
        ),
      ].sort();
      if (!urls.length) throw new Error("LLMS catalogue contains no documentation URLs");
      const items = urls.map(url => this.item(source, url));
      if (source.fullTextUrl) items.push(this.item(source, String(source.fullTextUrl), "llms-full.txt"));
      return {
        items,
        provenance: {
          id: source.id,
          kind: source.kind,
          catalogueUrl: source.url,
          catalogueSha256: sha256(catalog),
          count: items.length,
          catalogueComplete: true,
        },
      };
    }
    if (source.kind === "sitemap") {
      const all = await this.sitemap(String(source.url));
      const filter = new RegExp(String(source.include));
      const selected = all.filter(url => filter.test(url));
      if (!selected.length) throw new Error(`No sitemap URLs match ${source.id}`);
      return {
        items: selected.map(url => this.item(source, source.query ? `${url}?${source.query}` : url)),
        provenance: {
          id: source.id,
          kind: source.kind,
          catalogueUrl: source.url,
          sitemapCanonicalCount: all.length,
          selectedCount: selected.length,
          include: source.include,
          catalogueComplete: true,
        },
      };
    }
    if (source.kind === "html-crawl" || source.kind === "oracle-guides") {
      let root = String(source.url);
      let version: number | undefined;
      if (source.kind === "oracle-guides") {
        const release = JSON.parse(await this.text(String(source.releaseInfoUrl)));
        version = Number(release.most_recent_feature_release);
        if (!Number.isInteger(version)) throw new Error("Invalid Java feature version for guide catalogue");
        root = String(source.urlTemplate).replace("{version}", String(version));
      }
      const base = this.guardUrl(root);
      const prefix = base.pathname;
      const exclude = source.exclude ? new RegExp(String(source.exclude)) : undefined;
      const pending = [base.href];
      const visited = new Set<string>();
      const items: Item[] = [];
      while (pending.length) {
        this.signal.throwIfAborted();
        const url = canonical(pending.shift()!);
        if (visited.has(url)) continue;
        visited.add(url);
        const body = await this.metadata(url);
        const html = new TextDecoder().decode(body);
        if (!/<html(?:\s|>)/i.test(html)) throw new Error(`Official guide route returned no HTML document: ${url}`);
        const item = this.item(source, url);
        item.blob = new Blob([body]);
        items.push(item);
        for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
          try {
            const link = new URL(decodeXml(match[1]), url);
            if (
              link.origin !== base.origin ||
              !link.pathname.startsWith(prefix) ||
              (exclude && exclude.test(link.pathname))
            )
              continue;
            if (!/(?:\/|\.html?)$/.test(link.pathname) && extname(link.pathname)) continue;
            const normalized = canonical(link.href);
            if (!visited.has(normalized)) pending.push(normalized);
          } catch {}
        }
      }
      return {
        items,
        provenance: {
          id: source.id,
          kind: source.kind,
          root: base.href,
          version,
          prefix,
          exclude: source.exclude,
          count: items.length,
          catalogueComplete: true,
          scope: "All official HTML documents reachable from the topic root within its declared prefix",
        },
      };
    }
    if (source.kind === "github-tree") {
      const repo = String(source.repository);
      const ref = String(source.ref);
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("Invalid official repository identifier");
      const commit = JSON.parse(
        await this.text(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`),
      );
      if (!commit.sha || !commit.commit?.tree?.sha) throw new Error("GitHub commit has no immutable tree");
      let treeSha = commit.commit.tree.sha;
      let prefix = "";
      if (source.directory)
        for (const segment of String(source.directory).split("/")) {
          const tree = JSON.parse(await this.text(`https://api.github.com/repos/${repo}/git/trees/${treeSha}`));
          if (tree.truncated) throw new Error("Non-recursive GitHub tree unexpectedly truncated");
          const entry = tree.tree?.find(
            (item: { path: string; type: string }) => item.path === segment && item.type === "tree",
          );
          if (!entry) throw new Error(`Missing GitHub documentation directory: ${segment}`);
          treeSha = entry.sha;
          prefix += `${segment}/`;
        }
      const pending = [{ sha: treeSha, prefix }];
      const files: { path: string; sha: string }[] = [];
      while (pending.length) {
        const node = pending.pop()!;
        const tree = JSON.parse(
          await this.text(`https://api.github.com/repos/${repo}/git/trees/${node.sha}?recursive=1`),
        );
        if (!Array.isArray(tree.tree)) throw new Error("GitHub returned no tree entries");
        if (tree.truncated) {
          const shallow = JSON.parse(await this.text(`https://api.github.com/repos/${repo}/git/trees/${node.sha}`));
          if (shallow.truncated || !Array.isArray(shallow.tree))
            throw new Error("GitHub subtree catalog cannot be proven complete");
          for (const entry of shallow.tree) {
            if (entry.type === "tree") pending.push({ sha: entry.sha, prefix: `${node.prefix}${entry.path}/` });
            else if (entry.type === "blob") files.push({ path: node.prefix + entry.path, sha: entry.sha });
          }
        } else
          for (const entry of tree.tree)
            if (entry.type === "blob") files.push({ path: node.prefix + entry.path, sha: entry.sha });
      }
      const include = new RegExp(String(source.include));
      const extensions = source.extensions as string[] | undefined;
      const selected = files.filter(
        file => include.test(file.path) && (!extensions || extensions.includes(extname(file.path))),
      );
      if (!selected.length) throw new Error("Official GitHub documentation catalogue is empty");
      return {
        items: selected.map(file =>
          this.item(
            source,
            `https://raw.githubusercontent.com/${repo}/${commit.sha}/${file.path}`,
            file.path,
            commit.sha,
          ),
        ),
        provenance: {
          id: source.id,
          kind: source.kind,
          repository: repo,
          revision: commit.sha,
          commitDate: commit.commit.committer.date,
          include: source.include,
          count: selected.length,
          catalogueComplete: true,
          truncatedTreesExpanded: true,
        },
      };
    }
    if (source.kind === "rust-dist" || source.kind === "java-docs") {
      let url: string;
      let expectedHash: string | undefined;
      let release: string;
      let metadata: string;
      if (source.kind === "rust-dist") {
        metadata = `https://static.rust-lang.org/dist/channel-rust-${source.channel}.toml`;
        const manifest = Bun.TOML.parse(await this.text(metadata)) as {
          date: string;
          pkg: {
            "rust-docs": {
              version: string;
              target: Record<string, { available: boolean; url: string; hash: string }>;
            };
          };
        };
        const docs = manifest.pkg["rust-docs"];
        const target = docs.target[String(source.platform)];
        if (!target?.available)
          throw new Error("Official Rust documentation distribution is unavailable for this channel/platform");
        url = target.url;
        expectedHash = target.hash;
        release = `${docs.version} (${manifest.date})`;
      } else {
        const info = JSON.parse(await this.text(String(source.releaseInfoUrl)));
        const version = Number(info.most_recent_feature_release);
        if (!Number.isInteger(version) || version < 21) throw new Error("Invalid latest Java feature release");
        metadata = String(source.pageTemplate).replace("{version}", String(version));
        const page = await this.text(metadata);
        const candidates = [...page.matchAll(/https:\/\/download\.oracle\.com\/[^\s"<>]+?\.zip/g)].map(match =>
          decodeXml(match[0]),
        );
        const selected = candidates.find(candidate =>
          decodeURIComponent(candidate).includes(`jdk-${version}_doc-all.zip`),
        );
        if (!selected)
          throw new Error("Oracle latest Java documentation archive not found on the official download page");
        url = selected;
        release = `Java SE ${version}`;
      }
      console.log(`Archive ${source.id}: downloading/verifying ${release}`);
      const bytes = await this.metadata(url);
      const archiveHash = sha256(bytes);
      if (expectedHash && archiveHash !== expectedHash)
        throw new Error("Official documentation archive checksum mismatch");
      const archive = new Bun.Archive(bytes);
      const files = await archive.files();
      const items: Item[] = [];
      for (const [name, blob] of files) {
        let path = name;
        if (source.archivePathMarker) {
          const index = name.indexOf(String(source.archivePathMarker));
          if (index < 0) continue;
          path = name.slice(index + String(source.archivePathMarker).length);
        }
        if (!path || path.endsWith("/")) continue;
        inside(this.output, `${source.id}/${path}`);
        items.push({
          id: `${source.id}:${path}`,
          source: source.id,
          path: `${source.id}/${path}`,
          blob,
          url,
          sourceRef: archiveHash,
        });
      }
      if (!items.length) throw new Error("Official documentation archive contains no matching documentation files");
      return {
        items,
        provenance: {
          id: source.id,
          kind: source.kind,
          release,
          url,
          metadataUrl: metadata,
          sha256: archiveHash,
          publisherDigestVerified: !!expectedHash,
          count: items.length,
          catalogueComplete: true,
        },
      };
    }
    if (source.kind === "material-carbon") {
      const home = await this.text("https://m3.material.io/");
      const mainPath = home.match(/(?:src|href)=["']([^"']*main\.[^"']+\.js)["']/)?.[1];
      if (!mainPath) throw new Error("Material official Angular main bundle not found");
      const mainUrl = new URL(mainPath, "https://m3.material.io/").href;
      const script = await this.text(mainUrl);
      const version = script.match(/carbonVersion:["']([^"']+)["']/)?.[1];
      if (!version) throw new Error("Material official Carbon content version not found");
      const moduleIndex = script.indexOf("2353:J=>");
      const encoded = (moduleIndex < 0 ? script : script.slice(moduleIndex)).match(
        /J\.exports=JSON\.parse\('((?:\\.|[^'])*)'\)/,
      )?.[1];
      if (!encoded)
        throw new Error("Material official route JSON module not found; refusing incomplete regex route catalogue");
      const routes = JSON.parse(Bun.JSON5.parse(`'${encoded}'`) as string) as {
        v: { slug: string; exportedCarbonFileId: string | null }[];
        Z: { slug: string; exportedCarbonFileId: string | null }[];
      };
      if (!Array.isArray(routes.v) || !Array.isArray(routes.Z))
        throw new Error("Material official route catalogue schema changed");
      const routeEntries = [...routes.v, ...routes.Z].map(route => ({
        slug: route.slug.replace(/^\//, ""),
        file: route.exportedCarbonFileId,
      }));
      const routeFiles = [...new Set(routeEntries.map(route => route.file).filter((file): file is string => !!file))];
      if (!routeFiles.length) throw new Error("Material official content catalogue is empty");
      const items = routeFiles.map(file =>
        this.item(source, `https://m3.material.io/_dsm/content/m3/${version}/${file}`, `articles/${file}`, version),
      );
      const legacy = new Map<string, string>();
      const visitLegacy = (value: unknown) => {
        if (Array.isArray(value)) {
          value.forEach(visitLegacy);
          return;
        }
        if (!value || typeof value !== "object") return;
        const object = value as Record<string, unknown>;
        if (
          typeof object.slug === "string" &&
          (typeof object.document_id === "string" || typeof object.document_id === "number")
        )
          legacy.set(object.slug.replace(/^\//, ""), String(object.document_id));
        Object.values(object).forEach(visitLegacy);
      };
      for (const match of script.matchAll(/JSON\.parse\('((?:\\.|[^'])*)'\)/g)) {
        try {
          visitLegacy(JSON.parse(Bun.JSON5.parse(`'${match[1]}'`) as string));
        } catch {}
      }
      for (const id of legacy.values())
        items.push(
          this.item(source, `https://m3.material.io/page-data/Posts/${id}.json`, `legacy-blog/${id}.json`, version),
        );
      if (!legacy.size) throw new Error("Material legacy blog catalogue was not found; blog documentation incomplete");
      const sitemap = await this.sitemap("https://m3.material.io/sitemap.xml");
      const coverage = sitemap.map(url => {
        const path = new URL(url).pathname.replace(/^\/|\/$/g, "");
        if (["get-started", "search.html", "blog/get-started", "blog/search.html"].includes(path))
          return { url, kind: "interactive-navigation", document: null };
        const legacySlug = path.replace(/^blog\//, "");
        const legacyId = legacy.get(path) ?? legacy.get(legacySlug);
        if (legacyId) return { url, kind: "legacy-blog", document: `legacy-blog/${legacyId}.json` };
        const route = routeEntries
          .filter(
            route =>
              route.file &&
              (route.slug === path ||
                (route.slug && path.startsWith(route.slug + "/")) ||
                (path && route.slug === `blog/${path}`)),
          )
          .sort((a, b) => b.slug.length - a.slug.length)[0];
        const homeRoute = !path ? routeEntries.find(route => !route.slug && route.file) : undefined;
        return { url, kind: "carbon", document: route?.file ?? homeRoute?.file ?? null };
      });
      const unmapped = coverage.filter(route => !route.document && route.kind !== "interactive-navigation");
      if (unmapped.length)
        throw new Error(`Material sitemap has unmapped routes: ${unmapped.map(route => route.url).join(", ")}`);
      const datasets = new Set<string>();
      const visitData = (value: unknown) => {
        if (Array.isArray(value)) {
          value.forEach(visitData);
          return;
        }
        if (!value || typeof value !== "object") return;
        const object = value as Record<string, unknown>;
        const type = object.libraryModuleType;
        const resource = object.resourceName;
        if (typeof type === "string" && typeof resource === "string" && resource) {
          let filename: string;
          if (type === "STATUS_TABLE") filename = resource.replaceAll("/", "_") + ".json";
          else if (type === "TOKEN_TABLE") filename = `${type}.${resource.split("components/")[1]}.json`;
          else filename = `${type}.${resource.split("/")[1]}.json`;
          if (filename.includes("undefined")) throw new Error("Material DSDB resource schema changed");
          datasets.add(`https://m3.material.io/_dsm/data/dsdb-m3/${version}/${filename}`);
        }
        Object.values(object).forEach(visitData);
      };
      for (const item of items) {
        const body = await this.metadata(item.url!);
        item.blob = new Blob([body]);
        visitData(JSON.parse(new TextDecoder().decode(body)));
      }
      for (const url of datasets)
        items.push(this.item(source, url, `datasets/${new URL(url).pathname.split("/").at(-1)}`, version));
      items.push(this.item(source, mainUrl, "catalog/main.js", version));
      items.push(this.item(source, "https://m3.material.io/sitemap.xml", "catalog/sitemap.xml", version));
      const routeManifest = new Blob([
        stringify({
          contentVersion: version,
          routeEntries,
          legacy: Object.fromEntries(legacy),
          coverage,
          datasets: [...datasets],
        }),
      ]);
      items.push({
        id: `${source.id}:route-map`,
        source: source.id,
        path: `${source.id}/catalog/routes.json`,
        url: mainUrl,
        sourceRef: version,
        blob: routeManifest,
      });
      return {
        items,
        provenance: {
          id: source.id,
          kind: source.kind,
          contentVersion: version,
          mainUrl,
          routeCount: routeEntries.length,
          carbonArticles: routeFiles.length,
          legacyArticles: legacy.size,
          sitemapRoutes: sitemap.length,
          coverageComplete: true,
          datasets: datasets.size,
          catalogueComplete: true,
          staticShellsAreNotArticles: true,
        },
      };
    }
    throw new Error(`Unsupported official documentation source: ${source.kind}`);
  }

  private async save(topicDirectory: string, item: Item, previous?: RecordEntry): Promise<RecordEntry> {
    const path = inside(topicDirectory, `content/${item.path}`);
    const checkedAt = new Date().toISOString();
    let valid = false;
    if (previous?.status === "ok") {
      try {
        const existing = await Bun.file(path).bytes();
        valid = existing.length === previous.bytes && sha256(existing) === previous.sha256;
      } catch {}
    }
    if (item.blob || item.local) {
      const body = item.blob ? new Uint8Array(await item.blob.arrayBuffer()) : await Bun.file(item.local!).bytes();
      const hash = sha256(body);
      if (!valid || previous?.sha256 !== hash) await atomicWrite(path, body);
      const { blob: _blob, ...identity } = item;
      return { ...identity, sha256: hash, bytes: body.length, checkedAt, status: "ok" };
    }
    if (
      valid &&
      previous &&
      previous.url === item.url &&
      previous.sourceRef === item.sourceRef &&
      Date.now() - Date.parse(previous.checkedAt) < this.config.freshnessHours * 3600000
    )
      return { ...previous, ...item, checkedAt: previous.checkedAt };
    return this.retry(async () => {
      const headers: Record<string, string> = {};
      if (valid && previous && previous.url === item.url && previous.etag) headers["If-None-Match"] = previous.etag;
      if (valid && previous && previous.url === item.url && previous.lastModified)
        headers["If-Modified-Since"] = previous.lastModified;
      const response = await this.response(item.url!, headers);
      if (response.status === 304 && valid && previous) return { ...previous, ...item, checkedAt, status: "ok" };
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${item.url}`);
      const body = await this.bytes(response);
      if (!body.length) throw new Error(`Empty official documentation: ${item.url}`);
      const hash = sha256(body);
      if (item.expectedSha256 && item.expectedSha256 !== hash) throw new Error("Official document checksum mismatch");
      await atomicWrite(path, body);
      return {
        ...item,
        sha256: hash,
        bytes: body.length,
        checkedAt,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        status: "ok",
      };
    });
  }

  async syncTopic(topic: Topic): Promise<Manifest> {
    const directory = inside(this.output, safeId(topic.id));
    await Bun.$`mkdir -p ${directory}`.quiet();
    const previous = await json<Manifest | null>(inside(directory, "manifest.json"), null);
    const records = new Map((previous?.files ?? []).map(item => [item.id, item]));
    const progressPath = inside(directory, "progress.jsonl");
    try {
      for (const line of (await Bun.file(progressPath).text()).split("\n").filter(Boolean)) {
        try {
          const record = JSON.parse(line) as RecordEntry;
          records.set(record.id, record);
        } catch {}
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const items: Item[] = [];
    const provenance: unknown[] = [];
    const errors: string[] = [];
    let catalogComplete = true;
    for (const source of topic.sources) {
      try {
        const discovery = await this.discover(source);
        items.push(...discovery.items);
        provenance.push(discovery.provenance);
        console.log(`Catalogue ${topic.id}/${source.id}: ${discovery.items.length} entries`);
      } catch (error) {
        catalogComplete = false;
        errors.push(`${source.id}: ${String(error)}`);
        provenance.push({ id: source.id, catalogueComplete: false, error: String(error) });
        if (this.signal.aborted) break;
      }
    }
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const item of items) {
      if (ids.has(item.id) || paths.has(item.path)) {
        catalogComplete = false;
        errors.push(`Duplicate catalogue identity or path: ${item.path}`);
      }
      ids.add(item.id);
      paths.add(item.path);
    }
    const catalogHash = sha256(
      stringify(
        items
          .map(({ id, path, url, sourceRef }) => ({ id, path, url, sourceRef }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    );
    const completed: RecordEntry[] = [];
    let position = 0;
    const worker = async () => {
      while (position < items.length && !this.signal.aborted) {
        const item = items[position++];
        let record: RecordEntry;
        try {
          record = await this.save(directory, item, records.get(item.id));
        } catch (error) {
          const { blob: _blob, ...identity } = item;
          record = {
            ...identity,
            sha256: records.get(item.id)?.sha256 ?? "",
            bytes: records.get(item.id)?.bytes ?? 0,
            checkedAt: new Date().toISOString(),
            status: "error",
            error: String(error),
          };
        }
        completed.push(record);
        await appendFile(progressPath, JSON.stringify(record) + "\n");
        if (completed.length % 200 === 0)
          console.log(
            `Progress ${topic.id}: ${completed.length}/${items.length}, failures=${completed.filter(item => item.status === "error").length}`,
          );
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.config.concurrency, items.length) }, worker));
    const succeeded = completed.filter(item => item.status === "ok").length;
    if (this.signal.aborted) errors.push(`Run interrupted: ${String(this.signal.reason)}`);
    const status =
      catalogComplete && items.length > 0 && succeeded === items.length && !errors.length ? "complete" : "incomplete";
    const manifest: Manifest = {
      schemaVersion: 1,
      topic: topic.id,
      title: topic.title,
      status,
      catalogComplete,
      configHash: sha256(stringify(topic)),
      catalogHash,
      expected: items.length,
      succeeded,
      failed: completed.filter(item => item.status === "error").length + (items.length - completed.length),
      syncedAt: new Date().toISOString(),
      sources: provenance,
      errors,
      files: completed.sort((a, b) => a.id.localeCompare(b.id)),
    };
    if (status === "complete") {
      for (const old of previous?.files ?? [])
        if (!paths.has(old.path))
          await Bun.file(inside(directory, `content/${old.path}`))
            .delete()
            .catch(() => {});
    } else
      for (const old of previous?.files ?? [])
        if (!completed.some(item => item.id === old.id)) manifest.files.push(old);
    await atomicWrite(inside(directory, "manifest.json"), stringify(manifest));
    if (status === "complete")
      await Bun.file(progressPath)
        .delete()
        .catch(() => {});
    console.log(`Topic ${topic.id}: ${status} (${succeeded}/${items.length})`);
    return manifest;
  }

  async check(topic: Topic): Promise<{ topic: string; ok: boolean; expected: number; errors: string[] }> {
    const directory = inside(this.output, safeId(topic.id));
    const manifest = await json<Manifest | null>(inside(directory, "manifest.json"), null);
    const errors: string[] = [];
    if (!manifest)
      return {
        topic: topic.id,
        ok: false,
        expected: 0,
        errors: ["No authoritative synchronization manifest"],
      };
    if (manifest.configHash !== sha256(stringify(topic)))
      errors.push("Current official source configuration differs from the synchronized catalogue");
    if (
      manifest.status !== "complete" ||
      !manifest.catalogComplete ||
      !manifest.expected ||
      manifest.failed ||
      manifest.succeeded !== manifest.expected ||
      manifest.files.length !== manifest.expected
    )
      errors.push("Official catalogue or downloaded corpus is incomplete");
    if (Date.now() - Date.parse(manifest.syncedAt) > this.config.freshnessHours * 3600000)
      errors.push("Official catalogue freshness deadline exceeded");
    const identities = new Set<string>();
    for (const file of manifest.files) {
      this.signal.throwIfAborted();
      if (identities.has(file.id)) errors.push(`Duplicate manifest identity: ${file.id}`);
      identities.add(file.id);
      if (file.status !== "ok") {
        errors.push(`Failed document: ${file.path}`);
        continue;
      }
      if (Date.now() - Date.parse(file.checkedAt) > this.config.freshnessHours * 3600000)
        errors.push(`Document freshness deadline exceeded: ${file.path}`);
      try {
        const bytes = await Bun.file(inside(directory, `content/${file.path}`)).bytes();
        if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256)
          errors.push(`Missing or corrupted document: ${file.path}`);
      } catch {
        errors.push(`Missing or unreadable document: ${file.path}`);
      }
    }
    const hash = sha256(
      stringify(
        manifest.files
          .map(({ id, path, url, sourceRef }) => ({ id, path, url, sourceRef }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    );
    if (hash !== manifest.catalogHash) errors.push("Manifest does not cover the synchronized catalogue hash");
    return { topic: topic.id, ok: !errors.length, expected: manifest.expected, errors };
  }
}

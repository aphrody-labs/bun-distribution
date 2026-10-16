// SPDX-License-Identifier: Apache-2.0
/**
 * Reads a target without changing it: a deployed site (`probeUrl`) or a project directory
 * (`probeDirectory`). The result feeds `planConversion`; nothing here writes outside `os.tmpdir`.
 */
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { originOf } from "./policy.ts";
import {
  detectApis,
  detectFrameworks,
  detectEmbeds,
  detectIdps,
  detectProxyPrefixes,
  extractOrigins,
  extractUrls,
  parseSetCookies,
} from "./signals.ts";
import type {
  ApiSignal,
  DirectoryProbe,
  IconRef,
  ManifestInfo,
  RedirectHop,
  SiteProbe,
} from "./types.ts";

export interface ProbeOptions {
  fetch?: typeof fetch;
  /** Per request. */
  timeoutMs?: number;
  maxRedirects?: number;
  maxHtmlBytes?: number;
  maxScripts?: number;
  maxScriptBytes?: number;
  userAgent?: string;
}

export class ProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProbeError";
  }
}

const DEFAULTS = {
  timeoutMs: 15_000,
  maxRedirects: 10,
  maxHtmlBytes: 2_000_000,
  maxScripts: 12,
  maxScriptBytes: 1_500_000,
  userAgent:
    "Mozilla/5.0 (compatible; aphrody-web-to-tauri/1; +https://github.com/aphrody-code)",
} as const;

/** Adds `https://` to a bare host and rejects every scheme but http(s). */
export function normalizeTarget(input: string): URL {
  const text = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
    ? input
    : `https://${input}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ProbeError(`not a URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ProbeError(
      `only http and https targets can be probed, got ${url.protocol}`,
    );
  }
  return url;
}

async function readCapped(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(total, max));
  let offset = 0;
  for (const chunk of chunks) {
    const room = bytes.length - offset;
    if (room <= 0) break;
    bytes.set(chunk.subarray(0, room), offset);
    offset += Math.min(chunk.byteLength, room);
  }
  return new TextDecoder().decode(bytes);
}

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key !== "set-cookie") out[key.toLowerCase()] = value;
  });
  return out;
}

interface HtmlFacts {
  title: string | null;
  lang: string | null;
  description: string | null;
  themeColor: string | null;
  manifestHref: string | null;
  icons: IconRef[];
  scripts: { src: string | null; inline: string }[];
  links: string[];
  popupLinks: number;
  formActions: string[];
  frames: string[];
}

async function readHtml(html: string): Promise<HtmlFacts> {
  const facts: HtmlFacts = {
    title: null,
    lang: null,
    description: null,
    themeColor: null,
    manifestHref: null,
    icons: [],
    scripts: [],
    links: [],
    popupLinks: 0,
    formActions: [],
    frames: [],
  };
  let title = "";
  let inline = "";
  const rewriter = new HTMLRewriter()
    .on("html", {
      element(el) {
        facts.lang = el.getAttribute("lang");
      },
    })
    .on("title", {
      text(chunk) {
        title += chunk.text;
      },
    })
    .on("meta", {
      element(el) {
        const name = (el.getAttribute("name") ?? "").toLowerCase();
        if (name === "description")
          facts.description = el.getAttribute("content");
        if (name === "theme-color")
          facts.themeColor ??= el.getAttribute("content");
      },
    })
    .on("link", {
      element(el) {
        const rel = (el.getAttribute("rel") ?? "").toLowerCase();
        const href = el.getAttribute("href");
        if (!href) return;
        if (rel.split(/\s+/).includes("manifest")) facts.manifestHref = href;
        if (/\bicon\b/.test(rel)) {
          facts.icons.push({
            href,
            rel,
            sizes: el.getAttribute("sizes"),
            type: el.getAttribute("type"),
          });
        }
      },
    })
    .on("script", {
      element(el) {
        inline = "";
        const src = el.getAttribute("src");
        const entry = { src, inline: "" };
        facts.scripts.push(entry);
        el.onEndTag(() => {
          entry.inline = inline;
        });
      },
      text(chunk) {
        inline += chunk.text;
      },
    })
    .on("a[href]", {
      element(el) {
        const href = el.getAttribute("href");
        if (href) facts.links.push(href);
        if ((el.getAttribute("target") ?? "").toLowerCase() === "_blank")
          facts.popupLinks += 1;
      },
    })
    .on("form[action]", {
      element(el) {
        const value = el.getAttribute("action");
        if (value) facts.formActions.push(value);
      },
    })
    .on("iframe[src]", {
      element(el) {
        const value = el.getAttribute("src");
        if (value) facts.frames.push(value);
      },
    });
  await rewriter.transform(new Response(html)).text();
  facts.title = title.trim() || null;
  return facts;
}

const ASSET_EXT =
  /\.(?:png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|map|json|xml|pdf|zip|gz|mp[34]|webm|woff2?|ttf|otf)$/i;

const lastTwoLabels = (host: string) => host.split(".").slice(-2).join(".");

function sameSiteHost(a: string, b: string): boolean {
  return a === b || lastTwoLabels(a) === lastTwoLabels(b);
}

/** `new URL(value, base)` that answers `null` instead of throwing. */
function resolve(value: string, base: URL): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

/** Probes a deployed site. Never follows more than `maxRedirects`, never sends cookies or credentials. */
export async function probeUrl(
  input: string,
  options: ProbeOptions = {},
): Promise<SiteProbe> {
  const opts = { ...DEFAULTS, ...options };
  const doFetch = options.fetch ?? fetch;
  const warnings: string[] = [];

  const request = async (target: URL, accept: string): Promise<Response> => {
    const signal = AbortSignal.timeout(opts.timeoutMs);
    return doFetch(target, {
      redirect: "manual",
      signal,
      headers: {
        "user-agent": opts.userAgent,
        accept,
        "accept-language": "en",
      },
    });
  };

  let current = normalizeTarget(input);
  const redirects: RedirectHop[] = [];
  let response: Response | undefined;
  for (let hop = 0; hop <= opts.maxRedirects; hop += 1) {
    try {
      response = await request(
        current,
        "text/html,application/xhtml+xml,*/*;q=0.8",
      );
    } catch (error) {
      throw new ProbeError(
        `${current.href} is unreachable: ${error instanceof Error ? error.message : error}`,
      );
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      redirects.push({ url: current.href, status: response.status, location });
      await response.body?.cancel().catch(() => undefined);
      try {
        current = new URL(location, current);
      } catch {
        throw new ProbeError(
          `invalid redirect target from ${current.href}: ${location}`,
        );
      }
      continue;
    }
    break;
  }
  if (!response) throw new ProbeError(`no response from ${input}`);
  if (response.status >= 300 && response.status < 400) {
    warnings.push(`redirect chain longer than ${opts.maxRedirects}`);
  }
  if (response.status >= 400)
    warnings.push(`start page answered HTTP ${response.status}`);

  const finalUrl = current;
  const headers = headerRecord(response.headers);
  const cookies = parseSetCookies(response.headers.getSetCookie());
  const contentType = headers["content-type"] ?? "";
  const isHtml = /html/i.test(contentType) || contentType === "";
  const html = isHtml ? await readCapped(response, opts.maxHtmlBytes) : "";
  if (!isHtml) {
    await response.body?.cancel().catch(() => undefined);
    warnings.push(
      `start page is ${contentType || "not HTML"}; nothing to inspect`,
    );
  }
  const facts = html ? await readHtml(html) : await readHtml("");

  // Manifest.
  let manifest: ManifestInfo | null = null;
  if (facts.manifestHref) {
    const manifestUrl = resolve(facts.manifestHref, finalUrl);
    if (manifestUrl) {
      try {
        const res = await request(
          manifestUrl,
          "application/manifest+json,application/json",
        );
        const raw = JSON.parse(await readCapped(res, 200_000)) as Record<
          string,
          unknown
        >;
        const icons = Array.isArray(raw.icons) ? raw.icons : [];
        manifest = {
          url: manifestUrl.href,
          name: typeof raw.name === "string" ? raw.name : null,
          shortName: typeof raw.short_name === "string" ? raw.short_name : null,
          startUrl: typeof raw.start_url === "string" ? raw.start_url : null,
          scope: typeof raw.scope === "string" ? raw.scope : null,
          display: typeof raw.display === "string" ? raw.display : null,
          themeColor:
            typeof raw.theme_color === "string" ? raw.theme_color : null,
          backgroundColor:
            typeof raw.background_color === "string"
              ? raw.background_color
              : null,
          icons: icons
            .filter(
              (icon): icon is Record<string, unknown> =>
                typeof icon === "object" &&
                icon !== null &&
                typeof (icon as { src?: unknown }).src === "string",
            )
            .map((icon) => ({
              href: new URL(String(icon.src), manifestUrl).href,
              rel: "manifest-icon",
              sizes: typeof icon.sizes === "string" ? icon.sizes : null,
              type: typeof icon.type === "string" ? icon.type : null,
            })),
          hasShareTarget:
            typeof raw.share_target === "object" && raw.share_target !== null,
          hasProtocolHandlers:
            Array.isArray(raw.protocol_handlers) &&
            raw.protocol_handlers.length > 0,
        };
      } catch (error) {
        warnings.push(
          `manifest ${manifestUrl.href} unreadable: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  // Scripts: inline text plus the first same-site files, scanned for browser APIs and origins.
  const signals: ApiSignal[] = [];
  const addSignals = (text: string, where: string) => {
    for (const id of detectApis(text)) {
      if (!signals.some((signal) => signal.id === id))
        signals.push({ id, where });
    }
  };
  addSignals(html, finalUrl.href);
  let scanned = 0;
  let scriptText = "";
  const origins = new Set<string>([finalUrl.origin]);
  // Full URLs the page points at (links included) feed sign-in detection; the ones it loads
  // (frames, scripts) feed embed detection. A link to youtube.com is not an embed.
  const pointedAt = new Set<string>(extractUrls(html));
  const loaded = new Set<string>();
  for (const origin of extractOrigins(html)) origins.add(origin);
  for (const hop of redirects) {
    for (const value of [hop.url, hop.location]) {
      const origin = value ? originOf(new URL(value, finalUrl)) : null;
      if (origin) origins.add(origin);
      if (value) pointedAt.add(new URL(value, finalUrl).href);
    }
  }
  // The links of the page: sign-in buttons are anchors.
  for (const href of facts.links) {
    const url = resolve(href, finalUrl);
    if (url && (url.protocol === "https:" || url.protocol === "http:"))
      pointedAt.add(url.href);
  }
  for (const script of facts.scripts) {
    if (script.inline) {
      scriptText += `\n${script.inline}`;
      addSignals(script.inline, `${finalUrl.href} (inline)`);
      for (const origin of extractOrigins(script.inline)) origins.add(origin);
      for (const url of extractUrls(script.inline)) {
        pointedAt.add(url);
        loaded.add(url);
      }
    }
  }
  const external = facts.scripts
    .map((script) => (script.src ? resolve(script.src, finalUrl) : null))
    .filter(
      (url): url is URL =>
        url !== null && (url.protocol === "https:" || url.protocol === "http:"),
    );
  for (const url of external) {
    origins.add(url.origin);
    pointedAt.add(url.href);
    loaded.add(url.href);
  }
  const sameSite = external
    .filter((url) => sameSiteHost(url.hostname, finalUrl.hostname))
    .slice(0, opts.maxScripts);
  for (const url of sameSite) {
    try {
      const res = await request(url, "*/*");
      if (!res.ok) continue;
      const text = await readCapped(res, opts.maxScriptBytes);
      scanned += 1;
      scriptText += `\n${text}`;
      addSignals(text, url.href);
      for (const origin of extractOrigins(text)) origins.add(origin);
      for (const found of extractUrls(text)) {
        pointedAt.add(found);
        loaded.add(found);
      }
    } catch (error) {
      warnings.push(
        `script ${url.href} not scanned: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  const rawHeaders = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const frameworks = detectFrameworks(html, rawHeaders, scriptText);

  // Links of the start page, same origin only.
  const links = new Set<string>();
  for (const href of facts.links) {
    const url = resolve(href, finalUrl);
    if (!url || url.origin !== finalUrl.origin || ASSET_EXT.test(url.pathname))
      continue;
    url.hash = "";
    links.add(`${url.pathname}${url.search}`);
  }

  const redirectOrigins = [
    ...new Set(
      redirects
        .flatMap((hop) => [hop.url, hop.location ?? ""])
        .map((value) => (value ? originOf(new URL(value, finalUrl)) : null))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (!redirectOrigins.includes(finalUrl.origin))
    redirectOrigins.push(finalUrl.origin);

  const formUrls = facts.formActions
    .map((action) => resolve(action, finalUrl)?.href)
    .filter((href): href is string => href !== undefined);
  const formOrigins = [
    ...new Set(
      facts.formActions
        .map((action) => resolve(action, finalUrl))
        .filter(
          (url): url is URL =>
            url !== null &&
            (url.protocol === "http:" || url.protocol === "https:") &&
            url.origin !== finalUrl.origin,
        )
        .map((url) => url.origin),
    ),
  ];
  for (const origin of formOrigins) origins.add(origin);

  const frameOrigins = [
    ...new Set(
      facts.frames
        .map((src) => resolve(src, finalUrl))
        .filter(
          (url): url is URL =>
            url !== null &&
            (url.protocol === "http:" || url.protocol === "https:") &&
            url.origin !== finalUrl.origin,
        )
        .map((url) => url.origin),
    ),
  ];
  for (const origin of frameOrigins) origins.add(origin);
  const frameUrls = facts.frames
    .map((src) => resolve(src, finalUrl)?.href)
    .filter((href): href is string => href !== undefined);
  const embeds = detectEmbeds([...frameUrls, ...loaded]).map(
    ({ id, origin }) => ({ id, origin }),
  );

  const idps = detectIdps([...pointedAt, ...frameUrls, ...formUrls]).map(
    ({ id, kind, origin }) => ({
      id,
      kind,
      origin,
    }),
  );

  return {
    kind: "site",
    input,
    finalUrl: finalUrl.href,
    status: response.status,
    redirects,
    headers,
    cookies,
    title: facts.title,
    lang: facts.lang,
    description: facts.description,
    themeColor: facts.themeColor ?? manifest?.themeColor ?? null,
    icons: facts.icons.map((icon) => ({
      ...icon,
      href: resolve(icon.href, finalUrl)?.href ?? icon.href,
    })),
    manifest,
    frameworks,
    origins: [...origins].toSorted(),
    redirectOrigins,
    idps,
    signals,
    links: [...links].slice(0, 80),
    formOrigins,
    frameOrigins,
    embeds,
    popupLinks: facts.popupLinks,
    scriptsScanned: scanned,
    warnings,
  };
}

const SERVER_ENTRIES = [
  "server.ts",
  "server.js",
  "src/server.ts",
  "src/server.js",
  "src/index.ts",
  "index.ts",
  ".next/standalone/server.js",
];
const STATIC_DIRS = ["out", "dist", "build", ".output/public", "public"];
const FRAMEWORK_DEPS: [string, string][] = [
  ["next", "next"],
  ["nuxt", "nuxt"],
  ["@sveltejs/kit", "sveltekit"],
  ["@remix-run/react", "remix"],
  ["astro", "astro"],
  ["vite", "vite"],
  ["react-scripts", "create-react-app"],
  ["@angular/core", "angular"],
  ["vue", "vue"],
  ["react", "react"],
  ["express", "express"],
  ["hono", "hono"],
  ["elysia", "elysia"],
  ["fastify", "fastify"],
];

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function walkFiles(
  dir: string,
  filter: (name: string) => boolean,
  limit: number,
): Promise<string[]> {
  const out: string[] = [];
  const queue = [dir];
  while (queue.length > 0 && out.length < limit) {
    const current = queue.shift()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === ".next" ||
        entry.name === "target"
      )
        continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (filter(entry.name)) out.push(full);
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Probes a project directory: framework, built bundle, server entry, backend hints. */
export async function probeDirectory(dir: string): Promise<DirectoryProbe> {
  if (!(await exists(dir))) throw new ProbeError(`directory not found: ${dir}`);
  const warnings: string[] = [];
  let pkg: Record<string, unknown> = {};
  const pkgPath = join(dir, "package.json");
  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(await Bun.file(pkgPath).text()) as Record<
        string,
        unknown
      >;
    } catch {
      warnings.push("package.json is not valid JSON");
    }
  }
  const deps = {
    ...(pkg.dependencies as Record<string, string> | undefined),
    ...(pkg.devDependencies as Record<string, string> | undefined),
  };
  const frameworks = FRAMEWORK_DEPS.filter(([dep]) => dep in deps).map(
    ([, id]) => id,
  );

  let nextOutput: DirectoryProbe["nextOutput"] = null;
  for (const name of ["next.config.ts", "next.config.js", "next.config.mjs"]) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    const text = await Bun.file(path).text();
    if (/output\s*:\s*["']export["']/.test(text)) nextOutput = "export";
    else if (/output\s*:\s*["']standalone["']/.test(text))
      nextOutput = "standalone";
  }

  let staticDir: string | null = null;
  for (const candidate of STATIC_DIRS) {
    if (existsSync(join(dir, candidate, "index.html"))) {
      staticDir = candidate;
      break;
    }
  }
  if (!staticDir && existsSync(join(dir, "index.html"))) staticDir = ".";

  let serverEntry: string | null = null;
  for (const candidate of SERVER_ENTRIES) {
    if (existsSync(join(dir, candidate))) {
      serverEntry = candidate;
      break;
    }
  }
  if (
    nextOutput === "standalone" &&
    existsSync(join(dir, ".next/standalone/server.js"))
  ) {
    serverEntry = ".next/standalone/server.js";
  }
  if (frameworks.includes("next") && !staticDir && !serverEntry) {
    warnings.push(
      "Next.js project without a build: run the build (output export or standalone) first",
    );
  }

  let apiRoutes = 0;
  for (const root of ["app", "src/app", "pages/api", "src/pages/api"]) {
    if (!(await exists(join(dir, root)))) continue;
    const files = await walkFiles(
      join(dir, root),
      (name) =>
        /^route\.(?:ts|js)$/.test(name) ||
        (/\.(?:ts|js)$/.test(name) && root.endsWith("pages/api")),
      400,
    );
    apiRoutes += files.length;
  }

  const backends = new Set<string>();
  for (const name of [
    ".env",
    ".env.production",
    ".env.local",
    ".env.example",
  ]) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    for (const line of (await Bun.file(path).text()).split("\n")) {
      const match =
        /^(?:export\s+)?[A-Z0-9_]*(?:API|BACKEND|SERVER|ENDPOINT|URL)[A-Z0-9_]*\s*=\s*["']?(https?:\/\/[^\s"'#]+)/.exec(
          line.trim(),
        );
      const value = match?.[1];
      if (!value) continue;
      try {
        const url = new URL(value);
        if (url.username || url.password) continue; // credentials never leave the file
        backends.add(url.origin);
      } catch {
        // not a URL
      }
    }
  }

  const signals: ApiSignal[] = [];
  let proxyPrefixes: string[] = [];
  let htmlPages = 0;
  if (staticDir) {
    const root = join(dir, staticDir);
    const files = await walkFiles(
      root,
      (name) => /\.(?:js|mjs|html)$/.test(name),
      300,
    );
    const prefixes = new Set<string>();
    htmlPages = files.filter((file) => file.endsWith(".html")).length;
    for (const file of files) {
      const size = (await stat(file)).size;
      if (size > 3_000_000) continue;
      const text = await Bun.file(file).text();
      for (const id of detectApis(text)) {
        if (!signals.some((signal) => signal.id === id))
          signals.push({ id, where: relative(dir, file) });
      }
      for (const prefix of detectProxyPrefixes(text)) prefixes.add(prefix);
      for (const origin of extractOrigins(text)) {
        if (/api|backend|graphql/i.test(origin)) backends.add(origin);
      }
    }
    proxyPrefixes = [...prefixes].toSorted();
  }

  return {
    kind: "directory",
    input: dir,
    name:
      typeof pkg.name === "string"
        ? pkg.name.replace(/^@[^/]+\//, "")
        : basename(dir),
    frameworks,
    staticDir,
    htmlPages,
    serverEntry,
    nextOutput,
    apiRoutes,
    backends: [...backends].toSorted(),
    proxyPrefixes,
    signals,
    warnings,
  };
}

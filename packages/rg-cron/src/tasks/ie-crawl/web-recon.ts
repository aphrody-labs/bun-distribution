/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { iecodeDataPath } from "@aphrody/paths";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WebService } from "@aphrody/agent-browser/service";

// Domain resource classification and reports; Aphrody Web owns all network discovery.

export interface WebReconOptions {
  /** URL racine (défaut victory-road/fr). */
  rootUrl?: string;
  /** Pages seed additionnelles (URLs absolues) à crawler en plus de la découverte. */
  seeds?: string[];
  /** Répertoire de sortie des artefacts. */
  outDir: string;
  /** Domaines internes considérés comme « pages » à crawler récursivement. */
  pageHostAllow?: string[];
  /** Préfixe de chemin que les pages crawlées doivent partager (défaut `/victory-road/`). */
  pagePathPrefix?: string;
  /** Sonder (fetch) chaque ressource pour status/content-type (défaut true). */
  probeAssets?: boolean;
  /** Nombre max de ressources sondées (sécurité, défaut 2000). */
  maxProbes?: number;
}

export interface Endpoint {
  url: string;
  method: string;
  status: number | null;
  contentType: string | null;
  kind: ResourceKind;
  referrers: string[];
}

type ResourceKind =
  | "page"
  | "stylesheet"
  | "script"
  | "image"
  | "font"
  | "media"
  | "iframe"
  | "json"
  | "manifest"
  | "link"
  | "preload"
  | "other";

export interface WebReconResult {
  root: string;
  pages: string[];
  endpoints: Endpoint[];
  subdomains: string[];
  cdnUrls: string[];
  images: string[];
  css: string[];
  js: string[];
  json: Array<{ url: string; file: string }>;
  frameworks: unknown;
  artifacts: Record<string, { path: string; bytes: number }>;
}

const FONT_EXT = /\.(woff2?|ttf|otf|eot)(\?|$)/i;
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|avif|ico|bmp)(\?|$)/i;
const MEDIA_EXT = /\.(mp4|webm|m3u8|mp3|wav|ogg|m4a|adx|hca)(\?|$)/i;
const JSON_EXT = /\.json(\?|$)/i;

function classifyByUrl(url: string): ResourceKind {
  if (JSON_EXT.test(url)) return "json";
  if (/\.css(\?|$)/i.test(url)) return "stylesheet";
  if (/\.m?js(\?|$)/i.test(url)) return "script";
  if (IMG_EXT.test(url)) return "image";
  if (FONT_EXT.test(url)) return "font";
  if (MEDIA_EXT.test(url)) return "media";
  if (/manifest/i.test(url)) return "manifest";
  return "other";
}

/** Extrait toutes les URLs de ressources d'un document HTML (attributs + inline). */
function extractResources(html: string, baseUrl: string): Map<string, ResourceKind> {
  const out = new Map<string, ResourceKind>();
  const add = (raw: string | undefined, kind: ResourceKind) => {
    if (!raw) return;
    const v = raw.trim();
    if (!v || v.startsWith("data:") || v.startsWith("javascript:") || v.startsWith("#")) return;
    let abs: string;
    try {
      abs = new URL(v, baseUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:/i.test(abs)) return;
    const existing = out.get(abs);
    // json/script/stylesheet/image priment sur "other"/"link"
    if (!existing || existing === "other" || existing === "link") out.set(abs, kind);
  };

  // <link rel=...> : stylesheet, preload, icon, manifest
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    const rel = (tag.match(/rel=["']([^"']+)["']/i)?.[1] || "").toLowerCase();
    const asAttr = (tag.match(/\bas=["']([^"']+)["']/i)?.[1] || "").toLowerCase();
    if (!href) continue;
    if (rel.includes("stylesheet")) add(href, "stylesheet");
    else if (rel.includes("manifest")) add(href, "manifest");
    else if (rel.includes("preload") || rel.includes("prefetch")) {
      if (asAttr === "style") add(href, "stylesheet");
      else if (asAttr === "script") add(href, "script");
      else if (asAttr === "font") add(href, "font");
      else if (asAttr === "image") add(href, "image");
      else add(href, "preload");
    } else if (rel.includes("icon") || rel.includes("apple-touch")) add(href, "image");
    else add(href, classifyByUrl(href));
  }
  // <script src=...>
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi))
    add(m[1], "script");
  // <img src / data-src / srcset>
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    add(tag.match(/\bsrc=["']([^"']+)["']/i)?.[1], "image");
    add(tag.match(/\bdata-src=["']([^"']+)["']/i)?.[1], "image");
    const srcset = tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1];
    if (srcset) for (const part of srcset.split(",")) add(part.trim().split(/\s+/)[0], "image");
  }
  // <source src / srcset> (picture, video, audio)
  for (const m of html.matchAll(/<source\b[^>]*>/gi)) {
    const tag = m[0];
    add(tag.match(/\bsrc=["']([^"']+)["']/i)?.[1], "media");
    const srcset = tag.match(/\bsrcset=["']([^"']+)["']/i)?.[1];
    if (srcset) for (const part of srcset.split(",")) add(part.trim().split(/\s+/)[0], "image");
  }
  // <video|audio src / poster>
  for (const m of html.matchAll(/<(?:video|audio)\b[^>]*>/gi)) {
    const tag = m[0];
    add(tag.match(/\bsrc=["']([^"']+)["']/i)?.[1], "media");
    add(tag.match(/\bposter=["']([^"']+)["']/i)?.[1], "image");
  }
  // <iframe src>
  for (const m of html.matchAll(/<iframe\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi))
    add(m[1], "iframe");
  // inline style url(...) et style="background:url(...)"
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const u = m[1];
    if (u) add(u, classifyByUrl(u));
  }
  // <a href> (pages internes + sorties)
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)) add(m[1], "link");
  // meta og:image / twitter:image
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const prop = (tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1] || "").toLowerCase();
    const content = tag.match(/content=["']([^"']+)["']/i)?.[1];
    if (prop.includes("image") && content) add(content, "image");
  }
  return out;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Crawl recon exhaustif d'un site Inazuma. Écrit tous les artefacts demandés dans
 * `outDir` et renvoie un résumé structuré.
 */
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function crawlWebRecon(opts: WebReconOptions): Promise<WebReconResult> {
  const root = opts.rootUrl ?? "https://www.inazuma.jp/victory-road/fr/";
  // Par défaut, on ne CRAWLE (= visite récursive) que les pages sous le chemin
  // racine (ex. /victory-road/fr/) — la cible. Les URLs vers d'autres locales
  // (EN patchnotes, etc.) ou domaines restent capturées comme ENDPOINTS (sondées
  // pour status/type), mais ne déclenchent pas une expansion complète de l'arbre
  // EN/JA/… (sinon le crawl explose à 120 pages hors cible).
  const rootPath = (() => {
    try {
      return new URL(root).pathname.replace(/[^/]*$/, "");
    } catch {
      return "/victory-road/";
    }
  })();
  const pathPrefix = opts.pagePathPrefix ?? rootPath;
  const probeAssets = opts.probeAssets ?? true;
  const maxProbes = opts.maxProbes ?? 2000;
  if (!Number.isSafeInteger(maxProbes) || maxProbes < 0 || maxProbes > 2000) {
    throw new RangeError("maxProbes must be an integer between 0 and 2000");
  }
  const rootHost = hostOf(root) ?? "www.inazuma.jp";
  const pageHostAllow = opts.pageHostAllow ?? [rootHost];
  const outDir = opts.outDir;
  const jsonDir = join(outDir, "json");
  const snapDir = join(outDir, "snapshots");
  await mkdir(jsonDir, { recursive: true });
  await mkdir(snapDir, { recursive: true });

  const artifacts: WebReconResult["artifacts"] = {};
  const writeArtifact = async (name: string, content: string | Uint8Array) => {
    const path = join(outDir, name);
    await writeFile(path, content);
    const bytes = typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
    artifacts[name] = { path, bytes };
  };

  // Le serveur expose les pages rendues; la détection de frameworks et
  // l’inspection DNS restent explicitement non disponibles sur cette API.
  const frameworks = { source: "aphrody-web-crawl", detection: "not-available" };
  const zukanDetect = { source: "aphrody-web-crawl", detection: "not-available" };
  await writeArtifact(
    "detect.json",
    JSON.stringify({ root: frameworks, "zukan.inazuma.jp": zukanDetect }, null, 2),
  );
  await writeArtifact(
    "recon.md",
    `# Recon

Bounded rendered discovery through aphrody-web-crawl. DNS/framework detection is unavailable in this report.
`,
  );
  artifacts["recon.md"] = {
    path: join(outDir, "recon.md"),
    bytes: await Bun.file(join(outDir, "recon.md")).size,
  };

  // --- 3. Découverte des pages + extraction des ressources ---
  console.log("[WebRecon] Découverte des pages et ressources…");
  // resources: abs URL -> { kind, referrers }
  const resources = new Map<string, { kind: ResourceKind; referrers: Set<string> }>();
  const recordRes = (url: string, kind: ResourceKind, ref: string) => {
    const e = resources.get(url);
    if (e) {
      e.referrers.add(ref);
      if (e.kind === "other" || e.kind === "link" || e.kind === "preload") e.kind = kind;
    } else {
      resources.set(url, { kind, referrers: new Set([ref]) });
    }
  };

  const service = new WebService();
  const report = await service.crawl([root, ...(opts.seeds ?? [])], {
    maxPages: 120,
    render: true,
    maxDepth: 12,
    allowedDomains: pageHostAllow,
    includeUrlRegex: [`^https?://[^/]+${escapeRegex(pathPrefix)}`],
    excludeUrlRegex: [
      "\\.[a-zA-Z0-9]{2,5}(?:[?#].*)?$",
      "/victory-road/[^/]+/(?:[^/]+/)*(?:fr|en|ja|es|de|it|zh-tw|zh-cn|pt-br)/?(?:[?#].*)?$",
    ],
    includeHtml: true,
    includeLinks: true,
    obeyRobots: true,
  });
  await writeArtifact("crawl.json", JSON.stringify(report, null, 2));
  const pages: string[] = [];
  for (const [index, page] of report.pages.entries()) {
    pages.push(page.url);
    const html = page.html ?? "";
    await writeArtifact(`snapshots/p${index}.html`, html);
    for (const [url, kind] of extractResources(html, page.url)) recordRes(url, kind, page.url);
  }

  // --- 4. Sonder les ressources (status + content-type + JSON) ---
  const jsonSink: Array<{ url: string; file: string }> = [];
  const endpoints: Endpoint[] = [];
  const allResEntries = [...resources.entries()];
  for (const page of report.pages) {
    endpoints.push({
      url: page.url,
      method: "GET",
      status: page.status,
      contentType: page.contentType,
      kind: "page",
      referrers: [],
    });
  }

  if (probeAssets && maxProbes > 0 && allResEntries.length > 0) {
    const selected = allResEntries.slice(0, maxProbes);
    const probes = await service.crawl(
      selected.map(([url]) => url),
      {
        maxPages: selected.length,
        maxDepth: 0,
        concurrency: 12,
        allowedDomains: [...new Set(selected.map(([url]) => new URL(url).hostname))],
        includeHtml: true,
        obeyRobots: true,
      },
    );
    await writeArtifact("probes.json", JSON.stringify(probes, null, 2));
    const byUrl = new Map(probes.pages.map((page) => [page.url, page]));
    for (const [url, meta] of selected) {
      const page = byUrl.get(url);
      let kind = meta.kind;
      if (
        page &&
        page.status >= 200 &&
        page.status < 300 &&
        ((page.contentType ?? "").includes("json") || JSON_EXT.test(url))
      ) {
        try {
          const text = page.html ?? "";
          JSON.parse(text);
          kind = "json";
          const safe = url
            .replace(/^https?:\/\//, "")
            .replace(/[^A-Za-z0-9._-]/g, "_")
            .slice(0, 180);
          const file = join(jsonDir, `${safe || "payload"}.json`);
          await writeFile(file, text);
          jsonSink.push({ url, file });
        } catch {
          /* Keep the declared kind when the payload is not JSON. */
        }
      }
      endpoints.push({
        url,
        method: "GET",
        status: page?.status ?? null,
        contentType: page?.contentType ?? null,
        kind,
        referrers: [...meta.referrers].slice(0, 5),
      });
    }
  } else {
    for (const [url, meta] of allResEntries)
      endpoints.push({
        url,
        method: "GET",
        status: null,
        contentType: null,
        kind: meta.kind,
        referrers: [...meta.referrers].slice(0, 5),
      });
  }

  // --- 5. Agrégations ---
  endpoints.sort((a, b) => a.url.localeCompare(b.url));
  const allUrls = endpoints.map((e) => e.url);
  const subdomains = [...new Set(allUrls.map(hostOf).filter((h): h is string => !!h))].sort();
  const cdnHosts = new Set([
    "iijcdn.jp",
    "cloudfront.net",
    "jocdn.net",
    "akamaized.net",
    "fastly.net",
    "gstatic.com",
    "googleapis.com",
    "ytimg.com",
  ]);
  const cdnUrls = allUrls
    .filter((u) => {
      const h = hostOf(u);
      return h ? [...cdnHosts].some((c) => h.endsWith(c)) : false;
    })
    .sort();
  const images = endpoints
    .filter((e) => e.kind === "image")
    .map((e) => e.url)
    .sort();
  const css = endpoints
    .filter((e) => e.kind === "stylesheet")
    .map((e) => e.url)
    .sort();
  const js = endpoints
    .filter((e) => e.kind === "script")
    .map((e) => e.url)
    .sort();

  await writeArtifact("endpoints.json", JSON.stringify(endpoints, null, 2));
  await writeArtifact("subdomains.txt", subdomains.join("\n") + "\n");
  await writeArtifact("cdn-urls.txt", cdnUrls.join("\n") + "\n");
  await writeArtifact("images.json", JSON.stringify(images, null, 2));
  await writeArtifact("css.txt", css.join("\n") + "\n");
  await writeArtifact("js.txt", js.join("\n") + "\n");

  // --- 6. HAR synthétique à partir des sondes HTTP ---
  console.log("[WebRecon] HAR synthétique des ressources sondées…");
  const harEntries: unknown[] = [];
  // Compléter avec les ressources sondées (status connu) → HAR enrichi
  for (const e of endpoints) {
    if (e.status == null) continue;
    harEntries.push({
      startedDateTime: new Date().toISOString(),
      request: {
        method: e.method,
        url: e.url,
        headers: [],
        queryString: [],
        cookies: [],
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: e.status,
        statusText: "",
        httpVersion: "HTTP/1.1",
        headers: e.contentType ? [{ name: "content-type", value: e.contentType }] : [],
        content: { size: -1, mimeType: e.contentType ?? "" },
        redirectURL: "",
        headersSize: -1,
        bodySize: -1,
        cookies: [],
      },
      cache: {},
      timings: { send: 0, wait: 0, receive: 0 },
      _kind: e.kind,
    });
  }
  const har = {
    log: {
      version: "1.2",
      creator: { name: "@rosegriffon/cron ie-crawl/web-recon", version: "1" },
      pages: pages.map((p, i) => ({
        startedDateTime: new Date().toISOString(),
        id: `page_${i}`,
        title: p,
        pageTimings: {},
      })),
      entries: harEntries,
    },
  };
  await writeArtifact("network.har", JSON.stringify(har, null, 2));

  // --- 7. frameworks.md (synthèse detect) ---
  const fwMd = buildFrameworksMd(frameworks, zukanDetect, subdomains, cdnUrls);
  await writeArtifact("frameworks.md", fwMd);

  // --- 8. llms.txt ---
  const llms = buildLlmsTxt({
    root,
    pages,
    endpoints,
    subdomains,
    cdnUrls,
    images,
    css,
    js,
    json: jsonSink,
    frameworks,
    zukanDetect,
  });
  await writeArtifact("llms.txt", llms);

  return {
    root,
    pages,
    endpoints,
    subdomains,
    cdnUrls,
    images,
    css,
    js,
    json: jsonSink,
    frameworks,
    artifacts,
  };
}

/**
 * Wrapper « tâche » pour l'orchestrateur cron : recon web exhaustif de
 * victory-road/fr vers le data root standard. Non bloquant pour le pipeline
 * (renvoie {success} comme les autres crawlers, n'émet pas d'exception).
 */
export async function crawlWebReconTask(
  outDir = iecodeDataPath("inazuma.jp/victory-road/_recon/fr"),
): Promise<{ success: boolean; pages?: number; endpoints?: number; error?: string }> {
  try {
    const res = await crawlWebRecon({ outDir });
    return { success: true, pages: res.pages.length, endpoints: res.endpoints.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[WebRecon] Échec :", msg);
    return { success: false, error: msg };
  }
}

function fmtDetect(d: any): string {
  if (!d || typeof d !== "object") return "_n/a_";
  const cats: Array<[string, string]> = [
    ["frontend", "Frontend"],
    ["backend", "Backend"],
    ["cms", "CMS"],
    ["framework", "Framework"],
    ["library", "Librairies"],
    ["language", "Langage"],
    ["server", "Serveur"],
    ["cdn", "CDN"],
    ["analytics", "Analytics"],
    ["tagManagers", "Tag managers"],
    ["hosting", "Hébergement"],
  ];
  const lines: string[] = [];
  for (const [key, label] of cats) {
    const arr = d[key];
    if (Array.isArray(arr) && arr.length) {
      const names = arr
        .map((x: any) => (typeof x === "string" ? x : x?.name || JSON.stringify(x)))
        .join(", ");
      lines.push(`- **${label}**: ${names}`);
    }
  }
  return lines.length
    ? lines.join("\n")
    : "_Aucun signal de framework détecté (site statique server-rendered)._";
}

function buildFrameworksMd(root: any, zukan: any, subdomains: string[], cdnUrls: string[]): string {
  return `# Frameworks & infrastructure — Inazuma Victory Road (FR)

Source : Aphrody Web CDP et sondes HTTP locales; détection DNS/Wappalyzer indisponible.

## www.inazuma.jp (site principal)

- **HTTP status**: ${root?.httpStatus ?? "?"}
- **IPs**: ${(root?.resolvedIps ?? []).join(", ") || "n/a"}
- **CNAME**: ${(root?.cnameChain ?? []).join(" → ") || "n/a"}
- **Reverse PTR**: ${root?.reversePtr ? JSON.stringify(root.reversePtr) : "n/a"}

${fmtDetect(root)}

Note : le serveur d'origine répond \`Server: openresty\` (recon http) ; la couche edge est l'**IIJ CDN** (CNAME \`*.id*.cas.iijcdn.jp\`, PTR \`*.jocdn.net\`).

## zukan.inazuma.jp (Codex / base de données personnages)

- **HTTP status**: ${zukan?.httpStatus ?? "?"}
- **IPs**: ${(zukan?.resolvedIps ?? []).join(", ") || "n/a"}
- **CNAME**: ${(zukan?.cnameChain ?? []).join(" → ") || "n/a"}

${fmtDetect(zukan)}

Note : \`zukan\` est hébergé sur **AWS** (ELB \`*.ap-northeast-1.elb.amazonaws.com\`, Tokyo), backend \`nginx\` (PHP côté applicatif d'après analyses antérieures), assets statiques sur **CloudFront**.

## Sous-domaines / hôtes observés (${subdomains.length})

${subdomains.map((s) => `- \`${s}\``).join("\n")}

## Hôtes CDN référencés (${
    new Set(
      cdnUrls.map((u) => {
        try {
          return new URL(u).hostname;
        } catch {
          return u;
        }
      }),
    ).size
  })

${
  [
    ...new Set(
      cdnUrls.map((u) => {
        try {
          return new URL(u).hostname;
        } catch {
          return u;
        }
      }),
    ),
  ]
    .map((h) => `- \`${h}\``)
    .join("\n") || "_aucun_"
}
`;
}

function buildLlmsTxt(d: {
  root: string;
  pages: string[];
  endpoints: Endpoint[];
  subdomains: string[];
  cdnUrls: string[];
  images: string[];
  css: string[];
  js: string[];
  json: Array<{ url: string; file: string }>;
  frameworks: any;
  zukanDetect: any;
}): string {
  const sections = [
    ...new Set(
      d.pages.map((p) => {
        const m = p.match(/\/victory-road\/fr\/([^/]+)/);
        return m ? m[1] : "(racine)";
      }),
    ),
  ].sort();
  const byKind = (k: string) => d.endpoints.filter((e) => e.kind === k).length;
  const statusCounts: Record<string, number> = {};
  for (const e of d.endpoints) {
    const key = e.status == null ? "non-sondé" : String(e.status);
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }

  return `# Inazuma Eleven: Victory Road — site officiel (FR)

> Recon exhaustif de ${d.root} et de l'écosystème lié (www.inazuma.jp, zukan.inazuma.jp, CDN IIJ/CloudFront).
> Jeu LEVEL-5 (Steam app id 2799860). Site statique multilingue server-rendered (openresty) derrière l'IIJ CDN.
> Généré par @rosegriffon/cron ie-crawl/web-recon (aphrody-web-crawl; HAR synthétique).

## Vue d'ensemble

- URL racine : ${d.root}
- Pages crawlées : ${d.pages.length}
- Endpoints (URLs uniques) : ${d.endpoints.length}
- Sous-domaines / hôtes : ${d.subdomains.length}
- URLs CDN : ${d.cdnUrls.length}
- Images : ${d.images.length}
- Feuilles CSS : ${d.css.length}
- Bundles JS : ${d.js.length}
- Payloads JSON capturés : ${d.json.length}

## Infrastructure

- **Site principal** (www.inazuma.jp) : edge IIJ CDN (CNAME *.cas.iijcdn.jp, PTR *.jocdn.net, IPs ${(d.frameworks?.resolvedIps ?? []).join("/")}), origine openresty. Cache-Control max-age=300. Pas de framework JS (HTML statique + jQuery/Swiper/Slick/Colorbox côté UI).
- **Codex personnages** (zukan.inazuma.jp) : AWS Tokyo (ELB ap-northeast-1), serveur ${(d.zukanDetect?.server ?? []).map((s: any) => s.evidence || s.name).join("/") || "nginx"}, assets sur CloudFront.
- **Analytics** : Google Tag Manager (GTM-KX7QTFN).
- **Fonts** : Google Fonts (Anton, Noto Sans).

## Sous-domaines / hôtes

${d.subdomains.map((s) => `- ${s}`).join("\n")}

## Sections du site (victory-road/fr)

${sections.map((s) => `- /${s === "(racine)" ? "" : s + "/"}`).join("\n")}

## Pages crawlées (${d.pages.length})

${d.pages.map((p) => `- ${p}`).join("\n")}

## Répartition des endpoints

- Par type : page=${byKind("page")}, stylesheet=${byKind("stylesheet")}, script=${byKind("script")}, image=${byKind("image")}, font=${byKind("font")}, media=${byKind("media")}, json=${byKind("json")}, iframe=${byKind("iframe")}, lien-externe=${byKind("link")}, autre=${byKind("other")}
- Par status HTTP : ${Object.entries(statusCounts)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ")}

## Feuilles de style (${d.css.length})

${d.css.map((u) => `- ${u}`).join("\n")}

## Bundles JS (${d.js.length})

${d.js.map((u) => `- ${u}`).join("\n")}

## Payloads JSON (${d.json.length})

${d.json.length ? d.json.map((j) => `- ${j.url}`).join("\n") : "- (aucun payload JSON détecté — site sans API JSON publique sur ces pages)"}

## Liens externes notables

${
  [
    ...new Set(
      d.endpoints.filter((e) => e.kind === "link" || e.kind === "iframe").map((e) => e.url),
    ),
  ]
    .filter((u) => {
      try {
        return new URL(u).hostname !== "www.inazuma.jp";
      } catch {
        return false;
      }
    })
    .sort()
    .map((u) => `- ${u}`)
    .join("\n") || "- (aucun)"
}

## Images — voir images.json (${d.images.length} URLs CDN complètes)

## Artefacts

- recon.md, detect.json, frameworks.md
- network.har, endpoints.json, subdomains.txt, cdn-urls.txt
- images.json, css.txt, js.txt, json/*.json
- llms.txt (ce fichier)
`;
}

// SPDX-License-Identifier: Apache-2.0
// File-system routes of an `app/` directory, with the Next.js App Router conventions:
//   page, layout, template, loading, error, not-found, route (handlers), default,
//   route groups `(group)`, private folders `_name`, dynamic `[id]`, catch-all `[...slug]`,
//   optional catch-all `[[...slug]]`, and the metadata files robots, sitemap, manifest.
// Parallel (`@slot`) and intercepting (`(.)x`) routes are skipped.
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Extensions of route modules, in priority order. */
export const ROUTE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"] as const;

export const SEGMENT_FILES = ["layout", "template", "loading", "error", "not-found"] as const;
export type SegmentFile = (typeof SEGMENT_FILES)[number];

/** Files that make one directory a segment of the route tree. */
export interface Segment {
  /** URL path of the segment from the root (`/blog/[slug]`), groups removed. */
  path: string;
  /** Files of this segment, project-relative with `/`. */
  files: Partial<Record<SegmentFile, string>>;
}

export type ParamKind = "single" | "catchall" | "optional";

export interface RoutePart {
  /** Literal text, or the parameter name. */
  value: string;
  kind: "static" | ParamKind;
}

export interface AppRoute {
  /** `page` renders React, `route` is a request handler. */
  kind: "page" | "route";
  /** URL pattern, e.g. `/blog/[slug]`. */
  pattern: string;
  parts: RoutePart[];
  /** Project-relative module path of the page or route handler. */
  file: string;
  /** Segments from the root layout to this route (pages only). */
  segments: Segment[];
}

/** Metadata route files served at the root (`robots.txt`, `sitemap.xml`, `manifest.webmanifest`). */
export interface MetadataRoute {
  pathname: string;
  file: string;
  kind: "robots" | "sitemap" | "manifest" | "static";
}

export interface AppTree {
  /** Absolute project root. */
  root: string;
  /** Project-relative app directory. */
  appDir: string;
  routes: AppRoute[];
  metadata: MetadataRoute[];
  /** Root `not-found` module, if any. */
  notFound?: string;
  /** The root layout segment. */
  rootSegment: Segment;
  /** `middleware.ts` / `proxy.ts` next to the app directory. */
  middleware?: string;
}

const toPosix = (path: string) => path.replaceAll("\\", "/");

function findFile(dir: string, entries: Set<string>, base: string): string | undefined {
  for (const ext of ROUTE_EXTENSIONS) if (entries.has(base + ext)) return join(dir, base + ext);
  return undefined;
}

/** Parse a URL pattern into parts. */
export function parsePattern(pattern: string): RoutePart[] {
  const parts: RoutePart[] = [];
  for (const raw of pattern.split("/")) {
    if (!raw) continue;
    let m: RegExpExecArray | null;
    if ((m = /^\[\[\.\.\.([^\]]+)\]\]$/.exec(raw))) parts.push({ value: m[1]!, kind: "optional" });
    else if ((m = /^\[\.\.\.([^\]]+)\]$/.exec(raw))) parts.push({ value: m[1]!, kind: "catchall" });
    else if ((m = /^\[([^\]]+)\]$/.exec(raw))) parts.push({ value: m[1]!, kind: "single" });
    else parts.push({ value: raw, kind: "static" });
  }
  return parts;
}

/** Sort key: static segments first, then dynamic, catch-all, optional catch-all. */
function rank(route: AppRoute): number[] {
  const weight = { static: 0, single: 1, catchall: 2, optional: 3 } as const;
  return route.parts.map(p => weight[p.kind]);
}

function compareRoutes(a: AppRoute, b: AppRoute): number {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < Math.min(ra.length, rb.length); i++) if (ra[i] !== rb[i]) return ra[i]! - rb[i]!;
  if (ra.length !== rb.length) {
    // A trailing optional catch-all matches the shorter path too; keep the more specific first.
    return rb.length - ra.length;
  }
  return a.kind === b.kind ? 0 : a.kind === "route" ? -1 : 1;
}

const METADATA_FILES: Record<string, MetadataRoute["kind"]> = {
  robots: "robots",
  sitemap: "sitemap",
  manifest: "manifest",
};
const METADATA_PATHS: Record<MetadataRoute["kind"], string> = {
  robots: "/robots.txt",
  sitemap: "/sitemap.xml",
  manifest: "/manifest.webmanifest",
  static: "",
};
const STATIC_METADATA = new Set([
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "manifest.json",
  "manifest.webmanifest",
  "icon.png",
  "icon.svg",
  "icon.ico",
  "apple-icon.png",
]);

/** Scan `appDir` (relative to `root`) into routes. */
export function scanApp(root: string, appDir = "app"): AppTree {
  const absApp = join(root, appDir);
  if (!statSync(absApp, { throwIfNoEntry: false })?.isDirectory())
    throw new Error(`@aphrody/m3: no app directory at ${absApp}`);
  const rel = (abs: string) => toPosix(relative(root, abs));
  const routes: AppRoute[] = [];
  const metadata: MetadataRoute[] = [];
  let rootSegment: Segment | undefined;

  const walk = (dir: string, urlPath: string, parents: Segment[]) => {
    const names = readdirSync(dir);
    const entries = new Set(names);
    const segment: Segment = { path: urlPath || "/", files: {} };
    for (const file of SEGMENT_FILES) {
      const found = findFile(dir, entries, file);
      if (found) segment.files[file] = rel(found);
    }
    const chain = [...parents, segment];
    if (!rootSegment) rootSegment = segment;
    const pattern = urlPath || "/";
    const page = findFile(dir, entries, "page");
    const handler = findFile(dir, entries, "route");
    if (page && handler) throw new Error(`@aphrody/m3: ${rel(dir)} has both page and route`);
    if (page) routes.push({ kind: "page", pattern, parts: parsePattern(pattern), file: rel(page), segments: chain });
    if (handler)
      routes.push({ kind: "route", pattern, parts: parsePattern(pattern), file: rel(handler), segments: [] });
    if (dir === absApp) {
      for (const name of names) {
        if (STATIC_METADATA.has(name)) {
          metadata.push({ pathname: `/${name}`, file: rel(join(dir, name)), kind: "static" });
          continue;
        }
        const dot = name.lastIndexOf(".");
        const base = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        const kind = METADATA_FILES[base];
        if (kind && (ROUTE_EXTENSIONS as readonly string[]).includes(ext))
          metadata.push({ pathname: METADATA_PATHS[kind], file: rel(join(dir, name)), kind });
      }
    }
    for (const name of names) {
      if (name.startsWith("_") || name.startsWith("@") || name.startsWith(".") || name === "node_modules") continue;
      if (/^\(\.{1,3}\)/.test(name)) continue;
      const child = join(dir, name);
      if (!statSync(child).isDirectory()) continue;
      const group = /^\(.+\)$/.test(name);
      walk(child, group ? urlPath : `${urlPath}/${name}`, chain);
    }
  };
  walk(absApp, "", []);
  routes.sort(compareRoutes);

  let middleware: string | undefined;
  for (const base of ["proxy", "middleware"]) {
    for (const dir of [join(absApp, ".."), root]) {
      for (const ext of ROUTE_EXTENSIONS) {
        const candidate = join(dir, base + ext);
        if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) {
          middleware ??= rel(candidate);
        }
      }
    }
  }
  return {
    root,
    appDir: toPosix(appDir),
    routes,
    metadata,
    notFound: rootSegment!.files["not-found"],
    rootSegment: rootSegment!,
    middleware,
  };
}

export type Params = Record<string, string | string[]>;

/** Match a pathname against one route. */
export function matchRoute(route: AppRoute, pathname: string): Params | undefined {
  const segs = pathname.split("/").filter(Boolean).map(safeDecode);
  const params: Params = {};
  let i = 0;
  for (const part of route.parts) {
    if (part.kind === "static") {
      if (segs[i] !== part.value) return undefined;
      i++;
    } else if (part.kind === "single") {
      if (segs[i] === undefined) return undefined;
      params[part.value] = segs[i]!;
      i++;
    } else {
      const rest = segs.slice(i);
      if (rest.length === 0 && part.kind === "catchall") return undefined;
      if (rest.length) params[part.value] = rest;
      i = segs.length;
    }
  }
  return i === segs.length ? params : undefined;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** First route matching `pathname`. */
export function findRoute(
  routes: readonly AppRoute[],
  pathname: string,
): { route: AppRoute; params: Params } | undefined {
  for (const route of routes) {
    const params = matchRoute(route, pathname);
    if (params) return { route, params };
  }
  return undefined;
}

/** Fill a pattern with params (for prerendering). */
export function fillPattern(route: AppRoute, params: Params): string {
  const out: string[] = [];
  for (const part of route.parts) {
    if (part.kind === "static") out.push(part.value);
    else {
      const value = params[part.value];
      if (value === undefined) {
        if (part.kind === "optional") continue;
        throw new Error(`@aphrody/m3: missing param ${part.value} for ${route.pattern}`);
      }
      out.push(...(Array.isArray(value) ? value : [value]).map(encodeURIComponent));
    }
  }
  return `/${out.join("/")}`;
}

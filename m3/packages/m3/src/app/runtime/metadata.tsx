// SPDX-License-Identifier: Apache-2.0
// The `metadata` / `generateMetadata` and `viewport` / `generateViewport` exports of layouts and
// pages, merged root to leaf and rendered as hoistable `<title>`, `<meta>` and `<link>` elements.
import type { ReactNode } from "react";

type Title = string | { default?: string; template?: string; absolute?: string };
type Image = string | { url: string; width?: number; height?: number; alt?: string };
type Icon = string | { url: string; type?: string; sizes?: string; rel?: string };

export interface Metadata {
  title?: Title | null;
  description?: string | null;
  applicationName?: string;
  keywords?: string | string[];
  authors?: { name?: string; url?: string } | { name?: string; url?: string }[];
  creator?: string;
  publisher?: string;
  generator?: string;
  robots?: string | { index?: boolean; follow?: boolean; [key: string]: unknown };
  metadataBase?: URL | string | null;
  alternates?: { canonical?: string; languages?: Record<string, string> };
  openGraph?: {
    title?: string;
    description?: string;
    url?: string;
    siteName?: string;
    locale?: string;
    type?: string;
    images?: Image | Image[];
  };
  twitter?: {
    card?: string;
    title?: string;
    description?: string;
    site?: string;
    creator?: string;
    images?: Image | Image[];
  };
  icons?: Icon | Icon[] | { icon?: Icon | Icon[]; apple?: Icon | Icon[]; shortcut?: Icon | Icon[] };
  manifest?: string;
  verification?: { google?: string; yandex?: string; other?: Record<string, string | string[]> };
  other?: Record<string, string | string[]>;
}

export interface Viewport {
  width?: string | number;
  initialScale?: number;
  maximumScale?: number;
  userScalable?: boolean;
  viewportFit?: string;
  themeColor?: string | { media?: string; color: string }[];
  colorScheme?: string;
}

type Props = { params: Promise<unknown>; searchParams?: Promise<unknown> };
type Module = Record<string, unknown>;

interface Resolved {
  metadata: Metadata;
  viewport: Viewport;
}

/** Merge the metadata of `modules` (root layout first, page last). */
export async function resolveMetadata(modules: readonly Module[], props: Props): Promise<Resolved> {
  let metadata: Metadata = {};
  let viewport: Viewport = {};
  let template: string | undefined;
  for (const mod of modules) {
    let next = mod.metadata as Metadata | undefined;
    if (typeof mod.generateMetadata === "function")
      next = (await (mod.generateMetadata as (p: Props, parent: Promise<Metadata>) => unknown)(
        props,
        Promise.resolve(metadata),
      )) as Metadata;
    let view = mod.viewport as Viewport | undefined;
    if (typeof mod.generateViewport === "function")
      view = (await (mod.generateViewport as (p: Props) => unknown)(props)) as Viewport;
    if (view) viewport = { ...viewport, ...view };
    if (!next) continue;
    const title = next.title;
    let resolvedTitle = metadata.title;
    if (title !== undefined) {
      if (title === null || typeof title === "string")
        resolvedTitle = title && template ? template.replace("%s", title) : title;
      else if (title.absolute) resolvedTitle = title.absolute;
      else if (title.default) resolvedTitle = title.default;
      if (title && typeof title === "object" && title.template) template = title.template;
    }
    metadata = { ...metadata, ...next, title: resolvedTitle };
  }
  return { metadata, viewport };
}

const list = <T,>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

function absolute(url: string, base: Metadata["metadataBase"]): string {
  if (!base) return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function viewportContent(viewport: Viewport): string {
  const parts: string[] = [];
  parts.push(`width=${viewport.width ?? "device-width"}`);
  parts.push(`initial-scale=${viewport.initialScale ?? 1}`);
  if (viewport.maximumScale !== undefined) parts.push(`maximum-scale=${viewport.maximumScale}`);
  if (viewport.userScalable !== undefined) parts.push(`user-scalable=${viewport.userScalable ? "yes" : "no"}`);
  if (viewport.viewportFit) parts.push(`viewport-fit=${viewport.viewportFit}`);
  return parts.join(", ");
}

/** Elements for the resolved metadata; React hoists them into `<head>`. */
export function renderMetadata({ metadata: m, viewport: v }: Resolved): ReactNode[] {
  const out: ReactNode[] = [];
  let k = 0;
  const meta = (attrs: Record<string, string>) => out.push(<meta key={k++} {...attrs} />);
  const link = (attrs: Record<string, string>) => out.push(<link key={k++} {...attrs} />);
  meta({ charSet: "utf-8" });
  meta({ name: "viewport", content: viewportContent(v) });
  for (const theme of typeof v.themeColor === "string" ? [{ color: v.themeColor }] : (v.themeColor ?? []))
    meta(
      theme.media
        ? { name: "theme-color", content: theme.color, media: theme.media }
        : { name: "theme-color", content: theme.color },
    );
  if (v.colorScheme) meta({ name: "color-scheme", content: v.colorScheme });
  if (typeof m.title === "string") out.push(<title key={k++}>{m.title}</title>);
  if (m.description) meta({ name: "description", content: m.description });
  if (m.applicationName) meta({ name: "application-name", content: m.applicationName });
  if (m.keywords) meta({ name: "keywords", content: list(m.keywords).join(",") });
  for (const author of list(m.authors)) {
    if (author.name) meta({ name: "author", content: author.name });
    if (author.url) link({ rel: "author", href: author.url });
  }
  if (m.creator) meta({ name: "creator", content: m.creator });
  if (m.publisher) meta({ name: "publisher", content: m.publisher });
  if (m.generator) meta({ name: "generator", content: m.generator });
  if (m.robots) {
    const content =
      typeof m.robots === "string"
        ? m.robots
        : [m.robots.index === false ? "noindex" : "index", m.robots.follow === false ? "nofollow" : "follow"].join(
            ", ",
          );
    meta({ name: "robots", content });
  }
  if (m.alternates?.canonical) link({ rel: "canonical", href: absolute(m.alternates.canonical, m.metadataBase) });
  for (const [lang, href] of Object.entries(m.alternates?.languages ?? {}))
    link({ rel: "alternate", hrefLang: lang, href: absolute(href, m.metadataBase) });
  if (m.manifest) link({ rel: "manifest", href: m.manifest });
  const og = m.openGraph;
  if (og) {
    const ogTitle = og.title ?? (typeof m.title === "string" ? m.title : undefined);
    if (ogTitle) meta({ property: "og:title", content: ogTitle });
    if (og.description ?? m.description)
      meta({ property: "og:description", content: (og.description ?? m.description)! });
    if (og.url) meta({ property: "og:url", content: absolute(og.url, m.metadataBase) });
    if (og.siteName) meta({ property: "og:site_name", content: og.siteName });
    if (og.locale) meta({ property: "og:locale", content: og.locale });
    meta({ property: "og:type", content: og.type ?? "website" });
    for (const image of list(og.images)) {
      const img = typeof image === "string" ? { url: image } : image;
      meta({ property: "og:image", content: absolute(img.url, m.metadataBase) });
      if (img.width) meta({ property: "og:image:width", content: String(img.width) });
      if (img.height) meta({ property: "og:image:height", content: String(img.height) });
      if (img.alt) meta({ property: "og:image:alt", content: img.alt });
    }
  }
  const tw = m.twitter;
  if (tw) {
    meta({ name: "twitter:card", content: tw.card ?? "summary" });
    if (tw.site) meta({ name: "twitter:site", content: tw.site });
    if (tw.creator) meta({ name: "twitter:creator", content: tw.creator });
    if (tw.title) meta({ name: "twitter:title", content: tw.title });
    if (tw.description) meta({ name: "twitter:description", content: tw.description });
    for (const image of list(tw.images))
      meta({ name: "twitter:image", content: absolute(typeof image === "string" ? image : image.url, m.metadataBase) });
  }
  const icons = m.icons;
  if (icons) {
    const grouped =
      typeof icons === "string" || Array.isArray(icons) || "url" in icons
        ? { icon: icons as Icon | Icon[] }
        : (icons as { icon?: Icon | Icon[]; apple?: Icon | Icon[]; shortcut?: Icon | Icon[] });
    const emit = (rel: string, value: Icon | Icon[] | undefined) => {
      for (const icon of list(value)) {
        const item = typeof icon === "string" ? { url: icon } : icon;
        const attrs: Record<string, string> = { rel: item.rel ?? rel, href: item.url };
        if (item.type) attrs.type = item.type;
        if (item.sizes) attrs.sizes = item.sizes;
        link(attrs);
      }
    };
    emit("icon", grouped.icon);
    emit("apple-touch-icon", grouped.apple);
    emit("shortcut icon", grouped.shortcut);
  }
  const verification = m.verification;
  if (verification?.google) meta({ name: "google-site-verification", content: verification.google });
  if (verification?.yandex) meta({ name: "yandex-verification", content: verification.yandex });
  for (const [name, value] of Object.entries({ ...verification?.other, ...m.other }))
    for (const content of list(value)) meta({ name, content });
  return out;
}

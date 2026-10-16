// SPDX-License-Identifier: Apache-2.0
// Material Symbols as modules: `import home from "m3:icons/home"` is the SVG markup (24 px, outlined by default),
// `m3:icons/rounded/home?fill=1&wght=300` picks a style and variant. The SVGs are read at build time from a local
// catalogue (`M3_ICONS_ROOT`, or a `vendor/material-design-icons/symbols/web` checkout above the app) or else fetched
// once from Google's Material Symbols CDN (`M3_ICONS_ORIGIN`, e.g. https://cdn.aphrody.com) into a disk cache, so no
// icon font and no native library ship with the app.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const ICON_STYLES = ["outlined", "rounded", "sharp"] as const;
export type IconStyle = (typeof ICON_STYLES)[number];

const CATALOGUE = "vendor/material-design-icons/symbols/web";

/** The catalogue directory: `M3_ICONS_ROOT`, else the nearest `vendor/material-design-icons/symbols/web` above `from`. */
export function iconsRoot(from: string = import.meta.dir): string | undefined {
  const fromEnv = Bun.env.M3_ICONS_ROOT;
  if (fromEnv) return resolve(fromEnv);
  let dir = resolve(from);
  for (;;) {
    const candidate = join(dir, CATALOGUE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export interface IconRequest {
  name: string;
  style: IconStyle;
  fill: boolean;
  weight: number;
}

/** Parse `<name>`, `<style>/<name>` and the `fill` / `wght` query of an `m3:icons/...` specifier tail. */
export function parseIconSpecifier(tail: string): IconRequest {
  const [pathPart = "", query = ""] = tail.split("?", 2);
  const parts = pathPart.split("/").filter(Boolean);
  const name = parts.pop();
  if (!name || !/^[a-z0-9_]+$/.test(name)) throw new Error(`m3-bun: invalid icon name in m3:icons/${tail}`);
  const style = (parts.pop() ?? "outlined") as IconStyle;
  if (!(ICON_STYLES as readonly string[]).includes(style) || parts.length > 0)
    throw new Error(`m3-bun: m3:icons/${tail}: style must be one of ${ICON_STYLES.join(", ")}`);
  const params = new URLSearchParams(query);
  const weight = Number(params.get("wght") ?? 400);
  if (![100, 200, 300, 400, 500, 600, 700].includes(weight))
    throw new Error(`m3-bun: m3:icons/${tail}: wght must be 100..700`);
  return { name, style, fill: params.get("fill") === "1", weight };
}

/** File name of a variant, as the catalogue spells it (`home_wght300fill1_24px.svg`). */
export function iconFile({ name, fill, weight }: IconRequest): string {
  return `${name}${weight === 400 ? "" : `_wght${weight}`}${fill ? (weight === 400 ? "_fill1" : "fill1") : ""}_24px.svg`;
}

/** Google's variant directory: `default`, `fill1`, `wght300`, `wght300fill1`. */
export function iconVariant({ fill, weight }: IconRequest): string {
  return `${weight === 400 ? "" : `wght${weight}`}${fill ? "fill1" : ""}` || "default";
}

/** The CDN the icons come from when there is no local catalogue: `M3_ICONS_ORIGIN`, else Google's. */
export const iconsOrigin = (): string => Bun.env.M3_ICONS_ORIGIN ?? "https://fonts.gstatic.com";

/** The Material Symbols CDN URL of a variant (fonts.gstatic.com layout). */
export function iconUrl(request: IconRequest, origin: string = iconsOrigin()): string {
  return `${origin.replace(/\/$/, "")}/s/i/short-term/release/materialsymbols${request.style}/${request.name}/${iconVariant(request)}/24px.svg`;
}

export const iconsCacheDir = (): string =>
  Bun.env.M3_ICONS_CACHE ?? `${Bun.env.XDG_CACHE_HOME ?? `${Bun.env.HOME ?? "/tmp"}/.cache`}/aphrody/material-symbols`;

/** The cache file of a variant. The origin's `Bun.hash` names a directory, so two CDNs never share entries. */
export function iconCacheFile(request: IconRequest, origin: string = iconsOrigin()): string {
  const key = Bun.hash.xxHash3(origin.replace(/\/$/, "")).toString(16).padStart(16, "0");
  return `${iconsCacheDir()}/${key}/${request.style}/${request.name}/${iconVariant(request)}.svg`;
}

/** The SVG markup of an icon: the local catalogue when there is one, else the CDN through the disk cache. */
export async function loadIcon(request: IconRequest, root: string | null = iconsRoot() ?? null): Promise<string> {
  if (root) return readIcon(request, root);
  const origin = iconsOrigin();
  const cached = Bun.file(iconCacheFile(request, origin));
  if (await cached.exists()) return (await cached.text()).trim();
  const url = iconUrl(request, origin);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) throw new Error(`m3-bun: no icon ${request.style}/${iconFile(request)} at ${url}`);
  if (!res.ok) throw new Error(`m3-bun: ${url} answered ${res.status}`);
  const svg = (await res.text()).trim();
  if (!svg.startsWith("<svg")) throw new Error(`m3-bun: ${url} is not an SVG`);
  await Bun.write(cached, svg);
  return svg;
}

/** The SVG markup of an icon from a local catalogue, or a build error that names the file. */
export function readIcon(request: IconRequest, root: string | null = iconsRoot() ?? null): string {
  if (!root)
    throw new Error("m3-bun: no local Material Symbols catalogue (M3_ICONS_ROOT); use loadIcon to fetch from the CDN");
  const file = join(root, request.name, `materialsymbols${request.style}`, iconFile(request));
  if (!existsSync(file)) throw new Error(`m3-bun: no icon ${request.style}/${iconFile(request)} in ${root}`);
  return readFileSync(file, "utf8").trim();
}

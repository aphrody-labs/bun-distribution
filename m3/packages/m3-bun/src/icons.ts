// SPDX-License-Identifier: Apache-2.0
// Material Symbols as modules: `import home from "m3:icons/home"` is the SVG markup (24 px, outlined by default),
// `m3:icons/rounded/home?fill=1&wght=300` picks a style and variant. The SVGs come from the forked catalogue
// (`forks/material-design-icons/symbols/web`, sparse checkout), read at build time, so no icon font and no
// native library ship with the app.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const ICON_STYLES = ["outlined", "rounded", "sharp"] as const;
export type IconStyle = (typeof ICON_STYLES)[number];

const CATALOGUE = "forks/material-design-icons/symbols/web";

/** The catalogue directory: `M3_ICONS_ROOT`, else the nearest `forks/material-design-icons/symbols/web` above `from`. */
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
  if (!(ICON_STYLES as readonly string[]).includes(style) || parts.length > 0) throw new Error(`m3-bun: m3:icons/${tail}: style must be one of ${ICON_STYLES.join(", ")}`);
  const params = new URLSearchParams(query);
  const weight = Number(params.get("wght") ?? 400);
  if (![100, 200, 300, 400, 500, 600, 700].includes(weight)) throw new Error(`m3-bun: m3:icons/${tail}: wght must be 100..700`);
  return { name, style, fill: params.get("fill") === "1", weight };
}

/** File name of a variant, as the catalogue spells it (`home_wght300fill1_24px.svg`). */
export function iconFile({ name, fill, weight }: IconRequest): string {
  return `${name}${weight === 400 ? "" : `_wght${weight}`}${fill ? (weight === 400 ? "_fill1" : "fill1") : ""}_24px.svg`;
}

/** The SVG markup of an icon, or a build error that names the file. */
export function readIcon(request: IconRequest, root: string | null = iconsRoot() ?? null): string {
  if (!root) throw new Error("m3-bun: the Material Symbols catalogue is not checked out (bun scripts/forks.ts sparse material-design-icons --apply) and M3_ICONS_ROOT is not set");
  const file = join(root, request.name, `materialsymbols${request.style}`, iconFile(request));
  if (!existsSync(file)) throw new Error(`m3-bun: no icon ${request.style}/${iconFile(request)} in ${root}`);
  return readFileSync(file, "utf8").trim();
}

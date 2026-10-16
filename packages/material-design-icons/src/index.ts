import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SymbolStyle = "outlined" | "rounded" | "sharp";

export const SVG_ROOT = join(import.meta.dir, "../../../vendor/material-design-icons/symbols/web");

/** Absolute path of a Material Symbols SVG from the forked catalogue. */
export function symbolSvgPath(
  name: string,
  style: SymbolStyle = "outlined",
  weight = 400,
  filled = false,
): string {
  const variant = `${weight === 400 ? "" : `_wght${weight}`}${filled ? (weight === 400 ? "_fill1" : "fill1") : ""}`;
  return join(SVG_ROOT, name, `materialsymbols${style}`, `${name}${variant}_24px.svg`);
}

/** Every symbol name materialised by `scripts/sync-catalogue.ts` (sorted). */
export function symbolNames(): string[] {
  return existsSync(SVG_ROOT) ? readdirSync(SVG_ROOT).toSorted() : [];
}

export function hasSymbol(
  name: string,
  style: SymbolStyle = "outlined",
  weight = 400,
  filled = false,
): boolean {
  return existsSync(symbolSvgPath(name, style, weight, filled));
}

/** SVG markup of a symbol, read from the fork. Throws when the variant is not materialised. */
export function readSymbolSvg(
  name: string,
  style: SymbolStyle = "outlined",
  weight = 400,
  filled = false,
): string {
  return readFileSync(symbolSvgPath(name, style, weight, filled), "utf8");
}

/** Case-insensitive substring search over symbol names; exact, then prefix, then shorter names first. */
export function searchSymbols(query: string, limit = 50): string[] {
  const q = query.trim().toLowerCase().replaceAll(" ", "_");
  if (!q) return [];
  const rank = (n: string) => (n === q ? 0 : n.startsWith(q) ? 1 : 2);
  return symbolNames()
    .filter((n) => n.includes(q))
    .toSorted((a, b) => rank(a) - rank(b) || a.length - b.length)
    .slice(0, limit);
}

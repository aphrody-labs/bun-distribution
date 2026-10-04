import { join } from "node:path";

export type SymbolStyle = "outlined" | "rounded" | "sharp";

const SVG_ROOT = join(import.meta.dir, "../../../forks/material-design-icons/symbols/web");

/** Absolute path of a Material Symbols SVG from the forked catalogue. */
export function symbolSvgPath(name: string, style: SymbolStyle = "outlined", weight = 400, filled = false): string {
  const variant = `${weight === 400 ? "" : `_wght${weight}`}${filled ? (weight === 400 ? "_fill1" : "fill1") : ""}`;
  return join(SVG_ROOT, name, `materialsymbols${style}`, `${name}${variant}_24px.svg`);
}

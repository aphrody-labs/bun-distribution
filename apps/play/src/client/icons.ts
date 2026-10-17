// SPDX-License-Identifier: Apache-2.0
/**
 * Material Symbols Rounded, rendered from the official variable font of @aphrody/m3-fonts
 * (packages/m3-fonts/fonts/upstream/material-symbols, Apache-2.0), subset to the icons below by
 * scripts/symbols.py. Glyphs are addressed by their Private Use Area codepoint (no ligature text
 * in the DOM); FILL, wght, GRAD and opsz stay variable (see .symbol in styles.css).
 */
import codepoints from "./symbols.json";

export type IconName = keyof typeof codepoints;
export type IconSize = "sm" | "md" | "lg";

/** A decorative icon (aria-hidden). Controls that show only an icon carry their own label. */
export function icon(
  name: IconName,
  options: { size?: IconSize; filled?: boolean } = {},
): string {
  const classes = [
    "symbol",
    `symbol-${options.size ?? "md"}`,
    options.filled ? "symbol-filled" : "",
  ].filter(Boolean);
  return `<span class="${classes.join(" ")}" aria-hidden="true">&#x${codepoints[name]};</span>`;
}

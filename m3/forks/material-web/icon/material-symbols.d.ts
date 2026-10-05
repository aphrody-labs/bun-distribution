/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @fileoverview Helpers to register the **Material Symbols** icon font used by
 * `<md-icon>` (and every component that slots an icon). Mirrors the Google Sans
 * helpers in `typography/internal/font-face.ts`.
 *
 * `<md-icon>` only declares `font-family: var(--md-icon-font, 'Material Symbols
 * Outlined')` and the four variable axes (FILL/GRAD/opsz/wght) — it never loads
 * the font itself. The integrator must register it once. Three paths:
 *
 * 1. **Google Fonts CDN, variable ranges** (`materialSymbolsHref()`): loads the
 *    full axis ranges so the `--md-icon-fill/wght/grad/opsz` tokens act at
 *    runtime. Prefer this over a fixed instance (`@24,400,0,0`) which freezes
 *    FILL/wght.
 * 2. **Google Fonts CDN, subset** (`materialSymbolsHref({iconNames})`): adds
 *    `&icon_names=` so Google serves a glyph subset — the single biggest payload
 *    win when you know your icon set (e.g. the names a codemod collected).
 * 3. **Self-hosted woff2/ttf** (`materialSymbolsFontFaceCss(url)`): fully
 *    offline, no CDN dependency.
 */
/** The three Material Symbols styles. Outlined is the M3 default. */
export type MaterialSymbolsStyle = "Outlined" | "Rounded" | "Sharp";
/** The canonical font-family name for the default (Outlined) style. */
export declare const MATERIAL_SYMBOLS_FAMILY = "Material Symbols Outlined";
/** Variable-axis ranges of the Material Symbols variable font (per Google). */
export declare const MATERIAL_SYMBOLS_AXES: {
    /** optical size, dp. */
    opsz: readonly [20, 48];
    /** weight. */
    wght: readonly [100, 700];
    /** fill (0 = outline, 1 = filled). */
    FILL: readonly [0, 1];
    /** grade (emphasis, can be negative for dark UIs). */
    GRAD: readonly [-50, 200];
};
/** family name for a given style. */
export declare function materialSymbolsFamily(style?: MaterialSymbolsStyle): string;
export interface MaterialSymbolsHrefOptions {
    /** Which style to load. Default `Outlined` (the M3 baseline). */
    style?: MaterialSymbolsStyle;
    /**
     * Optional glyph subset (Material Symbols names, snake_case, e.g. `["home",
     * "search", "settings"]`). When provided, Google serves only those glyphs —
     * the dominant payload optimisation. Omit to load the full set.
     */
    iconNames?: readonly string[];
}
/**
 * Google Fonts CSS2 stylesheet URL for Material Symbols over the **full variable
 * ranges** (so the md-icon axis tokens work). Insert as `<link rel="stylesheet">`.
 */
export declare function materialSymbolsHref(options?: MaterialSymbolsHrefOptions): string;
/**
 * Build a self-hosted `@font-face` rule for a Material Symbols variable font,
 * declaring the full weight range so `wght` is interpolable. The other axes
 * (FILL/GRAD/opsz) are exposed via `font-variation-settings` on `<md-icon>`.
 *
 * @param url URL of the variable woff2/ttf served by the app.
 * @param style Which style this file is (sets the font-family name). Default
 *   `Outlined`.
 */
export declare function materialSymbolsFontFaceCss(url: string, style?: MaterialSymbolsStyle): string;
/**
 * Inject the Material Symbols stylesheet `<link>` into the document once
 * (idempotent, keyed by style). No-op outside a browser. Returns `true` if it
 * injected, `false` if already present or unavailable.
 *
 * @example
 * ```ts
 * import {ensureMaterialSymbols} from '@aphrody/material-web/icon/material-symbols.js';
 * ensureMaterialSymbols(); // full Outlined set, variable ranges
 * ensureMaterialSymbols({iconNames: ['home', 'search', 'settings']}); // subset
 * ```
 */
export declare function ensureMaterialSymbols(options?: MaterialSymbolsHrefOptions): boolean;
/**
 * Inject a self-hosted Material Symbols `@font-face` once (idempotent). No-op
 * outside a browser. Returns `true` if it injected.
 *
 * @param url URL of the variable woff2/ttf.
 * @param style Which style the file provides. Default `Outlined`.
 */
export declare function ensureMaterialSymbolsFontFace(url: string, style?: MaterialSymbolsStyle): boolean;

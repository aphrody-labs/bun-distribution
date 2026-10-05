/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @fileoverview Helpers to register the Google Sans Flex variable font. Two
 * sources are supported:
 *
 * 1. A self-hosted variable TTF (all six axes, fully offline) — preferred for
 *    aphrody, which ships the font under the SIL OFL at
 *    `assets/fonts/google-sans-flex/`.
 * 2. The Google Fonts CDN (`fonts.google.com/specimen/Google+Sans+Flex`) for
 *    quick prototypes; note the CSS2 API only exposes the registered `opsz`
 *    and `wght` axes in its URL, so prefer the self-hosted font when `GRAD`,
 *    `ROND`, `slnt`, or `wdth` control is required.
 */
/** The canonical UI/display font-family name. */
export declare const FONT_FAMILY = "Google Sans Flex";
/**
 * The canonical code/monospace font-family name. Google Sans Code is the face
 * Google ships for code surfaces (Gemini, AI Studio); it exposes a `MONO` axis
 * (0 = proportional, 1 = monospace) and `wght` (300–800). Confirmed via the aphrody-web
 * Google-design recon (`packages/aphrody-web/scripts/google-design-recon.ts`).
 */
export declare const CODE_FONT_FAMILY = "Google Sans Code";
/**
 * Build a self-hosted `@font-face` rule for the full variable font, declaring
 * the complete weight/stretch/oblique ranges so every axis is interpolable.
 * Mirrors `m3_tokens::google_sans_flex::export_font_face`.
 *
 * @param url URL of the variable TTF (e.g. an absolute path served by the app).
 */
export declare function fontFaceCss(url: string): string;
/**
 * The Google Fonts CSS2 stylesheet URL for Google Sans Flex over the full
 * optical-size and weight ranges. Insert as `<link rel="stylesheet">`.
 */
export declare function googleFontsHref(): string;
/**
 * Build a self-hosted `@font-face` rule for the Google Sans Code variable font
 * (`MONO` + `wght` axes). Mirrors `m3_tokens::google_sans_code`.
 *
 * @param url URL of the variable TTF.
 */
export declare function codeFontFaceCss(url: string): string;
/** The Google Fonts CSS2 stylesheet URL for Google Sans Code (weight range). */
export declare function codeGoogleFontsHref(): string;
/**
 * Inject the self-hosted `@font-face` into the document once (idempotent). No-op
 * outside a browser. Returns `true` if it injected, `false` if already present
 * or unavailable.
 */
export declare function ensureFontFace(url: string): boolean;

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @fileoverview The Material 3 type scale (30 styles) expressed in Google Sans
 * Flex. Each role carries its size/line-height/tracking plus the variable-font
 * axis values that give display/headline cuts the warm, rounded Gemini-family
 * fingerprint (higher `opsz`, positive `GRAD`/`ROND`) while body/label stay
 * neutral for legibility.
 *
 * Two families are exposed: the 15 BASELINE roles (`display-large` …
 * `label-small`) and the 15 M3 Expressive EMPHASIZED roles
 * (`display-large-emphasized` … `label-small-emphasized`). Each emphasized
 * role keeps the metrics (size / line-height / tracking) of its baseline
 * namesake but carries more `wght` and `ROND` for a more emotive, expressive
 * presentation. See docs/strategy/m3-expressive-evolution.md section 6.
 *
 * Size, line height, tracking and `wght` follow the M3 type scale tokens
 * (https://m3.material.io/styles/typography/type-scale-tokens) and match the
 * Rust owner `crates/ui/m3-tokens/src/typography.rs`. Only the
 * expressive axes (`opsz`, `GRAD`, `ROND`) are Aphrody brand choices.
 * See docs/design/TYPOGRAPHY.md.
 */
import { AxisSettings } from "./google-sans-flex-axes.js";
/** A single M3 type-scale role. */
export interface TypeStyle {
    /** Role name, e.g. `display-large`. */
    readonly role: TypeScaleRole;
    /** Font size in px. */
    readonly sizePx: number;
    /** Line height in px. */
    readonly lineHeightPx: number;
    /** Letter spacing (tracking) in px. */
    readonly trackingPx: number;
    /** The variable-font axis values for this role. */
    readonly axes: AxisSettings;
}
/** The 15 canonical (baseline) M3 type-scale role names. */
export type BaselineTypeScaleRole = "display-large" | "display-medium" | "display-small" | "headline-large" | "headline-medium" | "headline-small" | "title-large" | "title-medium" | "title-small" | "body-large" | "body-medium" | "body-small" | "label-large" | "label-medium" | "label-small";
/**
 * The 15 M3 Expressive "emphasized" type-scale role names. Each mirrors a
 * baseline role with the `-emphasized` suffix.
 */
export type EmphasizedTypeScaleRole = "display-large-emphasized" | "display-medium-emphasized" | "display-small-emphasized" | "headline-large-emphasized" | "headline-medium-emphasized" | "headline-small-emphasized" | "title-large-emphasized" | "title-medium-emphasized" | "title-small-emphasized" | "body-large-emphasized" | "body-medium-emphasized" | "body-small-emphasized" | "label-large-emphasized" | "label-medium-emphasized" | "label-small-emphasized";
/**
 * All 30 M3 type-scale role names: the 15 baseline roles plus the 15 M3
 * Expressive emphasized roles.
 */
export type TypeScaleRole = BaselineTypeScaleRole | EmphasizedTypeScaleRole;
/** The 15 baseline M3 type styles, keyed by role. */
export declare const BASELINE_TYPE_SCALE: Readonly<Record<BaselineTypeScaleRole, TypeStyle>>;
/**
 * The 15 M3 Expressive "emphasized" type styles, keyed by role. Each shares
 * its metrics (size / line-height / tracking) with the baseline role of the
 * same name. `wght` follows the M3 Expressive emphasized scale (500 for
 * display, headline, title-large and body; 700 for title-medium/small and
 * label); `ROND` grows for display/headline/title and stays moderate for
 * body/label (brand choice, docs/strategy/m3-expressive-evolution.md). All axis values sit within the Google Sans Flex ranges
 * declared in google-sans-flex-axes.ts (`wght` 1..1000, `ROND` 0..100), so
 * `fontVariationSettings` clamps none of them.
 */
export declare const EMPHASIZED_TYPE_SCALE: Readonly<Record<EmphasizedTypeScaleRole, TypeStyle>>;
/**
 * The full M3 type scale (30 roles): the 15 baseline roles followed by the 15
 * M3 Expressive emphasized roles. This is the runtime source of truth consumed
 * by `<md-type>`, `typeStyleCss`, and `typeScaleVars`.
 */
export declare const TYPE_SCALE: Readonly<Record<TypeScaleRole, TypeStyle>>;
/**
 * All 30 type styles in canonical order (15 baseline, then 15 emphasized).
 */
export declare const ALL_TYPE_STYLES: readonly TypeStyle[];
/**
 * Resolve a role to the inline CSS declarations that render it: family, size,
 * line-height, tracking, weight, and `font-variation-settings`. Returns a map
 * suitable for `styleMap()` or direct assignment.
 */
export declare function typeStyleCss(role: TypeScaleRole): Record<string, string>;
/**
 * Emit the M3 typescale CSS custom properties (`--md-sys-typescale-<role>-*`)
 * for the whole scale, as a `name: value` record. Lets a page register the
 * scale once and have components read it through `var()`.
 */
export declare function typeScaleVars(): Record<string, string>;

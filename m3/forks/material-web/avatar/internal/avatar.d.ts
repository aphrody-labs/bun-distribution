/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, PropertyValues, TemplateResult } from "lit";
/**
 * The shape of an avatar.
 *
 * - `circular` — a fully rounded circle (the M3 default).
 * - `rounded` — a square with rounded corners.
 * - `square` — a square with no corner rounding.
 */
export type AvatarVariant = "circular" | "rounded" | "square";
/**
 * An avatar represents a user or entity with an image, initials, or icon.
 *
 * It renders, in priority order: an image (`src`), then the default slot /
 * initials text, then a fallback. If the image fails to load it transparently
 * falls back to the slotted content (initials or an icon). The fallback surface
 * uses the `--md-sys-color-primary-container` / `on-primary-container` tokens.
 *
 * ```html
 * <md-avatar src="user.jpg" alt="Ada Lovelace"></md-avatar>
 * <md-avatar>AL</md-avatar>
 * <md-avatar><svg slot="icon" ...></svg></md-avatar>
 * ```
 *
 * @fires error {Event} Re-dispatched when the underlying image fails to load.
 */
export declare class Avatar extends LitElement {
    /** Image source URL. When set and loadable, the image is shown. */
    src: string;
    /**
     * Alternative text for the image, also used as the accessible label for the
     * avatar as a whole.
     */
    alt: string;
    /** The avatar shape. */
    variant: AvatarVariant;
    /**
     * The avatar size. Accepts any CSS length (e.g. `40px`, `3rem`) or a number,
     * interpreted as pixels. Drives both width and height.
     */
    size: string | number;
    /** Tracks whether the current `src` failed to load. */
    private hasError;
    /** The size coerced to a CSS length, derived in `willUpdate`. */
    private cssSize;
    willUpdate(changed: PropertyValues<this>): void;
    protected render(): TemplateResult;
    private renderImage;
    private renderFallback;
    private handleError;
}

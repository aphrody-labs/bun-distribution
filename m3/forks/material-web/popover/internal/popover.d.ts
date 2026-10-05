/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
import "../../elevation/elevation.js";
/**
 * Where the popover surface is placed relative to its anchor.
 */
export type PopoverPlacement = "top" | "bottom" | "left" | "right" | "top-start" | "top-end" | "bottom-start" | "bottom-end" | "left-start" | "left-end" | "right-start" | "right-end";
/**
 * A floating surface anchored to an element — the Material 3 equivalent of
 * MUI's `Popover`/`Popper`.
 *
 * Built on the native **Popover API**: the surface carries `popover="auto"` so
 * it lives in the browser top layer (never clipped by `overflow`, light-
 * dismissable, Escape-closable) without any JS z-index juggling. When the
 * platform also supports **CSS Anchor Positioning**, placement is fully
 * declarative via `anchor-name` / `position-area`. On engines without anchor
 * positioning (Firefox/Safari at time of writing), a small
 * `getBoundingClientRect`-based fallback positions the surface in JS and keeps
 * it in sync on scroll/resize while open.
 *
 * Feature support is detected at runtime:
 * - Popover API: `HTMLElement.prototype.hasOwnProperty('popover')`. When
 *   absent, the surface degrades to a plain absolutely-positioned element
 *   (still positioned by the JS fallback) — it simply will not be promoted to
 *   the top layer.
 * - CSS Anchor Positioning: `CSS.supports('anchor-name: --x')`. When absent the
 *   JS fallback owns positioning.
 *
 * ```html
 * <button id="trigger">Open</button>
 * <md-popover anchor="trigger" placement="bottom-start">
 *   <p>Floating content</p>
 * </md-popover>
 * ```
 *
 * @fires opened {Event} Fired once the popover is shown.
 * @fires closed {Event} Fired once the popover is hidden.
 */
export declare class Popover extends LitElement {
    /** Whether the popover is open. Reflected so CSS can target `[open]`. */
    open: boolean;
    /**
     * The anchor element, or the `id` of an element in the same document. The
     * popover positions itself relative to this element.
     */
    anchor: string | HTMLElement;
    /** Where to place the surface relative to the anchor. */
    placement: PopoverPlacement;
    private readonly surface;
    /**
     * The position computed by the JS fallback (engines without CSS Anchor
     * Positioning). `null` while the declarative anchor path owns positioning, so
     * no inline coordinates leak onto the surface in that case.
     */
    private fallbackPosition;
    /** True when the native Popover API is available. */
    readonly supportsPopover: boolean;
    /** True when CSS Anchor Positioning is available. */
    readonly supportsAnchor: boolean;
    private cleanup;
    /** Opens the popover. */
    show(): void;
    /** Closes the popover. */
    close(): void;
    /** Toggles the popover open/closed. */
    toggle(): void;
    disconnectedCallback(): void;
    protected updated(changed: Map<string, unknown>): void;
    private resolveAnchor;
    private showSurface;
    private hideSurface;
    /** JS positioning fallback for engines without CSS Anchor Positioning. */
    private setupFallback;
    private teardownFallback;
    private position;
    /** Align along the anchor's main (horizontal for top/bottom) axis. */
    private alignMain;
    /** Align along the cross (vertical for left/right) axis. */
    private alignCross;
    protected render(): import("lit-html").TemplateResult<1>;
    /** Keep `open` in sync when the surface is light-dismissed by the platform. */
    private handleToggle;
}

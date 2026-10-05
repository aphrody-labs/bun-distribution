/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * Top app bar layout variant.
 *
 * - `small` — single 64dp row, title leading next to the nav icon.
 * - `center` — single 64dp row, title centered.
 * - `medium` — 112dp, title on a second line (headline-small).
 * - `large` — 152dp, title on a second line (headline-medium).
 */
export type TopAppBarVariant = "small" | "center" | "medium" | "large";
/**
 * A top app bar displays navigation, actions, and the title of the current
 * screen at the top of a layout. Implements the four Material 3 variants and
 * the on-scroll container-color fill.
 *
 * Slot a leading nav affordance into `slot="leading"`, the title into the
 * default slot, and trailing actions into `slot="trailing"`.
 */
export declare class TopAppBar extends LitElement {
    /** The bar layout variant. */
    variant: TopAppBarVariant;
    /**
     * A scrollable element whose scroll position drives the on-scroll fill. When
     * unset, the bar listens to the document scroll. Provide the element (not a
     * selector).
     */
    scrollTarget: HTMLElement | null;
    private scrolled;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected updated(changed: Map<string, unknown>): void;
    private get scroller();
    /**
     * Prefer the CSS scroll-driven animation (declarative, runs off the main
     * thread). Only fall back to a JS scroll listener when a custom scroll target
     * is set (which CSS `scroll()` can't reference) or the browser lacks
     * scroll-driven-animation support. The `js-scroll` attribute disables the CSS
     * path so the two never fight.
     */
    private attachScroll;
    private detachScroll;
    private readonly handleScroll;
    protected render(): import("lit-html").TemplateResult<1>;
}

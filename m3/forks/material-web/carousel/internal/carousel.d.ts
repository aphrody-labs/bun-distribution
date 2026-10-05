/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * The carousel layout strategy.
 *
 * - `hero` — a single large item dominates, with a peek of the next.
 * - `multi-browse` — multiple items of decreasing size are visible at once.
 */
export type CarouselLayout = "hero" | "multi-browse";
/**
 * A carousel lays out a scrollable, snapping row of items. It implements the
 * Material 3 carousel spec using CSS scroll-snap and exposes `next()`/`prev()`
 * navigation plus optional arrow controls that hide when there is no overflow.
 *
 * Slot `md-carousel-item`s into the default slot.
 *
 * ```html
 * <md-carousel layout="multi-browse">
 *   <md-carousel-item size="large"><img src="a.jpg" alt=""></md-carousel-item>
 *   <md-carousel-item size="medium"><img src="b.jpg" alt=""></md-carousel-item>
 *   <md-carousel-item size="small"><img src="c.jpg" alt=""></md-carousel-item>
 * </md-carousel>
 * ```
 */
export declare class Carousel extends LitElement {
    /** The layout strategy. Reflected so CSS can target `[layout]`. */
    layout: CarouselLayout;
    /** When true, render previous/next arrow controls. */
    showArrows: boolean;
    private hasOverflow;
    private readonly scroller;
    private resizeObserver?;
    private activeUpdatePending;
    private readonly supportsScrollSnap;
    /** Scrolls forward by roughly one item width. */
    next(): void;
    /** Scrolls backward by roughly one item width. */
    prev(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected firstUpdated(): void;
    protected render(): import("lit-html").TemplateResult<1>;
    private renderArrow;
    private handlePrevClick;
    private handleNextClick;
    private handleScroll;
    private handleScrollSnapChange;
    private handleScrollSnapChanging;
    private handleSlotChange;
    private setActiveItem;
    private updateActiveItem;
    private scrollByItem;
    private updateOverflow;
}

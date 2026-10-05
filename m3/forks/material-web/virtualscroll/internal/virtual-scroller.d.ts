/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * A fixed-size virtual scroller — the web-component equivalent of Angular CDK's
 * `cdk-virtual-scroll-viewport` (fixed item size). It renders only the rows
 * intersecting the viewport (plus a small overscan buffer), so a list of tens
 * of thousands of items scrolls smoothly with a constant DOM size.
 *
 * Data-driven: set `.items` (the full array) and `.renderItem` (a function
 * returning a Lit template or string for one item). All items must share the
 * same `itemHeight`.
 *
 * @fires virtual-scroll:range {CustomEvent<{start: number; end: number}>} Fired
 *     when the rendered window changes.
 */
export declare class VirtualScroller extends LitElement {
    /** The full backing data set. */
    items: readonly unknown[];
    /** Fixed row height in px. */
    itemHeight: number;
    /** Extra rows rendered above/below the viewport to mask fast scrolling. */
    buffer: number;
    /** Renders one item; defaults to its string coercion. */
    renderItem: (item: unknown, index: number) => unknown;
    private scrollPos;
    private viewportHeight;
    private readonly viewport;
    private resizeObserver;
    connectedCallback(): void;
    protected firstUpdated(): void;
    disconnectedCallback(): void;
    /** Scroll so that the item at `index` is at the top of the viewport. */
    scrollToIndex(index: number): void;
    private get range();
    private readonly handleScroll;
    protected updated(changed: Map<string, unknown>): void;
    protected render(): import("lit-html").TemplateResult<1>;
}

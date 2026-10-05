/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, TemplateResult } from "lit";
/**
 * A Material 3 breadcrumb trail. Shows the path of pages leading to the current
 * one as a list of links separated by a customizable separator.
 *
 * Slot the trail items (typically `<md-link>`, `<a>`, or other inline
 * elements) into the default slot, in order from the root to the current page.
 * The separator defaults to `/` and can be overridden with the `separator`
 * property or, for rich content, the `separator` slot.
 *
 * When the number of items exceeds `max-items`, the middle is collapsed behind
 * an ellipsis (`…`) affordance; activating it expands the full trail.
 *
 * Renders a `<nav aria-label>` wrapping an ordered list (`<ol>`) for correct
 * assistive-technology semantics.
 *
 * ```html
 * <md-breadcrumbs aria-label="Breadcrumb" max-items="4">
 *   <md-link href="/">Home</md-link>
 *   <md-link href="/library">Library</md-link>
 *   <md-link href="/library/data">Data</md-link>
 *   <span>Current</span>
 * </md-breadcrumbs>
 * ```
 */
export declare class Breadcrumbs extends LitElement {
    /**
     * The separator rendered between items. Defaults to `/`. For rich separators
     * use the `separator` slot instead, which takes precedence.
     */
    separator: string;
    /**
     * The accessible label for the wrapping `<nav>`. Defaults to `Breadcrumb`.
     */
    label: string;
    /**
     * Collapse the trail when it contains more than this many items. The first
     * `items-before-collapse` and last `items-after-collapse` items stay visible
     * with an ellipsis between them. Set to `0` (or a value large enough) to
     * never collapse.
     */
    maxItems: number;
    /** Number of items to show before the collapse ellipsis. */
    itemsBeforeCollapse: number;
    /** Number of items to show after the collapse ellipsis. */
    itemsAfterCollapse: number;
    /** The accessible label for the expand (ellipsis) button. */
    expandText: string;
    private readonly items;
    private expanded;
    private itemCount;
    /** Whether the trail is currently collapsed behind an ellipsis. */
    private collapsing;
    /** Source indices of the items to render, in order. Derived before render. */
    private visibleIndices;
    protected willUpdate(changed: Map<string, unknown>): void;
    protected render(): TemplateResult<1>;
    private renderItems;
    private renderSeparator;
    private renderEllipsis;
    private handleExpand;
    private handleSlotChange;
}

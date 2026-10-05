/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * Vertical alignment of the navigation items group within the rail.
 *
 * - `top` — items hug the top, beneath the optional menu/FAB.
 * - `center` — items are vertically centered (the M3 default for a rail with
 *   no FAB).
 * - `bottom` — items hug the bottom.
 */
export type NavigationRailAlignment = "top" | "center" | "bottom";
/**
 * A navigation rail lets people switch between UI views on mid-sized devices.
 * It implements the Material 3 collapsed (80dp) and expanded (≥220dp) variants
 * with optional leading menu button and FAB slots.
 *
 * Slot `menu` for a leading menu/hamburger affordance, `fab` for a FAB or
 * extended FAB, and the default slot for `<md-navigation-rail-item>`s.
 *
 * @fires navigation-rail:change {CustomEvent<{value: string}>} Fired when the
 *     active item changes, with the newly-selected item's `value`.
 */
export declare class NavigationRail extends LitElement {
    /** Expands the rail to its wide layout with inline labels. */
    expanded: boolean;
    /** Vertical placement of the items group. */
    alignment: NavigationRailAlignment;
    /**
     * The `value` of the currently-selected item. Two-way: set it to select an
     * item, read it after a `navigation-rail:change`.
     */
    value: string;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected updated(changed: Map<string, unknown>): void;
    private get items();
    private syncItems;
    private readonly handleActivate;
    protected render(): import("lit-html").TemplateResult<1>;
}

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * A single destination inside an `<md-navigation-rail>`. Renders the M3 active
 * indicator pill (56×32dp collapsed) around the icon, the label beneath (or
 * inline when the rail is expanded), and an optional badge.
 *
 * Slot an icon into the default slot (e.g. `<md-icon>` or an SVG); optionally
 * slot a distinct `active-icon` shown when selected.
 *
 * @fires navigation-rail-item:activate {Event} Fired when the item is
 *     activated; the parent rail listens for this to update its `value`.
 */
export declare class NavigationRailItem extends LitElement {
    /** Identifies this destination within the rail's `value`. */
    value: string;
    /** The text label shown beneath (collapsed) or beside (expanded) the icon. */
    label: string;
    /** Whether this destination is the active one. Managed by the rail. */
    selected: boolean;
    /** Whether the parent rail is expanded. Managed by the rail. */
    expanded: boolean;
    /** Optional badge text (large badge). A bare presence renders a small dot. */
    badgeValue: string;
    /** Renders a small dot badge with no text. */
    showBadge: boolean;
    /** When set, the item renders as a link to this destination. */
    href: string;
    connectedCallback(): void;
    protected render(): import("lit-html").TemplateResult<1>;
    private renderContent;
    private renderBadge;
    private hasActiveIcon;
    private activate;
}

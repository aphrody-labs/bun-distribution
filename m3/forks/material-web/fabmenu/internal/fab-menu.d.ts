/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * A FAB menu: a primary floating action button that, when opened, reveals a
 * stack of `md-fab-menu-item` actions above it with a staggered entrance. The
 * trigger icon morphs from a plus to a close (✕) by rotating 45°.
 *
 * @fires fab-menu:open {Event} Fired after the menu opens.
 * @fires fab-menu:close {Event} Fired after the menu closes.
 */
export declare class FabMenu extends LitElement {
    /** Whether the menu is open. Reflected so CSS can target `[open]`. */
    open: boolean;
    /** Accessible label for the trigger FAB. */
    label: string;
    private readonly itemsContainer;
    private readonly items;
    /** Opens the menu and animates the items in. */
    show(): void;
    /** Closes the menu and animates the items out. */
    close(): void;
    /** Toggles the open state. */
    toggle(): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected render(): import("lit-html").TemplateResult<1>;
    private handleTriggerClick;
    private handleScrimClick;
    private readonly handleItemClick;
    private readonly handleKeydown;
    /**
     * Staggers the items in or out. Each item is offset by an incremental delay
     * so they cascade per the M3 FAB-menu motion.
     */
    private animateItems;
}

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * Detail payload for the `expansion:toggle` event dispatched whenever a panel's
 * expanded state changes.
 */
export interface ExpansionToggleDetail {
    expanded: boolean;
}
/**
 * A Material 3 expansion panel: a header that toggles a region of content open
 * and closed. The header carries a rotating chevron, the content animates its
 * height via the modern `grid-template-rows: 0fr → 1fr` technique.
 *
 * Slots:
 * - `header` — the panel title shown in the clickable header.
 * - `description` — optional secondary text in the header.
 * - default — the collapsible body content.
 *
 * @fires expansion:toggle {CustomEvent<ExpansionToggleDetail>} Fired after the
 *     panel expands or collapses.
 */
export declare class ExpansionPanel extends LitElement {
    /** Whether the panel is expanded. Reflected so CSS can target `[expanded]`. */
    expanded: boolean;
    /** When true the header cannot be toggled by the user. */
    disabled: boolean;
    private readonly regionId;
    /** Expands the panel (no-op if already expanded or disabled). */
    expand(): void;
    /** Collapses the panel (no-op if already collapsed or disabled). */
    collapse(): void;
    /** Toggles the expanded state. */
    toggle(): void;
    private notifyToggle;
    private handleHeaderClick;
    private handleHeaderKeydown;
    protected render(): import("lit-html").TemplateResult<1>;
}

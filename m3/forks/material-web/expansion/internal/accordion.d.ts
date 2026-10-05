/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * A Material 3 accordion: a container of `md-expansion-panel` children. In the
 * default single-expand mode the accordion listens for each panel's
 * `expansion:toggle` event and collapses the other panels when one opens. Set
 * `multi` to let several panels stay open simultaneously.
 *
 * Slot:
 * - default — the `md-expansion-panel` children.
 */
export declare class Accordion extends LitElement {
    /**
     * When true, multiple panels may be expanded at once. When false (default),
     * opening one panel collapses any other open panel.
     */
    multi: boolean;
    private readonly items;
    connectedCallback(): void;
    disconnectedCallback(): void;
    private readonly handleToggle;
    /** Returns the slotted `md-expansion-panel` children. */
    private expansionPanels;
    protected render(): import("lit-html").TemplateResult<1>;
}

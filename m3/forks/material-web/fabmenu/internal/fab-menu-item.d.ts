/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * A single action row inside an `md-fab-menu`. Renders a label chip
 * (`surface-container-high`) trailed by a small (40px) FAB carrying the icon.
 *
 * Slot an icon as the default content; provide the visible text with the
 * `label` property (also used as the accessible name).
 *
 * @fires fab-menu-item:click {Event} Fired when the item is activated. The host
 *     menu closes itself in response.
 */
export declare class FabMenuItem extends LitElement {
    /** The visible (and accessible) label for this action. */
    label: string;
    connectedCallback(): void;
    protected render(): import("lit-html").TemplateResult<1>;
    private handleClick;
    private handleKeydown;
}

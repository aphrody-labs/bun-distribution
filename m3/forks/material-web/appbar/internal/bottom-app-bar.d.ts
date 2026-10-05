/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * A bottom app bar displays navigation and key actions at the bottom of a
 * compact-window layout (80dp tall, surface-container). Slot up to four action
 * affordances into the default slot and an optional FAB into `slot="fab"`.
 */
export declare class BottomAppBar extends LitElement {
    connectedCallback(): void;
    protected render(): import("lit-html").TemplateResult<1>;
}

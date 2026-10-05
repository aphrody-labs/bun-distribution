/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative, LitElement } from "lit";
import { type FabColor, type FabSize } from "./fab.js";
declare global {
    interface HTMLElementTagNameMap {
        /** A Material Design fab component. */
        "md-fab": Fab;
    }
}
/**
 * A Material Design fab component.
 */
export declare class Fab extends LitElement {
    static styles: CSSResultOrNative[];
    color: FabColor;
    size: FabSize;
    protected render(): import("lit-html").TemplateResult<1>;
}

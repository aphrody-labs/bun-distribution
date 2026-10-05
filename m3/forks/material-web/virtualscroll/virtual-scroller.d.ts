/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { VirtualScroller } from "./internal/virtual-scroller.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-virtual-scroller": MdVirtualScroller;
    }
}
/**
 * @summary A fixed-size virtual scroller (CDK `virtual-scroll-viewport`
 * equivalent) — renders only the visible rows of a large list.
 *
 * @description
 * ```ts
 * const vs = document.querySelector('md-virtual-scroller')!;
 * vs.items = bigArray;
 * vs.itemHeight = 56;
 * vs.renderItem = (item, i) => html`<md-list-item>${item.name}</md-list-item>`;
 * ```
 *
 * @final
 * @suppress {visibility}
 */
export declare class MdVirtualScroller extends VirtualScroller {
    static styles: CSSResultOrNative[];
}

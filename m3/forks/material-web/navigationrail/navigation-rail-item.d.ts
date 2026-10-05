/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { NavigationRailItem } from "./internal/navigation-rail-item.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-navigation-rail-item": MdNavigationRailItem;
    }
}
/**
 * @summary A single destination inside an `<md-navigation-rail>`.
 *
 * @final
 * @suppress {visibility}
 */
export declare class MdNavigationRailItem extends NavigationRailItem {
    static styles: CSSResultOrNative[];
}

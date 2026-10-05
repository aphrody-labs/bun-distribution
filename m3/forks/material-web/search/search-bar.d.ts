/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { SearchBar } from "./internal/search-bar.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-search-bar": MdSearchBar;
    }
}
/**
 * @summary A search bar with an expanding (docked or fullscreen) results view.
 *
 * @description
 * ```html
 * <md-search-bar placeholder="Search mail" view="docked">
 *   <md-icon slot="leading">search</md-icon>
 *   <md-list><md-list-item>Recent result</md-list-item></md-list>
 * </md-search-bar>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
export declare class MdSearchBar extends SearchBar {
    static styles: CSSResultOrNative[];
}

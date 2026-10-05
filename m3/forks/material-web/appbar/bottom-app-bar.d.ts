/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { BottomAppBar } from "./internal/bottom-app-bar.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-bottom-app-bar": MdBottomAppBar;
    }
}
/**
 * @summary A bottom app bar for navigation and key actions on compact windows.
 *
 * @final
 * @suppress {visibility}
 */
export declare class MdBottomAppBar extends BottomAppBar {
    static styles: CSSResultOrNative[];
}

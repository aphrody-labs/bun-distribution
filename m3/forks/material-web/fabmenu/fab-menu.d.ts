/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { FabMenu } from "./internal/fab-menu.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-fab-menu": MdFabMenu;
    }
}
/**
 * @summary A FAB menu — a primary FAB that reveals a stack of action items.
 *
 * @description
 * Slot `md-fab-menu-item` children. Toggle the `open` attribute or call
 * `show()`/`close()`/`toggle()`.
 *
 * ```html
 * <md-fab-menu label="Create">
 *   <md-fab-menu-item label="New doc"><svg ...></svg></md-fab-menu-item>
 *   <md-fab-menu-item label="New folder"><svg ...></svg></md-fab-menu-item>
 * </md-fab-menu>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
export declare class MdFabMenu extends FabMenu {
    static styles: CSSResultOrNative[];
}

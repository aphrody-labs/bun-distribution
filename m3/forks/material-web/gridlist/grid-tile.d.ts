/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { GridTile } from "./internal/grid-tile.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-grid-tile": MdGridTile;
    }
}
/**
 * @summary A tile within an `md-grid-list`, optionally spanning multiple
 * columns or rows.
 *
 * @description
 * Place tile content (typically an image) in the default slot and an optional
 * caption in `slot="footer"`. Use `colspan`/`rowspan` to make a tile span
 * multiple grid tracks.
 *
 * ```html
 * <md-grid-tile colspan="2" rowspan="2">
 *   <img src="hero.jpg" alt="">
 *   <span slot="footer">Caption</span>
 * </md-grid-tile>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
export declare class MdGridTile extends GridTile {
    static styles: CSSResultOrNative[];
}

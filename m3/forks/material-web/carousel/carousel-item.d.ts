/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { CarouselItem } from "./internal/carousel-item.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-carousel-item": MdCarouselItem;
    }
}
/**
 * @summary A single item within an `md-carousel`.
 *
 * @description
 * A rounded, clipped container for an image or arbitrary content. Set `size`
 * (`large` | `medium` | `small`) to control its prominence in the
 * `multi-browse` layout.
 *
 * ```html
 * <md-carousel-item size="large">
 *   <img src="photo.jpg" alt="">
 * </md-carousel-item>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
export declare class MdCarouselItem extends CarouselItem {
    static styles: CSSResultOrNative[];
}

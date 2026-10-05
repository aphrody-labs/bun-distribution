/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { Skeleton } from "./internal/skeleton.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-skeleton": MdSkeleton;
    }
}
/**
 * @summary Skeletons display a placeholder preview of content before it loads,
 * reducing perceived latency.
 *
 * @description
 * Set `variant` (`text`|`circular`|`rectangular`|`rounded`) for the shape,
 * `width`/`height` for the dimensions (bare numbers are pixels), and
 * `animation` (`pulse`|`wave`|`false`) for the loading effect. The placeholder
 * is `aria-hidden`.
 *
 * ```html
 * <md-skeleton variant="circular" width="40" height="40"></md-skeleton>
 * <md-skeleton variant="text" width="80%"></md-skeleton>
 * <md-skeleton variant="rounded" width="100%" height="120" animation="wave"></md-skeleton>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
export declare class MdSkeleton extends Skeleton {
    static styles: CSSResultOrNative[];
}

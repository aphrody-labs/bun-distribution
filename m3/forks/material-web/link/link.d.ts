/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { Link } from "./internal/link.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-link": MdLink;
    }
}
/**
 * @summary Links navigate to another location and are styled with Material 3
 * color, typography, and state layers.
 *
 * @description
 * Renders a real `<a>` element. Set `href`, `target`, `rel`, `underline`
 * (`none` | `hover` | `always`) and `color` (an M3 color role). Slot the link
 * text as the default content.
 *
 * ```html
 * <md-link href="/pricing" underline="hover">Pricing</md-link>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
export declare class MdLink extends Link {
    static styles: CSSResultOrNative[];
}

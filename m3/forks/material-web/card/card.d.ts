/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { Card } from "./internal/card.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-card": MdCard;
    }
}
/**
 * @summary Cards contain content and actions about a single subject.
 *
 * @description Cards are surface containers that represent a single unit of
 * content or a collection of content.
 *
 * @final
 */
export declare class MdCard extends Card {
    static styles: CSSResultOrNative[];
}
export default MdCard;

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { CSSResultOrNative } from "lit";
import { MdType as MdTypeElement } from "./internal/md-type.js";
declare global {
    interface HTMLElementTagNameMap {
        "md-type": MdType;
    }
}
/**
 * @summary Renders text in a Material 3 type-scale role with full Google Sans
 * Flex axis control.
 *
 * @description
 * ```html
 * <!-- A canonical role -->
 * <md-type scale="display-large">Aphrody</md-type>
 *
 * <!-- Override one axis, animate the rest into place -->
 * <md-type scale="headline-medium" rond="100" animated>Rounded warmth</md-type>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
export declare class MdType extends MdTypeElement {
    static styles: CSSResultOrNative[];
}

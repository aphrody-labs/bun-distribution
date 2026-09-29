/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CSSResultOrNative } from "lit";
import { customElement } from "lit/decorators.js";

import { Banner } from "./internal/banner.js";
import { styles } from "./internal/banner-styles.js";

declare global {
  interface HTMLElementTagNameMap {
    "md-banner": MdBanner;
  }
}

/**
 * @summary Banners show a prominent message together with optional related
 * actions, anchored at the top of the screen until dismissed.
 *
 * @description
 * The default slot holds the message; slot a leading icon/image into
 * `slot="icon"` and up to two actions (e.g. `<md-text-button>`) into
 * `slot="action"`. Set `lines="two"` for the two-line layout, `stacked` to
 * move the actions onto their own row, and `closeable` for a trailing
 * dismiss affordance that fires a `close` event. Use `.show()` / `.dismiss()`
 * or toggle the `open` attribute (defaults to `true`) to control visibility.
 *
 * ```html
 * <md-banner lines="two" stacked closeable>
 *   Two files could not be synced to this device because they are too large.
 *   <md-text-button slot="action">Retry</md-text-button>
 * </md-banner>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
@customElement("md-banner")
export class MdBanner extends Banner {
  static override styles: CSSResultOrNative[] = [styles];
}

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { SupportingPane } from "./internal/supporting-pane.js";
import { styles } from "./internal/supporting-pane-styles.js";
/**
 * @summary The Material 3 supporting-pane layout — main content with a
 * secondary pane beside it (wide) or stacked beneath it (narrow).
 *
 * @description
 * From the Expanded breakpoint (>= 840dp) the flexible `main` pane and a fixed
 * ~360px `supporting` pane sit side by side, separated by the 24dp pane spacer.
 * Below that the supporting content stacks beneath the main content, or is
 * hidden when the `collapsed` attribute is set.
 *
 * ```html
 * <md-supporting-pane>
 *   <article slot="main">…</article>
 *   <aside slot="supporting">…</aside>
 * </md-supporting-pane>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdSupportingPane = class MdSupportingPane extends SupportingPane {
    static { this.styles = [styles]; }
};
MdSupportingPane = __decorate([
    customElement("md-supporting-pane")
], MdSupportingPane);
export { MdSupportingPane };
//# sourceMappingURL=md-supporting-pane.js.map
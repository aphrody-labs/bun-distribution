import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { Badge } from "./internal/badge.js";
import { styles } from "./internal/badge-styles.cssresult.js";
/**
 * @summary Badges draw attention to dynamic information, such as counts or status.
 *
 * @description Badges are decorative indicators that can show values or status indicators
 * on top of other components like icon buttons, list items, or navigation elements.
 *
 * @final
 */
let MdBadge = class MdBadge extends Badge {
    static { this.styles = [styles]; }
};
MdBadge = __decorate([
    customElement("md-badge")
], MdBadge);
export { MdBadge };
export default MdBadge;
//# sourceMappingURL=badge.js.map
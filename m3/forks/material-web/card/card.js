import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { Card } from "./internal/card.js";
import { styles } from "./internal/card-styles.cssresult.js";
/**
 * @summary Cards contain content and actions about a single subject.
 *
 * @description Cards are surface containers that represent a single unit of
 * content or a collection of content.
 *
 * @final
 */
let MdCard = class MdCard extends Card {
    static { this.styles = [styles]; }
};
MdCard = __decorate([
    customElement("md-card")
], MdCard);
export { MdCard };
export default MdCard;
//# sourceMappingURL=card.js.map
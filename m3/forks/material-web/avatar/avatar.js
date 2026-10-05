/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { customElement } from "lit/decorators.js";
import { Avatar } from "./internal/avatar.js";
import { styles } from "./internal/avatar-styles.js";
/**
 * @summary Avatars represent a user or entity with an image, initials, or icon.
 *
 * @description
 * Set `src`/`alt` to show an image; slot initials text as the default content
 * or an icon into `slot="icon"` for the fallback. If the image fails to load
 * the avatar falls back to the slotted content. Use `variant`
 * (`circular`|`rounded`|`square`) and `size` to style it.
 *
 * ```html
 * <md-avatar src="user.jpg" alt="Ada Lovelace"></md-avatar>
 * <md-avatar size="56px">AL</md-avatar>
 * ```
 *
 * @final
 * @suppress {visibility}
 */
let MdAvatar = class MdAvatar extends Avatar {
    static { this.styles = [styles]; }
};
MdAvatar = __decorate([
    customElement("md-avatar")
], MdAvatar);
export { MdAvatar };
//# sourceMappingURL=avatar.js.map
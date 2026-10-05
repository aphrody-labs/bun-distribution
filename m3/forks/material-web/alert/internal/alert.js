/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement, nothing } from "lit";
import { property, queryAssignedElements } from "lit/decorators.js";
/**
 * An alert displays a short, important message in a way that attracts the
 * user's attention without interrupting their task.
 *
 * Equivalent to MUI's `Alert` + `AlertTitle`. The default slot holds the
 * message; slot a heading into `slot="title"`, an action (e.g.
 * `<md-text-button>`) into `slot="action"`, and override the leading icon via
 * `slot="icon"`. Set `closeable` for a trailing dismiss affordance which fires
 * a `close` event.
 *
 * Colors map onto the real M3 `--md-sys-color-*` roles (error/tertiary/
 * secondary/primary families) with baseline fallbacks, so the component is
 * self-contained.
 *
 * @fires close {Event} Fired when the user activates the dismiss affordance.
 */
export class Alert extends LitElement {
    constructor() {
        super(...arguments);
        /** The semantic severity. Reflected so CSS can target `[severity="…"]`. */
        this.severity = "info";
        /** The visual variant. Reflected so CSS can target `[variant="…"]`. */
        this.variant = "standard";
        /** When true, renders a trailing close (✕) affordance. */
        this.closeable = false;
    }
    render() {
        return html `
      <div class="alert" role="alert">
        <div class="icon" aria-hidden="true">
          <slot name="icon" @slotchange=${this.handleIconSlotChange}>
            ${this.renderDefaultIcon()}
          </slot>
        </div>
        <div class="content">
          <div class="title"><slot name="title"></slot></div>
          <div class="message"><slot></slot></div>
        </div>
        <div class="actions"><slot name="action"></slot></div>
        ${this.renderCloseButton()}
      </div>
    `;
    }
    handleIconSlotChange() {
        // Hide the default icon container styling when a custom icon is provided.
        this.toggleAttribute("has-icon", this.iconElements.length > 0);
    }
    renderCloseButton() {
        if (!this.closeable) {
            return nothing;
        }
        return html `
      <button class="close" aria-label="Close" @click=${this.handleCloseClick}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6Z"
          ></path>
        </svg>
      </button>
    `;
    }
    handleCloseClick() {
        this.dispatchEvent(new Event("close", { bubbles: true, composed: true }));
    }
    renderDefaultIcon() {
        return html `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d=${DEFAULT_ICON_PATHS[this.severity]}></path>
      </svg>
    `;
    }
}
__decorate([
    property({ reflect: true })
], Alert.prototype, "severity", void 0);
__decorate([
    property({ reflect: true })
], Alert.prototype, "variant", void 0);
__decorate([
    property({ type: Boolean })
], Alert.prototype, "closeable", void 0);
__decorate([
    queryAssignedElements({ slot: "icon", flatten: true })
], Alert.prototype, "iconElements", void 0);
/** Default severity icons (Material Symbols glyph paths). */
const DEFAULT_ICON_PATHS = {
    // check_circle
    success: "M9.55 17.575 4.275 12.3l1.4-1.4 3.875 3.875 8.4-8.4 1.4 1.4Z",
    // info
    info: "M11 17h2v-6h-2Zm1-8q.425 0 .713-.288T13 8q0-.425-.288-.713T12 7q-.425 0-.713.288T11 8q0 .425.288.713T12 9Zm0 13q-2.075 0-3.9-.788t-3.175-2.137q-1.35-1.35-2.137-3.175T2 12q0-2.075.788-3.9t2.137-3.175q1.35-1.35 3.175-2.137T12 2q2.075 0 3.9.788t3.175 2.137q1.35 1.35 2.138 3.175T22 12q0 2.075-.788 3.9t-2.137 3.175q-1.35 1.35-3.175 2.138T12 22Z",
    // warning
    warning: "M1 21 12 2l11 19Zm11-3q.425 0 .713-.288T13 17q0-.425-.288-.713T12 16q-.425 0-.713.288T11 17q0 .425.288.713T12 18Zm-1-3h2v-5h-2Z",
    // error
    error: "M12 17q.425 0 .713-.288T13 16q0-.425-.288-.713T12 15q-.425 0-.713.288T11 16q0 .425.288.713T12 17Zm-1-4h2V7h-2Zm1 9q-2.075 0-3.9-.788t-3.175-2.137q-1.35-1.35-2.137-3.175T2 12q0-2.075.788-3.9t2.137-3.175q1.35-1.35 3.175-2.137T12 2q2.075 0 3.9.788t3.175 2.137q1.35 1.35 2.138 3.175T22 12q0 2.075-.788 3.9t-2.137 3.175q-1.35 1.35-3.175 2.138T12 22Z",
};
//# sourceMappingURL=alert.js.map
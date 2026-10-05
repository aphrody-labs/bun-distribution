/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, isServer, LitElement, nothing } from "lit";
import { property, query } from "lit/decorators.js";
/**
 * A Material 3 tooltip displays informative text when a user hovers over,
 * focuses, or touches an anchor element.
 *
 * The tooltip anchors to its trigger using CSS Anchor Positioning when
 * available, falling back to a JS-computed absolute position otherwise. The
 * trigger is resolved from the `for` attribute (an element id) or, when absent,
 * from the tooltip's parent element / a slotted `trigger` element.
 *
 * Plain tooltips show on hover/focus after a short delay and auto-hide; rich
 * tooltips remain visible while the pointer is over the trigger or the tooltip
 * itself, so their actions stay reachable.
 *
 * @fires tooltip-show {Event} Fired when the tooltip becomes visible.
 * @fires tooltip-hide {Event} Fired when the tooltip is hidden.
 */
export class Tooltip extends LitElement {
    constructor() {
        super(...arguments);
        /** Tooltip variant: `plain` (default) or `rich`. Reflected for styling. */
        this.variant = "plain";
        this.tooltipId = `md-tooltip-${Math.floor(Math.random() * 1e9)}`;
        /** Id of the anchor element this tooltip describes. */
        this.for = "";
        /** Supporting text for the plain variant (rich uses the default slot). */
        this.text = "";
        /** Delay in ms before a plain tooltip is shown on hover. */
        this.showDelay = 500;
        /** Delay in ms before a plain tooltip auto-hides after showing. */
        this.hideDelay = 1500;
        /** Whether the tooltip is currently visible. Reflected so CSS can target it. */
        this.visible = false;
        this.anchorEl = null;
        this.showTimer = -1;
        this.hideTimer = -1;
        this.pointerOverSurface = false;
        this.handleAnchorEnter = () => {
            this.scheduleShow();
        };
        this.handleAnchorLeave = () => {
            this.scheduleHide();
        };
        this.handleAnchorFocus = () => {
            this.scheduleShow();
        };
        this.handleAnchorBlur = () => {
            this.scheduleHide();
        };
        this.handleSurfaceEnter = () => {
            // Keeping the pointer on a rich tooltip keeps it open.
            this.pointerOverSurface = true;
            this.clearTimers();
        };
        this.handleSurfaceLeave = () => {
            this.pointerOverSurface = false;
            this.scheduleHide();
        };
    }
    /** Shows the tooltip immediately and dispatches `tooltip-show`. */
    show() {
        this.clearTimers();
        if (this.visible) {
            return;
        }
        this.visible = true;
        this.position();
        this.dispatchEvent(new Event("tooltip-show"));
        if (this.variant === "plain" && this.hideDelay > 0 && !isServer) {
            this.hideTimer = window.setTimeout(() => {
                this.hide();
            }, this.hideDelay);
        }
    }
    /** Hides the tooltip and dispatches `tooltip-hide`. */
    hide() {
        this.clearTimers();
        if (!this.visible) {
            return;
        }
        this.visible = false;
        this.dispatchEvent(new Event("tooltip-hide"));
    }
    connectedCallback() {
        super.connectedCallback();
        if (!isServer) {
            // Defer anchor resolution until the DOM around us has settled.
            queueMicrotask(() => {
                this.attachToAnchor();
            });
        }
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.detachFromAnchor();
        this.clearTimers();
    }
    updated(changed) {
        if (changed.has("for")) {
            this.detachFromAnchor();
            this.attachToAnchor();
        }
        if (changed.has("visible") && this.visible) {
            this.position();
        }
    }
    resolveAnchor() {
        if (this.for) {
            const root = this.getRootNode();
            const byId = root.getElementById?.(this.for);
            if (byId) {
                return byId;
            }
            return document.getElementById(this.for);
        }
        // Slotted trigger takes precedence over the parent.
        const slotted = this.querySelector('[slot="trigger"]');
        if (slotted) {
            return slotted;
        }
        return this.parentElement;
    }
    attachToAnchor() {
        const anchor = this.resolveAnchor();
        if (!anchor) {
            return;
        }
        this.anchorEl = anchor;
        if (!anchor.hasAttribute("aria-describedby") && this.id) {
            anchor.setAttribute("aria-describedby", this.id);
        }
        const supportsAnchor = typeof CSS !== "undefined" &&
            typeof CSS.supports === "function" &&
            CSS.supports("anchor-name: --x");
        if (supportsAnchor) {
            anchor.style.setProperty("anchor-name", `--${this.tooltipId}`);
            this.style.setProperty("--md-tooltip-anchor-name", `--${this.tooltipId}`);
        }
        anchor.addEventListener("pointerenter", this.handleAnchorEnter);
        anchor.addEventListener("pointerleave", this.handleAnchorLeave);
        anchor.addEventListener("focus", this.handleAnchorFocus);
        anchor.addEventListener("blur", this.handleAnchorBlur);
    }
    detachFromAnchor() {
        const anchor = this.anchorEl;
        if (!anchor) {
            return;
        }
        const supportsAnchor = typeof CSS !== "undefined" &&
            typeof CSS.supports === "function" &&
            CSS.supports("anchor-name: --x");
        if (supportsAnchor) {
            anchor.style.removeProperty("anchor-name");
            this.style.removeProperty("--md-tooltip-anchor-name");
        }
        anchor.removeEventListener("pointerenter", this.handleAnchorEnter);
        anchor.removeEventListener("pointerleave", this.handleAnchorLeave);
        anchor.removeEventListener("focus", this.handleAnchorFocus);
        anchor.removeEventListener("blur", this.handleAnchorBlur);
        this.anchorEl = null;
    }
    scheduleShow() {
        this.clearTimers();
        const delay = this.variant === "plain" ? this.showDelay : 0;
        if (isServer) {
            return;
        }
        if (delay <= 0) {
            this.show();
            return;
        }
        this.showTimer = window.setTimeout(() => {
            this.show();
        }, delay);
    }
    scheduleHide() {
        if (isServer) {
            return;
        }
        // Rich tooltips persist while the surface itself is hovered.
        if (this.variant === "rich" && this.pointerOverSurface) {
            return;
        }
        window.clearTimeout(this.showTimer);
        this.showTimer = -1;
        this.hideTimer = window.setTimeout(() => {
            if (this.variant === "rich" && this.pointerOverSurface) {
                return;
            }
            this.hide();
        }, 100);
    }
    clearTimers() {
        if (this.showTimer !== -1) {
            clearTimeout(this.showTimer);
            this.showTimer = -1;
        }
        if (this.hideTimer !== -1) {
            clearTimeout(this.hideTimer);
            this.hideTimer = -1;
        }
    }
    /**
     * Positions the tooltip below its anchor. With CSS Anchor Positioning this is
     * handled declaratively in CSS; this fallback runs when that API is missing.
     */
    position() {
        const surface = this.surface;
        const anchor = this.anchorEl;
        if (!surface || !anchor || isServer) {
            return;
        }
        const supportsAnchor = typeof CSS !== "undefined" &&
            typeof CSS.supports === "function" &&
            CSS.supports("anchor-name: --x");
        if (supportsAnchor) {
            // The CSS handles placement via position-anchor / inset-area.
            return;
        }
        const rect = anchor.getBoundingClientRect();
        surface.style.position = "fixed";
        surface.style.left = `${rect.left + rect.width / 2}px`;
        surface.style.top = `${rect.bottom + 8}px`;
        surface.style.transform = "translateX(-50%)";
    }
    render() {
        if (this.variant === "rich") {
            return html `
        <div
          class="tooltip rich"
          role="tooltip"
          @pointerenter=${this.handleSurfaceEnter}
          @pointerleave=${this.handleSurfaceLeave}
        >
          <div class="headline"><slot name="headline"></slot></div>
          <div class="supporting-text"><slot>${this.text}</slot></div>
          <div class="actions"><slot name="action"></slot></div>
        </div>
        ${this.renderTriggerSlot()}
      `;
        }
        return html `
      <div class="tooltip plain" role="tooltip">
        <slot>${this.text}</slot>
      </div>
      ${this.renderTriggerSlot()}
    `;
    }
    renderTriggerSlot() {
        // Only render the trigger slot when no `for` target is set, so the tooltip
        // can wrap its trigger inline.
        if (this.for) {
            return nothing;
        }
        return html `<slot name="trigger"></slot>`;
    }
}
__decorate([
    property({ reflect: true })
], Tooltip.prototype, "variant", void 0);
__decorate([
    property()
], Tooltip.prototype, "for", void 0);
__decorate([
    property()
], Tooltip.prototype, "text", void 0);
__decorate([
    property({ type: Number, attribute: "show-delay" })
], Tooltip.prototype, "showDelay", void 0);
__decorate([
    property({ type: Number, attribute: "hide-delay" })
], Tooltip.prototype, "hideDelay", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], Tooltip.prototype, "visible", void 0);
__decorate([
    query(".tooltip")
], Tooltip.prototype, "surface", void 0);
//# sourceMappingURL=tooltip.js.map
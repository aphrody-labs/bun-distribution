/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, isServer, LitElement, nothing } from "lit";
import { property, query, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import "../../elevation/elevation.js";
/**
 * A floating surface anchored to an element — the Material 3 equivalent of
 * MUI's `Popover`/`Popper`.
 *
 * Built on the native **Popover API**: the surface carries `popover="auto"` so
 * it lives in the browser top layer (never clipped by `overflow`, light-
 * dismissable, Escape-closable) without any JS z-index juggling. When the
 * platform also supports **CSS Anchor Positioning**, placement is fully
 * declarative via `anchor-name` / `position-area`. On engines without anchor
 * positioning (Firefox/Safari at time of writing), a small
 * `getBoundingClientRect`-based fallback positions the surface in JS and keeps
 * it in sync on scroll/resize while open.
 *
 * Feature support is detected at runtime:
 * - Popover API: `HTMLElement.prototype.hasOwnProperty('popover')`. When
 *   absent, the surface degrades to a plain absolutely-positioned element
 *   (still positioned by the JS fallback) — it simply will not be promoted to
 *   the top layer.
 * - CSS Anchor Positioning: `CSS.supports('anchor-name: --x')`. When absent the
 *   JS fallback owns positioning.
 *
 * ```html
 * <button id="trigger">Open</button>
 * <md-popover anchor="trigger" placement="bottom-start">
 *   <p>Floating content</p>
 * </md-popover>
 * ```
 *
 * @fires opened {Event} Fired once the popover is shown.
 * @fires closed {Event} Fired once the popover is hidden.
 */
export class Popover extends LitElement {
    constructor() {
        super(...arguments);
        /** Whether the popover is open. Reflected so CSS can target `[open]`. */
        this.open = false;
        /**
         * The anchor element, or the `id` of an element in the same document. The
         * popover positions itself relative to this element.
         */
        this.anchor = "";
        /** Where to place the surface relative to the anchor. */
        this.placement = "bottom";
        /**
         * The position computed by the JS fallback (engines without CSS Anchor
         * Positioning). `null` while the declarative anchor path owns positioning, so
         * no inline coordinates leak onto the surface in that case.
         */
        this.fallbackPosition = null;
        /** True when the native Popover API is available. */
        this.supportsPopover = !isServer && Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "popover");
        /** True when CSS Anchor Positioning is available. */
        this.supportsAnchor = !isServer &&
            typeof CSS !== "undefined" &&
            typeof CSS.supports === "function" &&
            CSS.supports("anchor-name: --x");
        this.cleanup = null;
    }
    /** Opens the popover. */
    show() {
        this.open = true;
    }
    /** Closes the popover. */
    close() {
        this.open = false;
    }
    /** Toggles the popover open/closed. */
    toggle() {
        this.open = !this.open;
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.teardownFallback();
    }
    updated(changed) {
        if (changed.has("open")) {
            if (this.open) {
                this.showSurface();
            }
            else {
                this.hideSurface();
            }
        }
    }
    resolveAnchor() {
        if (this.anchor instanceof HTMLElement) {
            return this.anchor;
        }
        if (typeof this.anchor === "string" && this.anchor) {
            return (this.getRootNode().getElementById?.(this.anchor) ??
                document.getElementById(this.anchor));
        }
        return null;
    }
    showSurface() {
        const s = this.surface;
        if (!s) {
            return;
        }
        if (this.supportsPopover &&
            typeof s.showPopover === "function" &&
            !s.matches(":popover-open")) {
            s.showPopover();
        }
        if (!this.supportsAnchor) {
            this.setupFallback();
        }
        this.dispatchEvent(new Event("opened", { bubbles: true, composed: true }));
    }
    hideSurface() {
        const s = this.surface;
        if (s &&
            this.supportsPopover &&
            typeof s.hidePopover === "function" &&
            s.matches(":popover-open")) {
            s.hidePopover();
        }
        this.teardownFallback();
        this.dispatchEvent(new Event("closed", { bubbles: true, composed: true }));
    }
    /** JS positioning fallback for engines without CSS Anchor Positioning. */
    setupFallback() {
        this.teardownFallback();
        if (isServer) {
            return;
        }
        const reposition = () => this.position();
        reposition();
        window.addEventListener("scroll", reposition, true);
        window.addEventListener("resize", reposition);
        this.cleanup = () => {
            window.removeEventListener("scroll", reposition, true);
            window.removeEventListener("resize", reposition);
        };
    }
    teardownFallback() {
        this.cleanup?.();
        this.cleanup = null;
        this.fallbackPosition = null;
    }
    position() {
        const s = this.surface;
        const anchor = this.resolveAnchor();
        if (!s || !anchor) {
            return;
        }
        const a = anchor.getBoundingClientRect();
        const surfaceRect = s.getBoundingClientRect();
        const gap = 8;
        const [side, align = "center"] = this.placement.split("-");
        let top = 0;
        let left = 0;
        switch (side) {
            case "top":
                top = a.top - surfaceRect.height - gap;
                left = this.alignMain(a.left, a.width, surfaceRect.width, align);
                break;
            case "left":
                left = a.left - surfaceRect.width - gap;
                top = this.alignCross(a.top, a.height, surfaceRect.height, align);
                break;
            case "right":
                left = a.right + gap;
                top = this.alignCross(a.top, a.height, surfaceRect.height, align);
                break;
            case "bottom":
            default:
                top = a.bottom + gap;
                left = this.alignMain(a.left, a.width, surfaceRect.width, align);
                break;
        }
        // Clamp into the viewport.
        const maxLeft = window.innerWidth - surfaceRect.width - gap;
        const maxTop = window.innerHeight - surfaceRect.height - gap;
        left = Math.max(gap, Math.min(left, maxLeft));
        top = Math.max(gap, Math.min(top, maxTop));
        // Drive positioning through reactive state + `styleMap` rather than
        // mutating `surface.style` imperatively.
        this.fallbackPosition = { top: Math.round(top), left: Math.round(left) };
    }
    /** Align along the anchor's main (horizontal for top/bottom) axis. */
    alignMain(start, anchorSize, size, align) {
        if (align === "start") {
            return start;
        }
        if (align === "end") {
            return start + anchorSize - size;
        }
        return start + anchorSize / 2 - size / 2;
    }
    /** Align along the cross (vertical for left/right) axis. */
    alignCross(start, anchorSize, size, align) {
        return this.alignMain(start, anchorSize, size, align);
    }
    render() {
        // `popover="auto"` gives top-layer rendering + light dismiss when the API
        // is present; the attribute is harmless on engines that ignore it.
        const pos = this.fallbackPosition;
        const surfaceStyles = pos
            ? styleMap({
                position: "fixed",
                margin: "0",
                left: `${pos.left}px`,
                top: `${pos.top}px`,
            })
            : nothing;
        return html `
      <div
        class="surface"
        part="surface"
        popover="auto"
        role="dialog"
        style=${surfaceStyles}
        @toggle=${this.handleToggle}
      >
        <md-elevation part="elevation"></md-elevation>
        <slot></slot>
      </div>
    `;
    }
    /** Keep `open` in sync when the surface is light-dismissed by the platform. */
    handleToggle(event) {
        const toggle = event;
        if (toggle.newState === "closed" && this.open) {
            this.open = false;
        }
        else if (toggle.newState === "open" && !this.open) {
            this.open = true;
        }
    }
}
__decorate([
    property({ type: Boolean, reflect: true })
], Popover.prototype, "open", void 0);
__decorate([
    property()
], Popover.prototype, "anchor", void 0);
__decorate([
    property({ reflect: true })
], Popover.prototype, "placement", void 0);
__decorate([
    query(".surface")
], Popover.prototype, "surface", void 0);
__decorate([
    state()
], Popover.prototype, "fallbackPosition", void 0);
//# sourceMappingURL=popover.js.map
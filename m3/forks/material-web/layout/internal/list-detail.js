/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, isServer, LitElement } from "lit";
import { property, state } from "lit/decorators.js";
import { classifyWidth } from "./scaffold.js";
/**
 * Material 3 list-detail canonical layout. From the Expanded breakpoint up
 * (>= 840dp), the list and detail panes appear side by side — a fixed ~360px
 * list leading, a flexible detail trailing — separated by the 24dp pane spacer
 * (`PANE_SPACER_DP` in `adaptive.rs`). In Compact / Medium (< 840dp) only one
 * pane shows at a time; {@link showDetail} / {@link showList} navigate between
 * them.
 *
 * The leading edge is logical (`list` leads), so the layout mirrors correctly
 * for right-to-left languages without extra work.
 *
 * @slot list - The list / index pane (leading).
 * @slot detail - The detail pane (trailing, flexible).
 *
 * @fires list-detail:showing-change {CustomEvent<ListDetailShowingChangeDetail>}
 *     Fired when the visible pane changes in single-pane mode.
 */
export class ListDetail extends LitElement {
    constructor() {
        super(...arguments);
        /**
         * Which pane is visible in single-pane mode. Reflected so CSS can target
         * `[showing='list']` / `[showing='detail']`. Ignored when both panes are
         * shown (expanded and up).
         */
        this.showing = "list";
        /** Width in pixels of the fixed list pane in dual-pane mode (M3 ~360px). */
        this.listWidth = 360;
        /**
         * The resolved window size class. Reflected to `size-class`. `true` dual-pane
         * threshold is Expanded (>= 840dp) per the M3 list-detail guidance.
         */
        this.sizeClass = "compact";
        this.dual = false;
        this.resizeObserver = null;
    }
    /** Whether both panes are visible side by side (Expanded breakpoint and up). */
    get isDualPane() {
        return this.dual;
    }
    /** Shows the detail pane (single-pane mode); no-op in dual-pane mode. */
    showDetail() {
        this.setShowing("detail");
    }
    /** Shows the list pane (single-pane mode); no-op in dual-pane mode. */
    showList() {
        this.setShowing("list");
    }
    setShowing(pane) {
        if (this.dual || this.showing === pane) {
            return;
        }
        const update = () => {
            this.showing = pane;
            this.dispatchEvent(new CustomEvent("list-detail:showing-change", {
                detail: { showing: pane, sizeClass: this.sizeClass },
                bubbles: true,
                composed: true,
            }));
            return this.updateComplete;
        };
        if (!isServer && typeof document !== "undefined" && "startViewTransition" in document) {
            document.startViewTransition(update);
        }
        else {
            update();
        }
    }
    connectedCallback() {
        super.connectedCallback();
        if (isServer || typeof ResizeObserver === "undefined") {
            return;
        }
        this.resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                this.applyWidth(entry.contentRect.width);
            }
        });
        this.resizeObserver.observe(this);
        this.applyWidth(this.getBoundingClientRect().width);
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }
    applyWidth(width) {
        if (width <= 0) {
            return;
        }
        const nextSizeClass = classifyWidth(width);
        const nextDual = width >= 840;
        if (nextSizeClass === this.sizeClass && nextDual === this.dual) {
            return;
        }
        const update = () => {
            this.sizeClass = nextSizeClass;
            this.dual = nextDual;
            return this.updateComplete;
        };
        if (!isServer && typeof document !== "undefined" && "startViewTransition" in document) {
            document.startViewTransition(update);
        }
        else {
            update();
        }
    }
    render() {
        const listStyle = this.dual
            ? `flex: 0 0 ${this.listWidth}px; inline-size: ${this.listWidth}px;`
            : "";
        return html `
      <div class="container" part="container">
        <div class="list" part="list" style=${listStyle}>
          <slot name="list"></slot>
        </div>
        <div class="detail" part="detail">
          <slot name="detail"></slot>
        </div>
      </div>
    `;
    }
}
__decorate([
    property({ reflect: true })
], ListDetail.prototype, "showing", void 0);
__decorate([
    property({ type: Number, attribute: "list-width" })
], ListDetail.prototype, "listWidth", void 0);
__decorate([
    property({ reflect: true, attribute: "size-class" })
], ListDetail.prototype, "sizeClass", void 0);
__decorate([
    state()
], ListDetail.prototype, "dual", void 0);
//# sourceMappingURL=list-detail.js.map
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, isServer, LitElement, nothing } from "lit";
import { property, query, state } from "lit/decorators.js";
import { animationOptions, prefersReducedMotion, } from "../../internal/motion/easing-and-duration.js";
const supportsCSSAnimation = !isServer && window.CSS && CSS.supports("transition-behavior", "allow-discrete");
async function waitForTransitionEnd(element) {
    return new Promise((resolve) => {
        let done = false;
        const handler = (event) => {
            if (event.target === element) {
                element.removeEventListener("transitionend", handler);
                done = true;
                resolve();
            }
        };
        element.addEventListener("transitionend", handler);
        setTimeout(() => {
            if (!done) {
                element.removeEventListener("transitionend", handler);
                resolve();
            }
        }, 1000);
    });
}
/**
 * A bottom sheet anchors supplementary content to the bottom edge of the
 * screen. It slides up from the bottom and, when `modal`, dims the rest of the
 * UI with a scrim that closes the sheet when clicked.
 *
 * Implements the Material 3 bottom-sheet spec (drag handle, modal scrim,
 * swipe-down to dismiss) on top of the `--md-sys-*` design tokens, painting its
 * own elevation so it carries no dependency on `md-elevation`.
 *
 * @fires bottom-sheet:opening {Event} Fired when the sheet begins to open.
 * @fires bottom-sheet:opened {Event} Fired once the open animation finishes.
 * @fires bottom-sheet:closing {Event} Fired when the sheet begins to close.
 * @fires bottom-sheet:closed {Event} Fired once the close animation finishes.
 */
export class BottomSheet extends LitElement {
    constructor() {
        super(...arguments);
        /** Whether the sheet is open. Reflected so CSS can target `[open]`. */
        this.open = false;
        /**
         * When true, renders a scrim that dims the rest of the UI and closes the
         * sheet when clicked, and lets Escape dismiss the sheet.
         */
        this.modal = false;
        this.animating = false;
        this.dragStartY = 0;
        this.dragDelta = 0;
        this.dragging = false;
        this.handleKeydown = (event) => {
            if (event.key === "Escape" && this.modal && this.open) {
                event.stopPropagation();
                void this.close();
            }
        };
    }
    /**
     * Opens the sheet. Resolves when the open animation has finished.
     */
    async show() {
        if (this.open) {
            return;
        }
        this.open = true;
        this.dispatchEvent(new Event("bottom-sheet:opening"));
        await this.animateOpen(true);
        this.dispatchEvent(new Event("bottom-sheet:opened"));
    }
    /**
     * Closes the sheet. Resolves once the close animation has finished.
     */
    async close() {
        if (!this.open) {
            return;
        }
        this.dispatchEvent(new Event("bottom-sheet:closing"));
        if (supportsCSSAnimation) {
            this.open = false;
            await this.animateOpen(false);
        }
        else {
            await this.animateOpen(false);
            this.open = false;
        }
        this.dispatchEvent(new Event("bottom-sheet:closed"));
    }
    connectedCallback() {
        super.connectedCallback();
        if (!isServer) {
            this.addEventListener("keydown", this.handleKeydown);
        }
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        if (!isServer) {
            this.removeEventListener("keydown", this.handleKeydown);
        }
    }
    render() {
        return html `
      ${this.modal ? this.renderScrim() : nothing}
      <div
        class="sheet ${this.animating ? "animating" : ""}"
        role="dialog"
        aria-modal=${this.modal ? "true" : "false"}
      >
        <div
          class="handle"
          role="button"
          tabindex="0"
          aria-label="Drag handle"
          @pointerdown=${this.handleDragStart}
          @pointermove=${this.handleDragMove}
          @pointerup=${this.handleDragEnd}
          @pointercancel=${this.handleDragEnd}
        >
          <div class="grip"></div>
        </div>
        <div class="content">
          <slot></slot>
        </div>
      </div>
    `;
    }
    renderScrim() {
        return html `<div class="scrim" @click=${this.handleScrimClick}></div>`;
    }
    handleScrimClick() {
        void this.close();
    }
    handleDragStart(event) {
        this.dragging = true;
        this.dragStartY = event.clientY;
        this.dragDelta = 0;
        event.target.setPointerCapture(event.pointerId);
    }
    handleDragMove(event) {
        if (!this.dragging) {
            return;
        }
        this.dragDelta = Math.max(0, event.clientY - this.dragStartY);
        const surface = this.surface;
        if (surface) {
            surface.style.transform = `translateY(${this.dragDelta}px)`;
        }
    }
    handleDragEnd(event) {
        if (!this.dragging) {
            return;
        }
        this.dragging = false;
        event.target.releasePointerCapture(event.pointerId);
        const surface = this.surface;
        const height = surface ? surface.offsetHeight : 0;
        // Dismiss when dragged past a quarter of the sheet height.
        if (this.dragDelta > height / 4) {
            if (surface) {
                surface.style.transform = "";
            }
            void this.close();
        }
        else if (surface) {
            surface.style.transform = "";
        }
    }
    async animateOpen(opening) {
        const surface = this.surface;
        if (!surface || isServer || prefersReducedMotion()) {
            return;
        }
        this.animating = true;
        if (supportsCSSAnimation) {
            await waitForTransitionEnd(surface);
        }
        else if (surface.animate) {
            const from = { transform: "translateY(100%)", opacity: "0" };
            const to = { transform: "translateY(0)", opacity: "1" };
            const frames = opening ? [from, to] : [to, from];
            const anim = surface.animate(frames, animationOptions(opening ? "MEDIUM2" : "SHORT4", opening ? "EMPHASIZED_DECELERATE" : "EMPHASIZED_ACCELERATE"));
            try {
                await anim.finished;
            }
            catch {
                // Animation cancelled; ignore.
            }
        }
        this.animating = false;
    }
}
__decorate([
    property({ type: Boolean, reflect: true })
], BottomSheet.prototype, "open", void 0);
__decorate([
    property({ type: Boolean })
], BottomSheet.prototype, "modal", void 0);
__decorate([
    state()
], BottomSheet.prototype, "animating", void 0);
__decorate([
    query(".sheet")
], BottomSheet.prototype, "surface", void 0);
//# sourceMappingURL=bottom-sheet.js.map
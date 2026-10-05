/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, isServer, LitElement, nothing } from "lit";
import { property, query, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
/**
 * A rating lets users view and optionally set a value on an ordinal scale —
 * the Material 3 / MUI `Rating` equivalent. It renders a row of star icons;
 * the active portion uses `--md-sys-color-primary`, the inactive portion
 * `--md-sys-color-outline`.
 *
 * The default icon is a filled star. Provide a custom icon by slotting an
 * element (e.g. an `<svg>` or `<md-icon>`) into the default slot — it is
 * cloned for every item and clipped for half-star fills.
 *
 * Implemented on top of the `--md-sys-*` tokens and self-contained. The element
 * is form-associated: when a `name` is set it contributes its `value` to the
 * enclosing `<form>`. It fires native `input` (on hover-commit/keyboard change)
 * and `change` events; read the value via `event.target.value`.
 *
 * @fires input {Event} Fired when the value changes via user interaction.
 * @fires change {Event} Fired when the value is committed.
 */
export class Rating extends LitElement {
    constructor() {
        super(...arguments);
        /** The current rating value. */
        this.value = 0;
        /** The maximum rating (number of icons). */
        this.max = 5;
        /**
         * The minimum increment. `1` for whole-star ratings, `0.5` to allow
         * half-stars. Any other value is treated as `1`.
         */
        this.precision = 1;
        /** When true, the rating is displayed but cannot be changed. */
        this.readonly = false;
        /** When true, the rating is non-interactive and dimmed. */
        this.disabled = false;
        /** The form name for the contributed value. */
        this.name = "";
        /** The hover-preview value, or `-1` when not hovering. */
        this.hoverValue = -1;
        this.internals = 
        // Cast needed: `attachInternals` is not in older lib.dom typings.
        this.attachInternals?.();
        this.handleMouseLeave = () => {
            this.hoverValue = -1;
        };
    }
    static { this.formAssociated = true; }
    /** The owning form, when the element is form-associated. */
    get form() {
        return this.internals?.form ?? null;
    }
    connectedCallback() {
        super.connectedCallback();
        if (!isServer) {
            this.addEventListener("mouseleave", this.handleMouseLeave);
        }
    }
    disconnectedCallback() {
        super.disconnectedCallback();
        this.removeEventListener("mouseleave", this.handleMouseLeave);
    }
    willUpdate(changed) {
        if (changed.has("value") || changed.has("name")) {
            this.internals?.setFormValue(this.value ? String(this.value) : null);
        }
    }
    updated(changed) {
        // Only touch the accessibility tree when an input to it actually changed.
        const ariaInputs = ["value", "max", "readonly", "disabled"];
        if (this.internals && ariaInputs.some((key) => changed.has(key))) {
            this.internals.role = this.readonly ? "img" : "slider";
            this.internals.ariaDisabled = this.disabled ? "true" : null;
            if (this.readonly) {
                this.internals.ariaValueMin = null;
                this.internals.ariaValueMax = null;
                this.internals.ariaValueNow = null;
            }
            else {
                this.internals.ariaValueMin = "0";
                this.internals.ariaValueMax = String(this.max);
                this.internals.ariaValueNow = String(this.value);
            }
            this.internals.ariaValueText = `${this.value} of ${this.max}`;
        }
    }
    get step() {
        return this.precision === 0.5 ? 0.5 : 1;
    }
    /** The value currently shown (hover preview wins over `value`). */
    get displayValue() {
        return this.hoverValue >= 0 ? this.hoverValue : this.value;
    }
    render() {
        const interactive = !this.readonly && !this.disabled;
        const items = [];
        for (let i = 0; i < this.max; i++) {
            items.push(this.renderItem(i, interactive));
        }
        return html `
      <div
        class="rating"
        tabindex=${interactive ? "0" : "-1"}
        @keydown=${interactive ? this.handleKeydown : nothing}
      >
        ${items}
      </div>
      <span hidden><slot @slotchange=${this.handleSlotChange}></slot></span>
    `;
    }
    renderItem(index, interactive) {
        const display = this.displayValue;
        // Fraction of this star that is filled, 0–1.
        const raw = display - index;
        const fill = Math.max(0, Math.min(1, raw));
        const fillPct = `${fill * 100}%`;
        return html `
      <button
        class="item"
        type="button"
        tabindex="-1"
        aria-hidden="true"
        ?data-readonly=${!interactive}
        style=${styleMap({ "--_fill": fillPct })}
        @click=${interactive ? (e) => this.handleClick(index, e) : nothing}
        @mousemove=${interactive ? (e) => this.handleMouseMove(index, e) : nothing}
      >
        <span class="icon">${this.renderIcon()}</span>
        <span class="active"><span class="icon">${this.renderIcon()}</span></span>
      </button>
    `;
    }
    renderIcon() {
        return html `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="m12 17.27 6.18 3.73-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
        ></path>
      </svg>
    `;
    }
    /** Translate the pointer x-position within an item to a fractional value. */
    valueFromPointer(index, event) {
        const target = event.currentTarget;
        const rect = target.getBoundingClientRect();
        const rtl = getComputedStyle(this).direction === "rtl";
        const ratio = rtl
            ? (rect.right - event.clientX) / rect.width
            : (event.clientX - rect.left) / rect.width;
        if (this.step === 0.5) {
            return index + (ratio <= 0.5 ? 0.5 : 1);
        }
        return index + 1;
    }
    handleMouseMove(index, event) {
        this.hoverValue = this.valueFromPointer(index, event);
    }
    handleClick(index, event) {
        const next = this.valueFromPointer(index, event);
        this.commit(next);
    }
    handleKeydown(event) {
        const step = this.step;
        let next = this.value;
        switch (event.key) {
            case "ArrowRight":
            case "ArrowUp":
                next = Math.min(this.max, this.value + step);
                break;
            case "ArrowLeft":
            case "ArrowDown":
                next = Math.max(0, this.value - step);
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = this.max;
                break;
            default:
                return;
        }
        event.preventDefault();
        this.hoverValue = -1;
        this.commit(next);
    }
    commit(next) {
        if (next === this.value) {
            return;
        }
        this.value = next;
        this.hoverValue = -1;
        this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
    }
    handleSlotChange() {
        // Custom icon support: re-render so the slotted node is reflected. The
        // slotted content is hidden; styling is driven by `::slotted` in CSS.
        this.requestUpdate();
    }
    /** Reset the value when the owning form is reset. */
    formResetCallback() {
        this.value = 0;
        this.hoverValue = -1;
    }
    /** Restore the value when the form state is restored. */
    formStateRestoreCallback(formState) {
        const restored = Number(formState);
        if (!Number.isNaN(restored)) {
            this.value = restored;
        }
    }
    focus() {
        this.list?.focus();
    }
}
__decorate([
    property({ type: Number })
], Rating.prototype, "value", void 0);
__decorate([
    property({ type: Number })
], Rating.prototype, "max", void 0);
__decorate([
    property({ type: Number })
], Rating.prototype, "precision", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], Rating.prototype, "readonly", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], Rating.prototype, "disabled", void 0);
__decorate([
    property()
], Rating.prototype, "name", void 0);
__decorate([
    state()
], Rating.prototype, "hoverValue", void 0);
__decorate([
    query(".rating")
], Rating.prototype, "list", void 0);
//# sourceMappingURL=rating.js.map
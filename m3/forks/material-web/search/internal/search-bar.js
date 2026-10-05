/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, isServer, LitElement, nothing } from "lit";
import { property, query, state } from "lit/decorators.js";
/**
 * A search bar with an expanding search view, implementing the Material 3
 * search pattern. The bar shows a leading search icon, an input, and optional
 * trailing content; focusing it opens a view that hosts the slotted results
 * (typically an `<md-list>`).
 *
 * @fires input {Event} Re-dispatched from the internal input on every keystroke.
 * @fires search {CustomEvent<{value: string}>} Fired when the user submits
 *     (Enter) the query.
 * @fires search:open {Event} Fired when the search view opens.
 * @fires search:close {Event} Fired when the search view closes.
 */
export class SearchBar extends LitElement {
    constructor() {
        super(...arguments);
        /** Current query text. */
        this.value = "";
        /** Placeholder / supporting text shown when empty. */
        this.placeholder = "Search";
        /** Accessible name for the results region. */
        this.resultsLabel = "Search results";
        /** How the results view expands. */
        this.view = "docked";
        /** Whether the search view is open. */
        this.open = false;
        this.hasResults = false;
    }
    /** Opens the search view and focuses the input. */
    show() {
        if (this.open) {
            return;
        }
        this.open = true;
        this.dispatchEvent(new Event("search:open"));
        if (!isServer) {
            requestAnimationFrame(() => this.input?.focus());
        }
    }
    /** Closes the search view. */
    close() {
        if (!this.open) {
            return;
        }
        this.open = false;
        this.dispatchEvent(new Event("search:close"));
    }
    render() {
        return html `
      <div class="bar" @click=${this.show}>
        <span class="leading" aria-hidden="true">
          <slot name="leading">
            <svg viewBox="0 0 24 24" class="search-icon">
              <path
                d="M9.5 16q-2.725 0-4.612-1.888Q3 12.225 3 9.5q0-2.725 1.888-4.613Q6.775 3 9.5 3t4.613 1.887Q16 6.775 16 9.5q0 1.1-.35 2.075-.35.975-.95 1.725l5.55 5.55q.275.275.275.7 0 .425-.275.7-.275.275-.7.275-.425 0-.7-.275l-5.55-5.55q-.75.6-1.725.95Q10.6 16 9.5 16Zm0-2q1.875 0 3.188-1.312Q14 11.375 14 9.5q0-1.875-1.312-3.188Q11.375 5 9.5 5 7.625 5 6.312 6.312 5 7.625 5 9.5q0 1.875 1.312 3.188Q7.625 14 9.5 14Z"
              />
            </svg>
          </slot>
        </span>
        <input
          type="search"
          part="input"
          .value=${this.value}
          placeholder=${this.placeholder}
          aria-label=${this.placeholder}
          role="combobox"
          aria-expanded=${this.open ? "true" : "false"}
          aria-controls="search-results"
          aria-autocomplete="list"
          autocomplete="off"
          @input=${this.handleInput}
          @keydown=${this.handleKeydown}
          @focus=${this.show}
        />
        ${this.open
            ? html `<button class="close" aria-label="Close search" @click=${this.handleCloseClick}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="m12 13.4-4.9 4.9q-.275.275-.7.275-.425 0-.7-.275-.275-.275-.275-.7 0-.425.275-.7l4.9-4.9-4.9-4.9q-.275-.275-.275-.7 0-.425.275-.7.275-.275.7-.275.425 0 .7.275l4.9 4.9 4.9-4.9q.275-.275.7-.275.425 0 .7.275.275.275.275.7 0 .425-.275.7L13.4 12l4.9 4.9q.275.275.275.7 0 .425-.275.7-.275.275-.7.275-.425 0-.7-.275Z"
                />
              </svg>
            </button>`
            : html `<span class="trailing"><slot name="trailing"></slot></span>`}
      </div>
      <div
        id="search-results"
        class="view"
        part="view"
        role="region"
        aria-label=${this.resultsLabel}
        ?hidden=${!this.open || !this.hasResults}
      >
        <slot @slotchange=${this.handleResultsChange}></slot>
      </div>
      ${this.open && this.view === "fullscreen"
            ? html `<div class="scrim" @click=${this.handleCloseClick}></div>`
            : nothing}
    `;
    }
    handleInput(event) {
        this.value = event.target.value;
        this.show();
    }
    handleKeydown(event) {
        if (event.key === "Enter") {
            this.dispatchEvent(new CustomEvent("search", { detail: { value: this.value } }));
        }
        else if (event.key === "Escape") {
            this.close();
        }
    }
    handleCloseClick(event) {
        event.stopPropagation();
        this.close();
    }
    handleResultsChange(event) {
        const slot = event.target;
        this.hasResults = slot.assignedElements({ flatten: true }).length > 0;
    }
}
__decorate([
    property()
], SearchBar.prototype, "value", void 0);
__decorate([
    property()
], SearchBar.prototype, "placeholder", void 0);
__decorate([
    property({ attribute: "results-label" })
], SearchBar.prototype, "resultsLabel", void 0);
__decorate([
    property({ reflect: true })
], SearchBar.prototype, "view", void 0);
__decorate([
    property({ type: Boolean, reflect: true })
], SearchBar.prototype, "open", void 0);
__decorate([
    state()
], SearchBar.prototype, "hasResults", void 0);
__decorate([
    query("input")
], SearchBar.prototype, "input", void 0);
//# sourceMappingURL=search-bar.js.map
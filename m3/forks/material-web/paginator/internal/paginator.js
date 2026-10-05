/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { __decorate } from "tslib";
import { html, LitElement } from "lit";
import { property } from "lit/decorators.js";
/**
 * A Material 3 paginator. Drives navigation over a paged collection: a
 * "Items per page" selector, a "{start}–{end} of {length}" range label and
 * first/previous/next/last navigation buttons that disable themselves at the
 * bounds.
 *
 * Implements the Material 3 paginator pattern on top of the `--md-sys-*`
 * tokens. It is fully autonomous — no `md-*` sub-components, no compiled CSS
 * results; colours and shape are expressed directly via tokens with literal
 * fallbacks.
 *
 * @fires paginator:page {CustomEvent<PaginatorPageEventDetail>} Fired whenever
 *     the page index or page size changes (navigation or selector).
 */
export class Paginator extends LitElement {
    constructor() {
        super(...arguments);
        /** Total number of items being paginated. */
        this.length = 0;
        /** Number of items shown per page. */
        this.pageSize = 10;
        /** The current (zero-based) page index. */
        this.pageIndex = 0;
        /** Selectable page sizes shown in the selector. */
        this.pageSizeOptions = [5, 10, 25, 50];
        this.goFirst = () => {
            this.setPageIndex(0);
        };
        this.goPrevious = () => {
            this.setPageIndex(this.pageIndex - 1);
        };
        this.goNext = () => {
            this.setPageIndex(this.pageIndex + 1);
        };
        this.goLast = () => {
            this.setPageIndex(this.pageCount - 1);
        };
        this.handlePageSizeChange = (event) => {
            const value = Number(event.target.value);
            if (!Number.isFinite(value) || value <= 0 || value === this.pageSize) {
                return;
            }
            // Keep the first visible item stable across the page-size change.
            const firstItem = this.pageIndex * this.pageSize;
            this.pageSize = value;
            this.pageIndex = this.clampIndex(Math.floor(firstItem / value));
            this.emitPage();
        };
    }
    /** The total number of pages for the current length and page size. */
    get pageCount() {
        if (this.pageSize <= 0) {
            return 0;
        }
        return Math.ceil(this.length / this.pageSize);
    }
    /** The (zero-based) index of the first item on the current page. */
    get rangeStart() {
        if (this.length === 0 || this.pageSize <= 0) {
            return 0;
        }
        return this.pageIndex * this.pageSize;
    }
    /** The (one-based, exclusive-friendly) index of the last item on the page. */
    get rangeEnd() {
        if (this.length === 0 || this.pageSize <= 0) {
            return 0;
        }
        const start = this.rangeStart;
        return Math.min(start + this.pageSize, this.length);
    }
    get hasPrevious() {
        return this.pageIndex >= 1 && this.length > 0;
    }
    get hasNext() {
        return this.pageIndex < this.pageCount - 1 && this.length > 0;
    }
    render() {
        const start = this.length === 0 ? 0 : this.rangeStart + 1;
        const end = this.rangeEnd;
        return html `
      <div class="paginator" role="group" aria-label="Pagination">
        <div class="page-size">
          <span class="page-size-label" id="page-size-label">Items per page:</span>
          <span class="select-wrapper">
            <select
              class="select"
              aria-labelledby="page-size-label"
              .value=${String(this.pageSize)}
              @change=${this.handlePageSizeChange}
            >
              ${this.pageSizeOptions.map((size) => html `
                  <option value=${size} ?selected=${size === this.pageSize}>${size}</option>
                `)}
            </select>
            <span class="select-arrow" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"></path></svg>
            </span>
          </span>
        </div>

        <div class="range-label" aria-live="polite">${start}–${end} of ${this.length}</div>

        <div class="actions">
          ${this.renderNavButton("First page", !this.hasPrevious, this.goFirst, "M18.41 16.59 13.82 12l4.59-4.59L17 6l-6 6 6 6zM6 6h2v12H6z")}
          ${this.renderNavButton("Previous page", !this.hasPrevious, this.goPrevious, "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z")}
          ${this.renderNavButton("Next page", !this.hasNext, this.goNext, "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z")}
          ${this.renderNavButton("Last page", !this.hasNext, this.goLast, "M5.59 7.41 10.18 12l-4.59 4.59L7 18l6-6-6-6zM16 6h2v12h-2z")}
        </div>
      </div>
    `;
    }
    renderNavButton(label, disabled, handler, path) {
        return html `
      <button
        type="button"
        class="icon-button"
        aria-label=${label}
        ?disabled=${disabled}
        @click=${handler}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d=${path}></path></svg>
      </button>
    `;
    }
    clampIndex(index) {
        const max = Math.max(0, this.pageCount - 1);
        if (index < 0) {
            return 0;
        }
        if (index > max) {
            return max;
        }
        return index;
    }
    setPageIndex(index) {
        const next = this.clampIndex(index);
        if (next === this.pageIndex) {
            return;
        }
        this.pageIndex = next;
        this.emitPage();
    }
    emitPage() {
        this.dispatchEvent(new CustomEvent("paginator:page", {
            detail: {
                pageIndex: this.pageIndex,
                pageSize: this.pageSize,
                length: this.length,
            },
            bubbles: true,
            composed: true,
        }));
    }
}
__decorate([
    property({ type: Number })
], Paginator.prototype, "length", void 0);
__decorate([
    property({ type: Number, attribute: "page-size" })
], Paginator.prototype, "pageSize", void 0);
__decorate([
    property({ type: Number, attribute: "page-index" })
], Paginator.prototype, "pageIndex", void 0);
__decorate([
    property({ attribute: false })
], Paginator.prototype, "pageSizeOptions", void 0);
//# sourceMappingURL=paginator.js.map
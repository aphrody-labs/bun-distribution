/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement } from "lit";
/**
 * `detail` of the `paginator:page` event.
 */
export interface PaginatorPageEventDetail {
    /** The new (zero-based) page index. */
    pageIndex: number;
    /** The current page size. */
    pageSize: number;
    /** The total number of items being paginated. */
    length: number;
}
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
export declare class Paginator extends LitElement {
    /** Total number of items being paginated. */
    length: number;
    /** Number of items shown per page. */
    pageSize: number;
    /** The current (zero-based) page index. */
    pageIndex: number;
    /** Selectable page sizes shown in the selector. */
    pageSizeOptions: number[];
    /** The total number of pages for the current length and page size. */
    get pageCount(): number;
    /** The (zero-based) index of the first item on the current page. */
    private get rangeStart();
    /** The (one-based, exclusive-friendly) index of the last item on the page. */
    private get rangeEnd();
    private get hasPrevious();
    private get hasNext();
    protected render(): import("lit-html").TemplateResult<1>;
    private renderNavButton;
    private clampIndex;
    private setPageIndex;
    private readonly goFirst;
    private readonly goPrevious;
    private readonly goNext;
    private readonly goLast;
    private readonly handlePageSizeChange;
    private emitPage;
}

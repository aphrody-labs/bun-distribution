/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { LitElement, type TemplateResult } from "lit";
/** Sort direction for a data table column. `''` means unsorted. */
export type TableSortDirection = "asc" | "desc" | "";
/**
 * Supported per-column filter input types. `text` is a free-text `contains`
 * match; `number` exposes equals/greater-than/less-than operators; `''`
 * disables column filtering for that column.
 */
export type TableFilterType = "text" | "number" | "";
/** Comparison operators usable by a column filter. */
export type TableFilterOperator = "contains" | "equals" | "startsWith" | "endsWith" | "gt" | "lt" | "gte" | "lte";
/** A single column descriptor for {@link Table}. */
export interface TableColumn {
    /** Key into each row's record used to read the cell value. */
    key: string;
    /** Human-readable header label. */
    label: string;
    /** Whether clicking the header toggles sorting on this column. */
    sortable?: boolean;
    /** Whether the column holds numeric data (right-aligned, numeric compare). */
    numeric?: boolean;
    /**
     * Filter input type for this column. When set (and the table is `filterable`)
     * a filter control is rendered in the column's filter row. `number` columns
     * gain an operator selector; `text` columns use a `contains` match.
     */
    filter?: TableFilterType;
    /** Whether the column may be resized by dragging its trailing edge. */
    resizable?: boolean;
    /** Explicit column width (CSS length, e.g. `'160px'`). Overridden by resize. */
    width?: string;
    /**
     * When true, a cell in this column may be edited inline (double-click, or
     * Enter on the focused cell). Committing emits {@link Table}'s
     * `table:cell-edit` event and updates the displayed value in place.
     */
    editable?: boolean;
}
/** A single data row: an arbitrary record keyed by column `key`. */
export type TableRow = Record<string, unknown>;
/** An active per-column filter. */
export interface TableColumnFilter {
    /** Column key the filter applies to. */
    key: string;
    /** Comparison operator. */
    operator: TableFilterOperator;
    /** Filter value (string for text, number-as-string for numeric). */
    value: string;
}
/** A single sort criterion (used for multi-column sort). */
export interface TableSortCriterion {
    key: string;
    direction: "asc" | "desc";
}
/**
 * `detail` of the `table:sort` event. The legacy single-column fields
 * (`sortKey`/`sortDirection`) reflect the primary (first) sort criterion and
 * remain for backward compatibility; `sort` carries the full multi-column
 * order.
 */
export interface TableSortEventDetail {
    sortKey: string;
    sortDirection: TableSortDirection;
    /** Full ordered list of active sort criteria. */
    sort: TableSortCriterion[];
}
/** `detail` of the `table:filter` event. */
export interface TableFilterEventDetail {
    /** Global quick-filter text (matches across all columns). */
    quickFilter: string;
    /** Active per-column filters. */
    filters: TableColumnFilter[];
}
/** `detail` of the `table:cell-edit` event. */
export interface TableCellEditEventDetail {
    /** Stable identifier of the edited row (see {@link Table.getRowId}). */
    rowId: string | number;
    /** Column key (field) that was edited. */
    field: string;
    /** The newly committed cell value (string from the inline input). */
    value: string;
    /** The full edited row record (already updated in place). */
    row: TableRow;
}
/** `detail` of the `table:page` event. */
export interface TablePageEventDetail {
    /** The (zero-based) page index. */
    pageIndex: number;
    /** The current page size. */
    pageSize: number;
    /** Total number of rows after filtering (the paginated length). */
    length: number;
}
/**
 * `detail` of the `table:selection-change` event.
 */
export interface TableSelectionEventDetail {
    /**
     * Indices (into the current display order, i.e. filtered + sorted + paged)
     * of the selected rows. Kept for backward compatibility.
     */
    selected: number[];
    /** Stable identifiers of the selected rows (see {@link Table.getRowId}). */
    selectedIds: Array<string | number>;
    /** The selected row records. */
    selectedRows: TableRow[];
}
/**
 * A Material 3 data table with Data-Grid-class features. Data-driven: supply
 * {@link columns} and {@link rows} and the element renders a real `<table>`
 * with sortable headers, per-column + global filtering, integrated pagination,
 * row selection, CSV export, and optional column resize/reorder.
 *
 * The display pipeline is: **filter → sort → paginate**. All public read
 * accessors and {@link exportCsv} respect the current filter and sort.
 *
 * Backward compatible: the original `columns`/`rows`/`sortKey`/`sortDirection`/
 * `selectable` props and the `table:sort` / `table:selection-change` events are
 * preserved. New behaviour is opt-in via flags (`filterable`, `paginated`,
 * `reorderable`).
 *
 * @fires table:sort {CustomEvent<TableSortEventDetail>} Fired when the active
 *     sort column(s) or direction changes.
 * @fires table:filter {CustomEvent<TableFilterEventDetail>} Fired when the
 *     quick filter or any column filter changes.
 * @fires table:page {CustomEvent<TablePageEventDetail>} Fired when the page
 *     index or page size changes.
 * @fires table:selection-change {CustomEvent<TableSelectionEventDetail>} Fired
 *     when the set of selected rows changes (only when `selectable`).
 * @fires table:cell-edit {CustomEvent<TableCellEditEventDetail>} Fired when an
 *     editable cell's value is committed (only for `editable` columns).
 */
export declare class Table extends LitElement {
    /** Column descriptors, in display order. */
    columns: TableColumn[];
    /** Row records. Each is read by column `key`. */
    rows: TableRow[];
    /** Key of the column currently driving the (primary) sort (`''` unsorted). */
    sortKey: string;
    /** Direction of the current (primary) sort. */
    sortDirection: TableSortDirection;
    /**
     * When true, holding Shift while clicking a sortable header appends/updates
     * that column as an additional sort criterion (multi-column sort). When
     * false, sorting is single-column (legacy behaviour) but still stable.
     */
    multiSort: boolean;
    /** When true, renders a leading checkbox column for row selection. */
    selectable: boolean;
    /** When true, renders a filter row and a global quick-filter field. */
    filterable: boolean;
    /** When true, paginates the rows and renders an integrated paginator. */
    paginated: boolean;
    /** Page size when {@link paginated}. */
    pageSize: number;
    /** Current (zero-based) page index when {@link paginated}. */
    pageIndex: number;
    /** Selectable page sizes shown in the integrated paginator selector. */
    rowsPerPageOptions: number[];
    /** When true, columns may be reordered by dragging their headers. */
    reorderable: boolean;
    /**
     * Optional accessor returning a stable identifier for a row. When provided,
     * selection survives sort/filter/paginate changes. Defaults to the row's
     * `id` field if present, otherwise the row's index in {@link rows}.
     */
    getRowId?: (row: TableRow, index: number) => string | number;
    /** Full multi-column sort order. The primary criterion mirrors sortKey. */
    private sortCriteria;
    /** Global quick-filter text. */
    private quickFilter;
    /** Active per-column filters, keyed by column key. */
    private columnFilters;
    /** Selected row identifiers (stable across sort/filter/paginate). */
    private selectedIds;
    /** Display-order override of column keys for reordering. `null` = source. */
    private columnOrder;
    /** Per-column resized widths (CSS length), keyed by column key. */
    private columnWidths;
    private resizeState;
    private dragKey;
    /**
     * The cell currently being edited, identified by its stable row id and column
     * key. `null` when no cell is in edit mode.
     */
    private editing;
    /** When true, a freshly opened editor should grab focus on next render. */
    private editorNeedsFocus;
    private memoOrderedColumns;
    private memoFilteredRows;
    private memoSortedRows;
    private memoPagedRows;
    willUpdate(changed: Map<string, unknown>): void;
    private syncingSort;
    updated(): void;
    disconnectedCallback(): void;
    /** Resolve the stable id for a source row at a given source index. */
    private rowId;
    /** The effective columns in display order (memoised; see `willUpdate`). */
    private get orderedColumns();
    private computeOrderedColumns;
    /** Rows after filter+sort+paginate (memoised; see `willUpdate`). */
    private get filteredRows();
    private computeFilteredRows;
    private matchesFilter;
    private computeSortedRows;
    /** The rows visible on the current page (memoised; see `willUpdate`). */
    private get pagedRows();
    private computePagedRows;
    /** Total pages for the current filtered length and page size. */
    get pageCount(): number;
    private compare;
    private handleHeaderClick;
    private applySort;
    private handleHeaderKeydown;
    private ariaSortFor;
    private handleQuickFilter;
    private handleColumnFilterValue;
    private handleColumnFilterOperator;
    private emitFilter;
    private clampPage;
    private setPageIndex;
    private handlePageSizeChange;
    private emitPage;
    private toggleRow;
    private toggleAll;
    /** Map a display row back to its stable id via source identity. */
    private idForDisplayRow;
    private emitSelection;
    private startResize;
    private readonly onResizeMove;
    private readonly onResizeEnd;
    private handleDragStart;
    private handleDrop;
    /** Whether a given column allows inline editing. */
    private isEditable;
    /** Whether a given display row + column is the cell currently in edit mode. */
    private isEditingCell;
    /** Enter edit mode for a display row + column (no-op if not editable). */
    private beginEdit;
    /** Leave edit mode without committing. */
    private cancelEdit;
    /**
     * Commit `value` to the cell currently in edit mode. Resolves the source row
     * by its stable id (so tri/filtre/pagination/identité stable are respected),
     * mutates it in place, emits `table:cell-edit`, and exits edit mode.
     */
    private commitEdit;
    private handleCellKeydown;
    private handleEditorKeydown;
    private handleEditorBlur;
    /**
     * The rows in current display order: filtered and sorted (but NOT paginated).
     * Useful for export and external consumers.
     */
    get displayRows(): TableRow[];
    /** Programmatically set the global quick filter. */
    setQuickFilter(value: string): void;
    /** Programmatically replace the active sort criteria. */
    setSort(criteria: TableSortCriterion[]): void;
    /** Clear all filters (quick + per-column). */
    clearFilters(): void;
    /** The currently selected row records (across all pages). */
    getSelectedRows(): TableRow[];
    /**
     * Serialise the current view (filtered + sorted, all pages) to a CSV string.
     * Honours the displayed column order. Values are CSV-escaped per RFC 4180.
     */
    toCsv(): string;
    /**
     * Export the current view to a downloaded CSV file (browser only). Respects
     * the active filter and sort. Returns the CSV string for convenience.
     *
     * @param filename Download filename (defaults to `table.csv`).
     */
    exportCsv(filename?: string): string;
    private sortOrdinal;
    private renderSortIndicator;
    private renderHeaderCell;
    private renderFilterCell;
    private renderSelectAll;
    private renderBodyRow;
    private renderPaginator;
    private renderToolbar;
    protected render(): TemplateResult<1>;
}

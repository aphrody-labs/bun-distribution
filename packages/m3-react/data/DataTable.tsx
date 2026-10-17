// SPDX-License-Identifier: Apache-2.0
/**
 * M3 DataTable: TanStack Table v9 (sorting, global filter, pagination) rendered as a semantic `<table>`
 * styled with the `--md-sys-*` tokens. With `virtual`, rows are virtualized by TanStack Virtual instead of paged.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type ColumnDef,
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type RowData,
} from "@tanstack/react-table";
import { type CSSProperties, type ReactNode, useId, useRef } from "react";

/** The features of every DataTable: sorting, column and global filtering, pagination. */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    basic: sortFn_basic,
  },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
export type DataTableFeatures = typeof dataTableFeatures;
export type DataColumn<TData extends RowData = any> = ColumnDef<DataTableFeatures, TData, any>;

/** Column helper typed for DataTable: `const col = dataColumns<Person>(); col.accessor("name", { header: "Name" })`. */
export const dataColumns = <TData extends RowData = any>() => createColumnHelper<DataTableFeatures, TData>();

export interface DataTableProps<TData extends RowData = any> {
  data: TData[];
  columns: DataColumn<TData>[];
  /** Accessible caption (also the table label). */
  caption?: ReactNode;
  /** Show a search field filtering every column. */
  searchable?: boolean;
  searchLabel?: string;
  /** Rows per page (default 25). Ignored with `virtual`. */
  pageSize?: number;
  /** Virtualize rows in a scroll container of this height (px) instead of paging. */
  virtual?: { height: number; rowHeight?: number; overscan?: number };
  /** Initial sort, e.g. `[{ id: "name", desc: false }]`. */
  initialSorting?: { id: string; desc: boolean }[];
  getRowId?: (row: TData, index: number) => string;
  onRowClick?: (row: TData) => void;
  emptyLabel?: ReactNode;
  className?: string;
}

const EMPTY: never[] = [];

const s = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    color: "var(--md-sys-color-on-surface)",
    font: "var(--md-sys-typescale-body-medium-weight, 400) var(--md-sys-typescale-body-medium-size, 14px) / var(--md-sys-typescale-body-medium-line-height, 20px) var(--md-sys-typescale-body-medium-font, inherit)",
  },
  container: {
    overflow: "auto",
    borderRadius: "var(--md-sys-shape-corner-medium, 12px)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    background: "var(--md-sys-color-surface)",
  },
  table: { width: "100%", borderCollapse: "collapse" },
  caption: {
    textAlign: "start",
    padding: "12px 16px",
    font: "var(--md-sys-typescale-title-medium-weight, 500) var(--md-sys-typescale-title-medium-size, 16px) / var(--md-sys-typescale-title-medium-line-height, 24px) var(--md-sys-typescale-title-medium-font, inherit)",
  },
  th: {
    position: "sticky",
    top: 0,
    textAlign: "start",
    padding: "0 16px",
    height: 56,
    background: "var(--md-sys-color-surface-container)",
    color: "var(--md-sys-color-on-surface-variant)",
    borderBottom: "1px solid var(--md-sys-color-outline-variant)",
    font: "var(--md-sys-typescale-title-small-weight, 500) var(--md-sys-typescale-title-small-size, 14px) / var(--md-sys-typescale-title-small-line-height, 20px) var(--md-sys-typescale-title-small-font, inherit)",
  },
  sort: {
    all: "unset",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  td: {
    padding: "0 16px",
    height: 52,
    borderBottom: "1px solid var(--md-sys-color-outline-variant)",
  },
  search: {
    alignSelf: "flex-start",
    minWidth: 240,
    height: 40,
    padding: "0 16px",
    borderRadius: "var(--md-sys-shape-corner-extra-large, 28px)",
    border: "1px solid var(--md-sys-color-outline)",
    background: "var(--md-sys-color-surface-container-high)",
    color: "inherit",
    font: "inherit",
  },
  pager: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
  },
  button: {
    height: 40,
    padding: "0 16px",
    borderRadius: "var(--md-sys-shape-corner-full, 20px)",
    border: "1px solid var(--md-sys-color-outline)",
    background: "transparent",
    color: "var(--md-sys-color-primary)",
    font: "inherit",
    cursor: "pointer",
  },
} satisfies Record<string, CSSProperties>;

const SORT_MARK = { asc: " ▲", desc: " ▼" } as const;

export function DataTable<TData extends RowData = any>(props: DataTableProps<TData>) {
  const {
    data,
    columns,
    caption,
    searchable = false,
    searchLabel = "Search",
    pageSize = 25,
    virtual,
    initialSorting = EMPTY,
    getRowId,
    onRowClick,
    emptyLabel = "No data",
    className,
  } = props;
  const searchId = useId();
  const table = useTable<DataTableFeatures, TData>({
    features: dataTableFeatures,
    data,
    columns,
    getRowId,
    globalFilterFn: "includesString",
    initialState: {
      sorting: initialSorting,
      pagination: {
        pageIndex: 0,
        pageSize: virtual ? Number.MAX_SAFE_INTEGER : pageSize,
      },
    },
  });
  const rows = table.getRowModel().rows;
  const columnCount = table.getAllLeafColumns().length;
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = virtual?.rowHeight ?? 52;
  // oxlint-disable-next-line react/incompatible-library -- TanStack Virtual renvoie des fonctions non mémoïsables (getVirtualItems, measureElement) : le compilateur React doit l'ignorer
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    getItemKey: index => rows[index]?.id ?? index,
    overscan: virtual?.overscan ?? 8,
    initialRect: virtual ? { width: 0, height: virtual.height } : undefined,
  });

  const items = virtual ? virtualizer.getVirtualItems() : undefined;
  const visible = items ? items.map(item => rows[item.index]!) : rows;
  const padTop = items?.[0]?.start ?? 0;
  const padBottom = items?.length ? virtualizer.getTotalSize() - items[items.length - 1]!.end : 0;

  return (
    <div className={className} style={s.root} data-m3-data-table="">
      {searchable && (
        <input
          id={searchId}
          type="search"
          aria-label={searchLabel}
          placeholder={searchLabel}
          style={s.search}
          value={String(table.store.state.globalFilter ?? "")}
          onChange={event => table.setGlobalFilter(event.currentTarget.value)}
        />
      )}
      <div ref={scrollRef} style={virtual ? { ...s.container, height: virtual.height } : s.container} data-m3-scroll="">
        <table style={s.table} aria-rowcount={virtual ? rows.length + 1 : undefined}>
          {caption && <caption style={s.caption}>{caption}</caption>}
          <thead>
            {table.getHeaderGroups().map(group => (
              <tr key={group.id}>
                {group.headers.map(header => {
                  const sorted = header.column.getIsSorted();
                  const label = header.isPlaceholder ? null : <table.FlexRender header={header} />;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      colSpan={header.colSpan}
                      style={s.th}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    >
                      {header.column.getCanSort() ? (
                        <button type="button" style={s.sort} onClick={header.column.getToggleSortingHandler()}>
                          {label}
                          {sorted ? SORT_MARK[sorted] : null}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {padTop > 0 && (
              <tr aria-hidden="true">
                {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- cellule de remplissage de virtualisation (ligne aria-hidden, sans contenu ni contrôle) */}
                <td colSpan={columnCount} style={{ height: padTop, padding: 0 }} />
              </tr>
            )}
            {visible.map(row => (
              <tr
                key={row.id}
                data-row-id={row.id}
                onClick={onRowClick ? () => onRowClick(row.original as TData) : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {row.getAllCells().map(cell => (
                  // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- cellule de données (td), pas un contrôle : son contenu est rendu par FlexRender
                  <td key={cell.id} style={s.td}>
                    <table.FlexRender cell={cell} />
                  </td>
                ))}
              </tr>
            ))}
            {padBottom > 0 && (
              <tr aria-hidden="true">
                {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- cellule de remplissage de virtualisation (ligne aria-hidden, sans contenu ni contrôle) */}
                <td colSpan={columnCount} style={{ height: padBottom, padding: 0 }} />
              </tr>
            )}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columnCount} style={{ ...s.td, textAlign: "center" }}>
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!virtual && table.getPageCount() > 1 && (
        <nav style={s.pager} aria-label="Pagination">
          <button
            type="button"
            style={s.button}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            Previous
          </button>
          <span>
            {table.store.state.pagination.pageIndex + 1} / {table.getPageCount()}
          </span>
          <button type="button" style={s.button} disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
            Next
          </button>
        </nav>
      )}
    </div>
  );
}

// SPDX-License-Identifier: Apache-2.0
/**
 * @fileoverview TanStack Table adapter for @aphrody/m3-react & @aphrody/material-web.
 * Connects TanStack headless table state (sorting, pagination, column models)
 * with the Material Design 3 <md-table> custom element.
 */

import type { TableColumn, TableSortCriterion } from '@aphrody/material-web/table/internal/table.js';

/**
 * Minimal interface representing a TanStack Column Definition.
 */
export interface TanStackColumnLike<_TData = unknown> {
  id?: string;
  accessorKey?: string;
  header?: string | ((...args: unknown[]) => unknown);
  enableSorting?: boolean;
  meta?: {
    numeric?: boolean;
    filter?: 'text' | 'number' | '';
    resizable?: boolean;
    width?: string;
  };
}

/**
 * Maps TanStack Column Definitions to Aphrody Material 3 TableColumn descriptors.
 */
export function mapTanStackColumnsToM3<TData = unknown>(
  columns: TanStackColumnLike<TData>[]
): TableColumn[] {
  return columns.map((col) => {
    const key = col.id || col.accessorKey || '';
    const label = typeof col.header === 'string' ? col.header : key;
    return {
      key,
      label,
      sortable: col.enableSorting !== false,
      numeric: col.meta?.numeric ?? false,
      filter: col.meta?.filter ?? '',
      resizable: col.meta?.resizable ?? false,
      width: col.meta?.width,
    };
  });
}

/**
 * Maps M3 Table Sort Criteria to TanStack SortingState format.
 */
export function mapM3SortToTanStack(
  sortCriteria: TableSortCriterion[]
): Array<{ id: string; desc: boolean }> {
  return sortCriteria.map((item) => ({
    id: item.key,
    desc: item.direction === 'desc',
  }));
}

/**
 * Maps TanStack SortingState to M3 TableSortCriterion format.
 */
export function mapTanStackSortToM3(
  sortingState: Array<{ id: string; desc: boolean }>
): TableSortCriterion[] {
  return sortingState.map((item) => ({
    key: item.id,
    direction: item.desc ? 'desc' : 'asc',
  }));
}

import { useMemo } from "react";
import {
  columnResizingFeature,
  columnSizingFeature,
  tableFeatures,
  useTable as useReactTableV9,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table";
import type { File } from "@aphrody/drive-client";

import { formatBytes, formatRelativeTime } from "../../utils";

export const ROW_HEIGHT = 36;
export const TABLE_PADDING_X = 16;
export const TABLE_PADDING_Y = 12;
export const TABLE_HEADER_HEIGHT = 32;

export const listTableFeatures = tableFeatures({
  columnSizingFeature,
  columnResizingFeature,
});

// Column definitions for the list view
export function useTable(files: File[]) {
  // Memoize files array reference to prevent unnecessary table updates
  const filesKey = JSON.stringify(files.map((f) => f.id));
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- la référence ne change que si la liste d'identifiants change ; files est volontairement absent
  const stableFiles = useMemo(() => files, [filesKey]);

  const columns = useMemo<ColumnDef<typeof listTableFeatures, File>[]>(
    () => [
      {
        id: "name",
        header: "Nom",
        minSize: 200,
        size: 320,
        maxSize: 800,
        accessorFn: (row) => row.name,
      },
      {
        id: "size",
        header: "Taille",
        size: 100,
        minSize: 70,
        maxSize: 140,
        accessorFn: (row) => (row.size > 0 ? formatBytes(row.size) : "—"),
      },
      {
        id: "modified",
        header: "Modifié",
        size: 140,
        minSize: 90,
        maxSize: 200,
        accessorFn: (row) => formatRelativeTime(row.modified_at),
      },
      {
        id: "type",
        header: "Type",
        size: 90,
        minSize: 70,
        maxSize: 130,
        accessorFn: (row) =>
          row.kind === "File" ? row.extension?.toUpperCase() || "—" : "Dossier",
      },
    ],
    [],
  );

  const table = useReactTableV9({
    features: listTableFeatures,
    data: stableFiles,
    columns,
    defaultColumn: {
      minSize: 60,
      maxSize: 500,
    },
    columnResizeMode: "onChange",
    getRowId: (row) => row.id,
  });

  return { table, columns };
}

export type { ColumnSizingState };

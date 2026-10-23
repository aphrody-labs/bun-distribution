// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { mapTanStackColumnsToM3, mapM3SortToTanStack, mapTanStackSortToM3 } from "../src/adapters/tanstack";

describe("TanStack Table Adapter for M3", () => {
  it("maps TanStack column definitions to M3 table columns", () => {
    const tanstackCols = [
      { id: "name", header: "Dessert Name", enableSorting: true },
      {
        id: "calories",
        header: "Calories",
        enableSorting: false,
        meta: { numeric: true },
      },
      {
        accessorKey: "fat",
        header: "Fat (g)",
        meta: { filter: "number" as const, width: "120px" },
      },
    ];

    const m3Cols = mapTanStackColumnsToM3(tanstackCols);
    expect(m3Cols).toHaveLength(3);
    expect(m3Cols[0]).toEqual({
      key: "name",
      label: "Dessert Name",
      sortable: true,
      numeric: false,
      filter: "",
      resizable: false,
      width: undefined,
    });
    expect(m3Cols[1].numeric).toBe(true);
    expect(m3Cols[1].sortable).toBe(false);
    expect(m3Cols[2].filter).toBe("number");
    expect(m3Cols[2].width).toBe("120px");
  });

  it("bi-directionally converts sorting state", () => {
    const tanstackSort = [
      { id: "calories", desc: true },
      { id: "name", desc: false },
    ];
    const m3Sort = mapTanStackSortToM3(tanstackSort);

    expect(m3Sort).toEqual([
      { key: "calories", direction: "desc" },
      { key: "name", direction: "asc" },
    ]);

    const backToTanstack = mapM3SortToTanStack(m3Sort);
    expect(backToTanstack).toEqual(tanstackSort);
  });
});

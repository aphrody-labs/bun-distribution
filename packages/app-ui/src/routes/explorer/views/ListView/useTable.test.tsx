// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import type { File } from "@aphrody/drive-client";
import { renderToStaticMarkup } from "react-dom/server";
import { useTable } from "./useTable";

const files = [
  {
    id: "one",
    name: "one.txt",
    kind: "File",
    extension: "txt",
    size: 42,
    modified_at: "2026-10-02T00:00:00Z",
  },
  {
    id: "two",
    name: "two",
    kind: "Directory",
    extension: null,
    size: 0,
    modified_at: "2026-10-02T00:00:00Z",
  },
] as File[];

function Probe() {
  const { table } = useTable(files);
  const rows = table.getRowModel().rows;
  return (
    <output>
      {rows.map((row) => `${row.id}:${row.getAllCells().length}`).join(",")};
      {table.getHeaderGroups()[0]?.headers[0]?.column.getCanResize()
        ? "resizable"
        : "fixed"}
    </output>
  );
}

test("file list uses the v9 core row and column resize features", () => {
  expect(renderToStaticMarkup(<Probe />)).toContain("one:4,two:4;resizable");
});

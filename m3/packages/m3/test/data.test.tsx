// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { DataTable, dataColumns, dataTableFeatures, VirtualList } from "../src/data.ts";
import { DataTable as ReactDataTable, VirtualList as ReactVirtualList } from "../src/react.tsx";

interface Item {
  id: string;
  name: string;
  role: string;
}

const ITEMS: Item[] = [
  { id: "1", name: "Alice", role: "Admin" },
  { id: "2", name: "Bob", role: "Developer" },
  { id: "3", name: "Charlie", role: "Designer" },
];

describe("@aphrody/m3 data components (DataTable and VirtualList)", () => {
  test("re-exports are identical across @aphrody/m3/data and @aphrody/m3/react", () => {
    expect(DataTable).toBe(ReactDataTable);
    expect(VirtualList).toBe(ReactVirtualList);
    expect(typeof dataColumns).toBe("function");
    expect(typeof dataTableFeatures).toBe("object");
  });

  test("DataTable renders semantic M3 table on the server", () => {
    const col = dataColumns<Item>();
    const columns = [
      col.accessor("name", { header: "Name" }),
      col.accessor("role", { header: "Role" }),
    ];

    const html = renderToString(
      <DataTable data={ITEMS} columns={columns} caption="Team Members" searchable />,
    );

    expect(html).toContain("<table");
    expect(html).toContain("Team Members");
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain("Charlie");
    expect(html).toContain("Admin");
    expect(html).toContain("--md-sys-color-surface");
  });

  test("VirtualList renders scroll container with list and listitems", () => {
    const html = renderToString(
      <VirtualList
        items={ITEMS}
        height={200}
        estimateSize={56}
        renderItem={(item) => <div>{item.name}</div>}
      />,
    );

    expect(html).toContain("data-m3-virtual-list");
    expect(html.match(/<ul[\s>]/g)?.length).toBe(1);
    expect(html).toMatch(/<li[\s>]/);
  });
});

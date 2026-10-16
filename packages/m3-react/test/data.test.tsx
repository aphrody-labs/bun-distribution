// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { DataTable, dataColumns, VirtualList } from "../data/index.ts";

interface Person {
  id: string;
  name: string;
  age: number;
}

const people: Person[] = Array.from({ length: 60 }, (_, i) => ({
  id: `p${i}`,
  name: `Person ${String(i).padStart(2, "0")}`,
  age: 20 + (i % 40),
}));
const col = dataColumns<Person>();
const columns = [
  col.accessor("name", { header: "Name" }),
  col.accessor("age", { header: "Age" }),
];

const cellTexts = (html: string) =>
  [...html.matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map((m) => m[1]);

describe("DataTable", () => {
  test("renders a semantic table with headers, a caption and the first page", () => {
    const html = renderToString(
      <DataTable
        data={people}
        columns={columns}
        caption="People"
        pageSize={10}
        getRowId={(p) => p.id}
      />,
    );
    expect(html).toContain("<caption");
    expect(html).toContain("People");
    expect(html).toContain('scope="col"');
    expect(html.match(/data-row-id=/g)?.length).toBe(10);
    expect(cellTexts(html)[0]).toBe("Person 00");
    expect(html).toMatch(/1(<!-- -->)? \/ (<!-- -->)?6/);
  });

  test("initial sorting orders rows and marks the header", () => {
    const html = renderToString(
      <DataTable
        data={people}
        columns={columns}
        pageSize={5}
        initialSorting={[{ id: "name", desc: true }]}
      />,
    );
    expect(cellTexts(html)[0]).toBe("Person 59");
    expect(html).toContain('aria-sort="descending"');
  });

  test("virtual mode renders a window of rows with spacers and no pager", () => {
    const html = renderToString(
      <DataTable
        data={people}
        columns={columns}
        virtual={{ height: 260, rowHeight: 52, overscan: 0 }}
      />,
    );
    const rendered = html.match(/data-row-id=/g)?.length ?? 0;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(people.length);
    expect(html).toContain('aria-rowcount="61"');
    expect(html).not.toContain('aria-label="Pagination"');
  });

  test("an empty table shows the empty label", () => {
    expect(
      renderToString(
        <DataTable data={[]} columns={columns} emptyLabel="Nobody" />,
      ),
    ).toContain("Nobody");
  });

  test("clicking a header sorts, the search field filters", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        <DataTable data={people} columns={columns} searchable pageSize={100} />,
      ),
    );
    const firstName = () => container.querySelector("tbody td")?.textContent;
    expect(firstName()).toBe("Person 00");
    const sortName = container.querySelector<HTMLButtonElement>("th button")!;
    await act(async () => sortName.click());
    await act(async () => sortName.click());
    expect(firstName()).toBe("Person 59");
    const search = container.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(search, "Person 42");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelectorAll("tbody tr[data-row-id]").length).toBe(1);
    expect(firstName()).toBe("Person 42");
    await act(async () => root.unmount());
    container.remove();
  });
});

describe("VirtualList", () => {
  test("renders only the visible window of a long list as listitems", () => {
    const items = Array.from({ length: 1000 }, (_, i) => `Item ${i}`);
    const html = renderToString(
      <VirtualList
        items={items}
        height={280}
        estimateSize={56}
        overscan={2}
        renderItem={(item) => <span>{item}</span>}
      />,
    );
    const rendered = html.match(/<li[\s>]/g)?.length ?? 0;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThanOrEqual(10);
    expect(html.match(/<ul[\s>]/g)?.length).toBe(1);
    expect(html).toContain('aria-setsize="1000"');
    expect(html).toContain("Item 0");
    expect(html).not.toContain("Item 999");
  });
});

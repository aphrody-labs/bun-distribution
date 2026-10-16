// SPDX-License-Identifier: Apache-2.0
// Benchmark test for Google Drive List View
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GoogleDriveListView } from "../src/index.js";

const SPACEUI_VOCABULARY = /\b(bg|text|border)-(app|ink|sidebar|menu|accent)\b/;

function expectM3(html: string) {
  expect(html).not.toMatch(SPACEUI_VOCABULARY);
  expect(html).not.toContain("text-white");
  expect(html).not.toContain("brightness-");
}

describe("GoogleDriveListView", () => {
  const sampleItems = [
    {
      id: "1",
      name: "Quarterly Roadmap 2026",
      type: "document" as const,
      owner: "Aphrody Core",
      modifiedAt: "Hier à 14:30",
      fileSize: "1.2 MB",
      starred: true,
    },
    {
      id: "2",
      name: "Architecture & Design Guidelines",
      type: "folder" as const,
      owner: "Aphrody Core",
      modifiedAt: "3 oct. 2026",
    },
    {
      id: "3",
      name: "Financial Overview Q3",
      type: "spreadsheet" as const,
      owner: "finance@aphrody.com",
      modifiedAt: "1 oct. 2026",
      fileSize: "480 KB",
    },
  ];

  test("renders Drive filter chips, table header, and row items", () => {
    const html = renderToStaticMarkup(
      <GoogleDriveListView
        title="Mon Drive"
        items={sampleItems}
        viewMode="list"
        onViewModeChange={() => {}}
        onItemClick={() => {}}
        onItemStarToggle={() => {}}
      />,
    );

    // M3 hygiene
    expectM3(html);

    // Filter Chips
    expect(html).toContain("Type");
    expect(html).toContain("People");
    expect(html).toContain("Modified");
    expect(html).toContain("Location");

    // Title & View Switch
    expect(html).toContain("Mon Drive");
    expect(html).toContain("view_list");
    expect(html).toContain("grid_view");

    // Table Columns & Content
    expect(html).toContain("Name");
    expect(html).toContain("Owner");
    expect(html).toContain("Last modified");
    expect(html).toContain("File size");

    // Items
    expect(html).toContain("Quarterly Roadmap 2026");
    expect(html).toContain("description");
    expect(html).toContain("Architecture &amp; Design Guidelines");
    expect(html).toContain("folder");
    expect(html).toContain("Financial Overview Q3");
    expect(html).toContain("table_chart");

    // Star icon state
    expect(html).toContain("star");
  });

  test("renders grid view mode when selected", () => {
    const html = renderToStaticMarkup(
      <GoogleDriveListView title="Mon Drive" items={sampleItems} viewMode="grid" onViewModeChange={() => {}} />,
    );

    expectM3(html);
    expect(html).toContain("grid grid-cols-2");
    expect(html).toContain("Quarterly Roadmap 2026");
    expect(html).toContain("Architecture &amp; Design Guidelines");
  });
});

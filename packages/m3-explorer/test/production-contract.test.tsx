// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, mock, test } from "bun:test";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  GoogleDriveListView,
  type DriveItem,
} from "../src/GoogleDriveListView.tsx";

let root: Root | undefined;
let host: HTMLElement | undefined;
const item: DriveItem = { id: "a", name: "Production notes", type: "document" };
afterEach(() => {
  if (root) flushSync(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});
function render(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(element));
  return host;
}

describe("production explorer keyboard access", () => {
  for (const viewMode of ["list", "grid"] as const) {
    test(`${viewMode} opens with Enter and selects with Space`, () => {
      const select = mock(() => {});
      const open = mock(() => {});
      const el = render(
        <GoogleDriveListView
          items={[item]}
          selectedId="a"
          onSelect={select}
          onOpen={open}
          viewMode={viewMode}
        />,
      );
      const row = el.querySelector<HTMLElement>(
        viewMode === "list" ? "tbody tr" : '[role="button"]',
      )!;
      flushSync(() =>
        row.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        ),
      );
      expect(open).toHaveBeenCalledWith(item);
      expect(select).not.toHaveBeenCalled();
      flushSync(() =>
        row.dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", bubbles: true }),
        ),
      );
      expect(select).toHaveBeenCalledWith(item);
      expect(
        row.getAttribute(
          viewMode === "list" ? "aria-selected" : "aria-pressed",
        ),
      ).toBe("true");
    });
  }

  test("nested action keys do not activate the row and actions remain visible during keyboard focus", () => {
    const open = mock(() => {});
    const action = mock(() => {});
    const el = render(
      <GoogleDriveListView items={[item]} onOpen={open} onRowAction={action} />,
    );
    const download = el.querySelector<HTMLButtonElement>(
      '[aria-label="Download"]',
    )!;
    flushSync(() =>
      download.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(open).not.toHaveBeenCalled();
    flushSync(() => download.click());
    expect(action).toHaveBeenCalledWith(item, "download");
    expect(download.parentElement!.className).toContain(
      "group-focus-within:opacity-100",
    );
  });
});

// SPDX-License-Identifier: Apache-2.0
// Real React DOM navigation behavior; no application services, stored threads or screenshots.
// oxlint-disable-next-line no-unassigned-import -- the existing owner registers the DOM before React loads
import "../../../../scripts/test-dom";
import { afterEach, expect, test } from "bun:test";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

const { RailDrawer } = await import("./rail-drawer");
let root: Root | undefined;
let host: HTMLDivElement | undefined;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
});

function Navigation() {
  const [open, setOpen] = useState(false);
  return createElement(
    "div",
    {},
    createElement(
      "button",
      { id: "launcher", onClick: () => setOpen(true) },
      "Navigation",
    ),
    <RailDrawer open={open} onOpenChange={setOpen} label="Navigation">
      <div>
        <button id="destination">Files</button>
        <a id="last" href="#settings">
          Settings
        </a>
        <button disabled id="disabled">
          Disabled
        </button>
        <div hidden>
          <button id="hidden">Hidden</button>
        </div>
        <button aria-disabled>Unavailable</button>
        <div inert>
          <button>Inert</button>
        </div>
      </div>
    </RailDrawer>,
  );
}

async function mount(): Promise<void> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(Navigation)));
}

function control(selector: string): HTMLElement {
  const found = host?.querySelector<HTMLElement>(selector);
  if (!found) throw new Error("Missing navigation control " + selector);
  return found;
}

async function openNavigation(): Promise<void> {
  const launcher = control("#launcher");
  launcher.focus();
  await act(async () => launcher.click());
}

test("compact navigation announces its modal, skips hidden controls and traps boundary Tab keys", async () => {
  await mount();
  await openNavigation();
  const drawer = control('[role="dialog"]');
  const close = control(".app-drawer-close");
  const last = control("#last");
  expect(drawer.hidden).toBe(false);
  expect(drawer.getAttribute("aria-modal")).toBe("true");
  expect(drawer.getAttribute("aria-label")).toBe("Navigation");
  expect(document.activeElement).toBe(close);
  close.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(document.activeElement).toBe(last);
  last.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(document.activeElement).toBe(close);
  expect(document.activeElement).not.toBe(control("#disabled"));
  expect(document.activeElement).not.toBe(control("#hidden"));
});

test("Escape dismisses compact navigation and returns focus to its actual invoker", async () => {
  await mount();
  await openNavigation();
  await act(async () =>
    control(".app-drawer-close").dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(control('[role="dialog"]').hidden).toBe(true);
  expect(document.activeElement).toBe(control("#launcher"));
});

test("the visible close button and pointer scrim dismiss the same controlled navigation", async () => {
  await mount();
  await openNavigation();
  await act(async () => control(".app-drawer-close").click());
  expect(control('[role="dialog"]').hidden).toBe(true);
  expect(document.activeElement).toBe(control("#launcher"));
  await openNavigation();
  await act(async () => control(".app-drawer-dismiss").click());
  expect(control('[role="dialog"]').hidden).toBe(true);
  expect(document.activeElement).toBe(control("#launcher"));
});

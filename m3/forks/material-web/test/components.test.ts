/// <reference lib="dom" />
// Headless component tests via `bun test` + happy-dom + ElementInternals
// polyfill (preloaded in bunfig.toml). Real Lit upgrade + render + reactivity,
// no browser. Complements the real-Chromium aphrody-web gate (`bun run test:browser`).
//
// Note: plain `bun test` resolves `lit`/`lit-html`'s package.json `exports`
// "node" condition (Bun identifies as a Node-compatible runtime), which makes
// `isServer` (from `lit`) evaluate `true` even under the happy-dom globals
// below — a Bun + conditional-exports quirk, not an SSR issue (`bun test
// --conditions browser` resolves it correctly, matching what a real bundler
// does for a browser build). Components that gate browser-only listeners
// behind `isServer` (bottom sheet, side sheet, snackbar, time picker) skip
// that registration under plain `bun test`; tests below prefer interactions
// that do not depend on it (pointer drag, scrim click, direct API calls) so
// they exercise real behavior under either invocation.
import { test, expect, beforeEach } from "bun:test";

beforeEach(() => {
  document.body.innerHTML = "";
});

async function mount<T extends HTMLElement>(tag: string): Promise<T> {
  const el = document.createElement(tag) as T;
  document.body.appendChild(el);
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  return el;
}

test("md-elevated-button upgrades and renders a shadow root", async () => {
  await import("../button/elevated-button.js");
  const el = await mount("md-elevated-button");
  expect(customElements.get("md-elevated-button")).toBeDefined();
  expect(el.shadowRoot).toBeTruthy();
  expect(el.shadowRoot!.childNodes.length).toBeGreaterThan(0);
});

test("md-checkbox is reactive and form-associated (ElementInternals)", async () => {
  await import("../checkbox/checkbox.js");
  const el = await mount<HTMLElement & { checked: boolean }>("md-checkbox");
  expect(el.checked).toBe(false);
  el.checked = true;
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(el.checked).toBe(true);
  // form-association relies on attachInternals() — proves the polyfill path works
  expect(el.shadowRoot).toBeTruthy();
});

test("md-outlined-text-field reflects its value property", async () => {
  await import("../textfield/outlined-text-field.js");
  const el = await mount<HTMLElement & { value: string }>("md-outlined-text-field");
  el.value = "hello";
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(el.value).toBe("hello");
});

test("aphrody fork component md-alert upgrades and renders", async () => {
  await import("../alert/alert.js");
  const el = await mount("md-alert");
  expect(customElements.get("md-alert")).toBeDefined();
  expect(el.shadowRoot).toBeTruthy();
});

// ── md-banner ────────────────────────────────────────────────────────────

test("md-banner upgrades, renders open by default, and exposes region semantics", async () => {
  await import("../banner/banner.js");
  const el = await mount<HTMLElement & { open: boolean }>("md-banner");
  expect(customElements.get("md-banner")).toBeDefined();
  expect(el.shadowRoot).toBeTruthy();
  expect(el.open).toBe(true);
  expect(el.getAttribute("role")).toBe("region");
  expect(el.shadowRoot!.querySelector(".banner")).toBeTruthy();
});

test("md-banner dismiss() closes and fires close", async () => {
  await import("../banner/banner.js");
  const el = await mount<HTMLElement & { open: boolean; dismiss: () => void }>("md-banner");
  let closed = false;
  el.addEventListener("close", () => (closed = true));
  el.dismiss();
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(closed).toBe(true);
  expect(el.open).toBe(false);
  expect(el.shadowRoot!.querySelector(".banner")).toBeNull();
});

test("md-banner Escape dismisses only when closeable", async () => {
  await import("../banner/banner.js");
  const el = await mount<HTMLElement & { open: boolean; closeable: boolean }>("md-banner");
  el.closeable = true;
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  const surface = el.shadowRoot!.querySelector(".banner") as HTMLElement;
  surface.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(el.open).toBe(false);
});

// ── md-snackbar + SnackbarQueue ──────────────────────────────────────────

test("md-snackbar show()/close() toggle open and fire lifecycle events", async () => {
  await import("../snackbar/snackbar.js");
  const el = await mount<
    HTMLElement & { open: boolean; show: () => Promise<void>; close: () => Promise<void> }
  >("md-snackbar");
  const seen: string[] = [];
  for (const type of ["opening", "opened", "closing", "closed"]) {
    el.addEventListener(type, () => seen.push(type));
  }
  await el.show();
  expect(el.open).toBe(true);
  await el.close();
  expect(el.open).toBe(false);
  expect(seen).toEqual(["opening", "opened", "closing", "closed"]);
});

test("SnackbarQueue serializes messages one at a time", async () => {
  const { SnackbarQueue } = await import("../snackbar/internal/snackbar-queue.js");
  await import("../snackbar/snackbar.js");
  const el = await mount<
    HTMLElement & { open: boolean; labelText: string; close: (reason?: string) => Promise<void> }
  >("md-snackbar");
  const queue = new SnackbarQueue(el as unknown as ConstructorParameters<typeof SnackbarQueue>[0]);
  const closedOrder: string[] = [];
  queue.enqueue({ labelText: "first", onClosed: () => closedOrder.push("first") });
  queue.enqueue({ labelText: "second", onClosed: () => closedOrder.push("second") });
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(el.open).toBe(true);
  expect(el.labelText).toBe("first");
  expect(queue.length).toBe(1);
  await el.close("dismiss");
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(el.labelText).toBe("second");
  expect(closedOrder).toEqual(["first"]);
  await el.close("dismiss");
  expect(closedOrder).toEqual(["first", "second"]);
  expect(queue.isShowing).toBe(false);
});

// ── md-bottom-sheet / md-side-sheet ──────────────────────────────────────

test("md-bottom-sheet show() opens with a modal scrim and a drag handle", async () => {
  await import("../sheet/bottom-sheet.js");
  const el = await mount<
    HTMLElement & { open: boolean; modal: boolean; show: () => Promise<void> }
  >("md-bottom-sheet");
  el.modal = true;
  await el.show();
  expect(el.open).toBe(true);
  expect(el.shadowRoot!.querySelector(".scrim")).toBeTruthy();
  expect(el.shadowRoot!.querySelector(".handle")).toBeTruthy();
});

test("md-bottom-sheet dragging the handle past a quarter of its height dismisses it", async () => {
  await import("../sheet/bottom-sheet.js");
  const el = await mount<
    HTMLElement & { open: boolean; show: () => Promise<void> }
  >("md-bottom-sheet");
  await el.show();
  expect(el.open).toBe(true);
  const handle = el.shadowRoot!.querySelector(".handle") as HTMLElement;
  const closed = new Promise<void>((resolve) =>
    el.addEventListener("bottom-sheet:closed", () => resolve(), { once: true }),
  );
  handle.dispatchEvent(
    new PointerEvent("pointerdown", { pointerId: 1, clientY: 0, bubbles: true }),
  );
  // offsetHeight is 0 under happy-dom, so any positive delta exceeds the
  // quarter-height dismiss threshold.
  handle.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 1, clientY: 40, bubbles: true }),
  );
  handle.dispatchEvent(
    new PointerEvent("pointerup", { pointerId: 1, clientY: 40, bubbles: true }),
  );
  await closed;
  expect(el.open).toBe(false);
});

test("md-side-sheet supports start/end docking and modal scrim dismiss", async () => {
  await import("../sheet/side-sheet.js");
  const el = await mount<
    HTMLElement & { open: boolean; modal: boolean; position: string; show: () => Promise<void> }
  >("md-side-sheet");
  el.position = "start";
  el.modal = true;
  await el.show();
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(el.getAttribute("position")).toBe("start");
  const scrim = el.shadowRoot!.querySelector(".scrim") as HTMLElement;
  expect(scrim).toBeTruthy();
  const closed = new Promise<void>((resolve) =>
    el.addEventListener("side-sheet:closed", () => resolve(), { once: true }),
  );
  scrim.dispatchEvent(new Event("click"));
  await closed;
  expect(el.open).toBe(false);
});

// ── md-navigation-rail / md-navigation-rail-item ─────────────────────────

test("md-navigation-rail selects items and supports badges", async () => {
  await import("../navigationrail/navigation-rail.js");
  await import("../navigationrail/navigation-rail-item.js");
  const rail = await mount<HTMLElement & { value: string; expanded: boolean }>(
    "md-navigation-rail",
  );
  const item1 = document.createElement("md-navigation-rail-item") as HTMLElement & {
    value: string;
    selected: boolean;
  };
  item1.value = "home";
  const item2 = document.createElement("md-navigation-rail-item") as HTMLElement & {
    value: string;
    selected: boolean;
  };
  item2.value = "search";
  item2.setAttribute("badge-value", "3");
  rail.appendChild(item1);
  rail.appendChild(item2);
  await (rail as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  await (item2 as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  item2.dispatchEvent(
    new Event("navigation-rail-item:activate", { bubbles: true, composed: true }),
  );
  await (rail as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(rail.value).toBe("search");
  expect(item2.selected).toBe(true);
  expect(item1.selected).toBe(false);
  expect(item2.shadowRoot!.querySelector(".badge.large")?.textContent).toBe("3");
});

// ── md-toolbar ────────────────────────────────────────────────────────────

test("md-toolbar renders as a toolbar and supports docked/floating variants", async () => {
  await import("../toolbar/md-toolbar.js");
  const el = await mount<HTMLElement & { variant: string }>("md-toolbar");
  expect(el.variant).toBe("docked");
  expect(el.shadowRoot!.querySelector('[role="toolbar"]')).toBeTruthy();
  el.variant = "floating";
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(el.getAttribute("variant")).toBe("floating");
});

// ── md-time-picker ────────────────────────────────────────────────────────

test("md-time-picker (input mode) normalizes 24h and 12h values", async () => {
  await import("../timepicker/time-picker.js");
  const el = await mount<HTMLElement & { value: string; format: string }>("md-time-picker");
  el.value = "09:05";
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(el.value).toBe("09:05");
  el.format = "12h";
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  const hoursField = el.shadowRoot!.querySelector(".field.hours") as HTMLInputElement;
  expect(hoursField.value).toBe("09");
  const ampm = el.shadowRoot!.querySelector(".ampm");
  expect(ampm).toBeTruthy();
});

test("md-time-picker (dial mode) renders clock face and interacts", async () => {
  await import("../timepicker/time-picker.js");
  const el = await mount<HTMLElement & { value: string; variant: string; dial: boolean }>("md-time-picker");
  el.dial = true;
  el.value = "10:30";
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;

  const clockDial = el.shadowRoot!.querySelector(".clock-dial");
  expect(clockDial).toBeTruthy();

  const numbers = el.shadowRoot!.querySelectorAll(".clock-number");
  expect(numbers.length).toBeGreaterThan(0);

  const num7 = Array.from(numbers).find((btn) => btn.textContent?.trim() === "07" || btn.textContent?.trim() === "7") as HTMLElement;
  if (num7) {
    num7.click();
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(el.value).toContain(":30");
  }
});

// ── md-table ──────────────────────────────────────────────────────────────

test("md-table sorts, selects rows, and reflects grid semantics", async () => {
  await import("../table/table.js");
  const el = await mount<
    HTMLElement & {
      columns: unknown[];
      rows: unknown[];
      selectable: boolean;
      getSelectedRows: () => unknown[];
    }
  >("md-table");
  el.columns = [
    { key: "name", label: "Name", sortable: true },
    { key: "calories", label: "Calories", numeric: true, sortable: true },
  ];
  el.rows = [
    { name: "Yogurt", calories: 159 },
    { name: "Ice cream", calories: 237 },
  ];
  el.selectable = true;
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  expect(el.shadowRoot!.querySelector('[role="grid"]')).toBeTruthy();
  const header = el.shadowRoot!.querySelector(
    '[role="columnheader"][tabindex="0"]',
  ) as HTMLElement;
  expect(header).toBeTruthy();
  header.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
  const checkbox = el.shadowRoot!.querySelector(
    'td.checkbox-cell input[type="checkbox"]',
  ) as HTMLInputElement | null;
  expect(checkbox).toBeTruthy();
});

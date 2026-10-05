// SPDX-License-Identifier: Apache-2.0
// Run with --conditions browser so Lit uses the browser lifecycle under happy-dom.
import { afterEach, describe, expect, test } from "bun:test";
import { MdScaffold } from "../layout/md-scaffold.js";

const originalResizeObserver = globalThis.ResizeObserver;
const originalMatchMedia = window.matchMedia;
const originalViewTransition = Object.getOwnPropertyDescriptor(document, "startViewTransition");

afterEach(() => {
  document.body.replaceChildren();
  globalThis.ResizeObserver = originalResizeObserver;
  window.matchMedia = originalMatchMedia;
  if (originalViewTransition) {
    Object.defineProperty(document, "startViewTransition", originalViewTransition);
  } else {
    Reflect.deleteProperty(document, "startViewTransition");
  }
});

function resizeObserver() {
  const observers: Array<{ deliver(width: number): void; disconnected: boolean }> = [];
  class Observer {
    disconnected = false;
    constructor(private callback: ResizeObserverCallback) {
      observers.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      this.disconnected = true;
    }
    deliver(width: number) {
      this.callback(
        [{ contentRect: { width } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
  }
  globalThis.ResizeObserver = Observer as unknown as typeof ResizeObserver;
  return observers;
}

async function mount(): Promise<MdScaffold> {
  expect(customElements.get("md-scaffold")).toBe(MdScaffold);
  const element = document.createElement("md-scaffold") as MdScaffold;
  document.body.append(element);
  await element.updateComplete;
  return element;
}

describe("adaptive Lit scaffold production contract", () => {
  test("hides absent optional regions and reacts to assigned slot changes", async () => {
    const element = await mount();
    const top = element.shadowRoot!.querySelector<HTMLElement>(".top-bar")!;
    const bottom = element.shadowRoot!.querySelector<HTMLElement>(".bottom-bar")!;
    const fab = element.shadowRoot!.querySelector<HTMLElement>(".fab")!;
    expect(top.hidden).toBe(true);
    expect(bottom.hidden).toBe(true);
    expect(fab.hidden).toBe(true);
    for (const name of ["top-bar", "bottom-bar", "fab"]) {
      const content = document.createElement("button");
      content.slot = name;
      content.textContent = name;
      element.append(content);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;
    expect(top.hidden).toBe(false);
    expect(bottom.hidden).toBe(false);
    expect(fab.hidden).toBe(false);
    element.replaceChildren();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;
    expect(top.hidden).toBe(true);
    expect(bottom.hidden).toBe(true);
    expect(fab.hidden).toBe(true);
  });

  test("updates breakpoints without a view transition when reduced motion is preferred", async () => {
    const observers = resizeObserver();
    window.matchMedia = () => ({ matches: true }) as MediaQueryList;
    let transitions = 0;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => Promise<void>) => {
        transitions++;
        void update();
      },
    });
    const element = await mount();
    const changes: string[] = [];
    element.addEventListener("scaffold:size-class-change", (event) => {
      changes.push((event as CustomEvent<{ sizeClass: string }>).detail.sizeClass);
    });
    expect(observers.length).toBe(1);
    for (const width of [599, 600, 839, 840, 1199, 1200, 1599, 1600]) {
      observers[0]!.deliver(width);
      // eslint-disable-next-line no-await-in-loop -- Each breakpoint must render before the next resize.
      await element.updateComplete;
    }
    expect(element.getAttribute("size-class")).toBe("extra-large");
    expect(changes).toEqual(["medium", "expanded", "large", "extra-large"]);
    expect(transitions).toBe(0);
  });

  test("retains animated changes for ordinary motion and disposes observation on reconnect", async () => {
    const observers = resizeObserver();
    window.matchMedia = () => ({ matches: false }) as MediaQueryList;
    let transitions = 0;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => Promise<void>) => {
        transitions++;
        void update();
      },
    });
    const element = await mount();
    element.dir = "rtl";
    observers[0]!.deliver(1200);
    await element.updateComplete;
    expect(transitions).toBe(1);
    expect(element.dir).toBe("rtl");
    expect(element.sizeClass).toBe("large");
    element.remove();
    expect(observers[0]!.disconnected).toBe(true);
    document.body.append(element);
    await element.updateComplete;
    expect(observers.length).toBe(2);
    observers[1]!.deliver(600);
    await element.updateComplete;
    expect(element.sizeClass).toBe("medium");
    element.remove();
    expect(observers[1]!.disconnected).toBe(true);
  });
});

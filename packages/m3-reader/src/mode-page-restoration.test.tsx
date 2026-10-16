// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, expect, test } from "bun:test";
import { act, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useModePageRestoration } from "./use-mode-page-restoration";
import { useVerticalScrollSync, type ViewMode } from "./use-reader-core";

const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
environment.IS_REACT_ACT_ENVIRONMENT = true;
afterAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
});
const originalResizeObserver = globalThis.ResizeObserver;
const callbacks = new Set<ResizeObserverCallback>();
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
  globalThis.ResizeObserver = originalResizeObserver;
  callbacks.clear();
});

test("mode switches preserve scans2/10/381 through row measurements and release on user scroll", async () => {
  globalThis.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      callbacks.add(callback);
      this.callback = callback;
    }
    callback: ResizeObserverCallback;
    observe() {}
    unobserve() {}
    disconnect() {
      callbacks.delete(this.callback);
    }
  } as typeof ResizeObserver;
  for (const page of [2, 10, 381]) {
    let rowHeight = 1000;
    function Reader() {
      const [mode, setMode] = useState<ViewMode>("paged");
      const [current, setCurrent] = useState(page - 1);
      const container = useRef<HTMLDivElement>(null);
      const scroll = useRef<HTMLDivElement>(null);
      const virtualizer = useMemo(
        () =>
          ({
            scrollToIndex(index: number) {
              if (scroll.current) scroll.current.scrollTop = index * rowHeight;
            },
            getVirtualItems() {
              return Array.from({ length: 381 }, (_, index) => ({
                index,
                start: index * rowHeight,
                end: (index + 1) * rowHeight,
              }));
            },
          }) as unknown as Virtualizer<HTMLDivElement, Element>,
        [],
      );
      const restoring = useModePageRestoration(
        mode,
        current,
        scroll,
        virtualizer,
        container,
      );
      useVerticalScrollSync(mode, scroll, virtualizer, setCurrent, restoring);
      return (
        <div ref={container}>
          <output>{current + 1}</output>
          <button
            onClick={() => setMode(mode === "paged" ? "vertical" : "paged")}
          >
            mode
          </button>
          {mode === "vertical" ? (
            <div
              data-scroll
              ref={(el) => {
                scroll.current = el;
                if (el)
                  Object.defineProperty(el, "clientHeight", {
                    value: 600,
                    configurable: true,
                  });
              }}
            >
              <div />
            </div>
          ) : null}
        </div>
      );
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let mounted = true;
    cleanup.push(async () => {
      if (mounted) await act(() => root.unmount());
      host.remove();
    });
    await act(() => root.render(<Reader />));
    await act(() => host.querySelector("button")!.click());
    const scroll = host.querySelector<HTMLElement>("[data-scroll]")!;
    expect(host.querySelector("output")!.textContent).toBe(String(page));
    expect(scroll.scrollTop).toBe((page - 1) * 1000);
    rowHeight = 1600;
    await act(() => {
      for (const callback of callbacks) callback([], {} as ResizeObserver);
      scroll.dispatchEvent(new Event("scroll"));
    });
    expect(scroll.scrollTop).toBe((page - 1) * 1600);
    expect(host.querySelector("output")!.textContent).toBe(String(page));
    await act(() => host.querySelector("button")!.click());
    expect(host.querySelector("output")!.textContent).toBe(String(page));
    await act(() => host.querySelector("button")!.click());
    const nextScroll = host.querySelector<HTMLElement>("[data-scroll]")!;
    await act(() => {
      nextScroll.dispatchEvent(new Event("wheel", { bubbles: true }));
      nextScroll.scrollTop = 0;
      nextScroll.dispatchEvent(new Event("scroll"));
    });
    expect(host.querySelector("output")!.textContent).toBe("1");
    expect(callbacks.size).toBe(0);
    await act(() => root.unmount());
    mounted = false;
    host.remove();
  }
});

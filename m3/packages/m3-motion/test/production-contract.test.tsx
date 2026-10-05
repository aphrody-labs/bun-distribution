// SPDX-License-Identifier: Apache-2.0
// oxlint-disable-next-line import/no-unassigned-import -- installs browser globals before React DOM is loaded
import "@aphrody/m3-config/test/dom";
import { afterEach, describe, expect, test } from "bun:test";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  M3ContainerTransform,
  M3ContainerTransformStart,
  M3ContainerTransformEnd,
  M3Transition,
  M3FadeThrough,
  M3SharedAxis,
  M3ListStagger,
  M3ListStaggerItem,
  useM3ReducedMotion,
} from "../src/index.ts";

let root: Root | undefined;
let host: HTMLElement | undefined;
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  if (root) flushSync(() => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  window.matchMedia = originalMatchMedia;
});

function render(element: React.ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(element));
  return host;
}

function reducedPreference(initial: boolean) {
  const media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, "matches", { value: initial, writable: true });
  window.matchMedia = () => media;
  return (next: boolean) => {
    Object.defineProperty(media, "matches", { value: next, writable: true });
    flushSync(() => media.dispatchEvent(new Event("change")));
  };
}

function Probe() {
  return <output>{String(useM3ReducedMotion())}</output>;
}

const view = (expanded: boolean) => (
  <M3ContainerTransform isExpanded={expanded}>
    <M3ContainerTransformStart data-testid="start">
      <button type="button">Open</button>
    </M3ContainerTransformStart>
    <M3ContainerTransformEnd data-testid="end">
      <button type="button">Close</button>
    </M3ContainerTransformEnd>
  </M3ContainerTransform>
);

describe("production motion accessibility", () => {
  test("tracks reduced motion changes and releases its subscription on unmount", () => {
    const change = reducedPreference(false);
    const el = render(<Probe />);
    expect(el.textContent).toBe("false");
    change(true);
    expect(el.textContent).toBe("true");
    change(false);
    expect(el.textContent).toBe("false");
  });

  test("reduced motion renders navigation and stagger contents in their final visible state", () => {
    reducedPreference(true);
    const el = render(
      <>
        <M3Transition stateKey="a" pattern="shared-axis-x" data-testid="transition">
          A
        </M3Transition>
        <M3FadeThrough stateKey="a" data-testid="fade">
          B
        </M3FadeThrough>
        <M3SharedAxis axis="z" data-testid="shared">
          C
        </M3SharedAxis>
        <M3ListStagger>
          <M3ListStaggerItem data-testid="item">D</M3ListStaggerItem>
        </M3ListStagger>
      </>,
    );
    for (const box of el.querySelectorAll<HTMLElement>("[data-testid]")) {
      expect(box.style.opacity).toBe("1");
      expect(box.style.transform === "none" || box.style.transform === "").toBe(true);
    }
  });

  test("inactive container content is excluded from keyboard focus and the accessibility tree", () => {
    reducedPreference(true);
    const el = render(view(false));
    expect(el.querySelector('[data-testid="end"]')!.hasAttribute("inert")).toBe(true);
    expect(el.querySelector('[data-testid="end"]')!.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector('[data-testid="start"]')!.hasAttribute("inert")).toBe(false);
    flushSync(() => root!.render(view(true)));
    expect(el.querySelector('[data-testid="start"]')!.hasAttribute("inert")).toBe(true);
    expect(el.querySelector('[data-testid="end"]')!.hasAttribute("inert")).toBe(false);
  });
});

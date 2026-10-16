// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { Loader, ProgressBar, CircularProgress } from "../src/index.ts";

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

describe("production progress accessibility", () => {
  test("reduced motion removes SVG/SMIL animation and initial-animation delays", () => {
    const media = new EventTarget() as MediaQueryList;
    Object.defineProperty(media, "matches", { value: true });
    window.matchMedia = () => media;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    flushSync(() =>
      root!.render(
        <>
          <Loader />
          <ProgressBar pending percent={0} />
          <CircularProgress
            radius={20}
            progress={50}
            initialAnimation
            initialAnimationDelay={10000}
          />
        </>,
      ),
    );
    expect(host.querySelector("animate")).toBeNull();
    expect(host.querySelector("animateTransform")).toBeNull();
    const arc = host.querySelector<SVGCircleElement>(".progress-stroke")!;
    expect(arc.style.transition).toBe("none");
    expect(Number(arc.style.strokeDashoffset)).toBeCloseTo(20 * Math.PI, 5);
    expect(host.querySelectorAll('[role="progressbar"]')).toHaveLength(3);
  });

  test("circular visual progress and accessible value use the same finite bounds", () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    for (const [value, expected] of [
      [150, 100],
      [-20, 0],
      [NaN, 0],
      [Infinity, 0],
    ]) {
      flushSync(() => root!.render(<CircularProgress radius={20} progress={value!} />));
      expect(host.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe(
        String(expected),
      );
      expect(
        Number(host.querySelector<SVGCircleElement>(".progress-stroke")!.style.strokeDashoffset),
      ).toBeCloseTo(((100 - expected!) / 100) * 40 * Math.PI, 5);
    }
  });
});

// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, mock, test } from "bun:test";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { Fade, Collapse } from "../transitions/index.ts";
import { useTransitionState } from "../transitions/use-transition-state.ts";

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

function render(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(element));
  return host;
}

describe("production transition lifecycle", () => {
  test("does not start an enter lifecycle on an already visible mount without appear", async () => {
    const entered = mock(() => {});
    function Probe() {
      const { phase } = useTransitionState(true, {
        enterTimeout: 1,
        exitTimeout: 1,
        onEntered: entered,
      });
      return <output>{phase}</output>;
    }
    const el = render(<Probe />);
    await Bun.sleep(40);
    expect(el.textContent).toBe("entered");
    expect(entered).not.toHaveBeenCalled();
  });

  test("cancels an interrupted enter without a stale completion callback", async () => {
    const entered = mock(() => {});
    const exited = mock(() => {});
    function Probe({ shown }: { shown: boolean }) {
      const { phase } = useTransitionState(shown, {
        enterTimeout: 80,
        exitTimeout: 5,
        onEntered: entered,
        onExited: exited,
      });
      return <output>{phase}</output>;
    }
    render(<Probe shown={false} />);
    flushSync(() => root!.render(<Probe shown />));
    await Bun.sleep(25);
    flushSync(() => root!.render(<Probe shown={false} />));
    await Bun.sleep(100);
    expect(entered).not.toHaveBeenCalled();
    expect(exited).toHaveBeenCalledTimes(1);
    expect(host!.textContent).toBe("exited");
  });

  test("hidden preserved children cannot receive keyboard focus", () => {
    const el = render(
      <>
        <Fade in={false}>
          <button type="button" data-testid="fade">
            Hidden
          </button>
        </Fade>
        <Collapse in={false}>
          <button type="button" data-testid="collapse">
            Hidden
          </button>
        </Collapse>
      </>,
    );
    expect(
      el.querySelector('[data-testid="fade"]')!.hasAttribute("inert"),
    ).toBe(true);
    expect(
      el.querySelector('[data-testid="fade"]')!.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      el.querySelector('[data-testid="collapse"]')!.closest("[inert]"),
    ).not.toBeNull();
  });

  test("reduced motion removes CSS duration and unmounts exits immediately", () => {
    const media = new EventTarget() as MediaQueryList;
    Object.defineProperty(media, "matches", { value: true });
    window.matchMedia = () => media;
    const el = render(
      <Fade in unmountOnExit>
        <button type="button">Visible</button>
      </Fade>,
    );
    expect(el.querySelector("button")!.style.transition).toContain("0ms");
    flushSync(() =>
      root!.render(
        <Fade in={false} unmountOnExit>
          <button type="button">Visible</button>
        </Fade>,
      ),
    );
    expect(el.querySelector("button")).toBeNull();
  });
});

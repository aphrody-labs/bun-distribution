// SPDX-License-Identifier: Apache-2.0
import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useFullscreen } from "./use-reader-core";
import { useFocusTrap } from "./use-focus-trap";

const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousAct = environment.IS_REACT_ACT_ENVIRONMENT;
environment.IS_REACT_ACT_ENVIRONMENT = true;
const originalOwner = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
const originalExit = Object.getOwnPropertyDescriptor(document, "exitFullscreen");
const originalOverflow = document.body.style.overflow;
const mounts: { root: Root; host: HTMLElement; active: boolean }[] = [];
const extraElements: HTMLElement[] = [];
let owner: Element | null = null;

async function mount(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const mounted = { root: createRoot(host), host, active: true };
  mounts.push(mounted);
  await act(() => mounted.root.render(node));
  return mounted;
}

async function unmount(mounted: (typeof mounts)[number]) {
  await act(() => mounted.root.unmount());
  mounted.active = false;
}

afterEach(async () => {
  // Each React root must finish its effect cleanup before the next root is removed.
  for (const mounted of mounts.splice(0)) {
    // eslint-disable-next-line no-await-in-loop
    if (mounted.active) await unmount(mounted);
    mounted.host.remove();
  }
  for (const element of extraElements.splice(0)) element.remove();
  if (originalOwner) Object.defineProperty(document, "fullscreenElement", originalOwner);
  else Reflect.deleteProperty(document, "fullscreenElement");
  if (originalExit) Object.defineProperty(document, "exitFullscreen", originalExit);
  else Reflect.deleteProperty(document, "exitFullscreen");
  document.body.style.overflow = originalOverflow;
  owner = null;
});
afterAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = previousAct;
});

function platform() {
  // Happy DOM has no native fullscreen. Simulate only this platform boundary;
  // the hook, React roots, ownership, DOM events and effect cleanup remain real.
  Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => owner });
  const exit = mock(async () => {
    owner = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exit });
  return exit;
}

async function fullscreenReader(id = "reader", present = true) {
  // Observation sink written by the rendered component: the test reads the hook's latest result.
  const observed: { latest?: ReturnType<typeof useFullscreen>; renders: number } = { renders: 0 };
  function Reader() {
    const ref = useRef<HTMLDivElement>(null);
    // oxlint-disable-next-line react/immutability -- harness de test : le composant publie le dernier résultat du hook pour les assertions
    observed.latest = useFullscreen(ref);
    // oxlint-disable-next-line react/immutability -- harness de test : compte des rendus observé par le test (fuite de cycle de vie)
    observed.renders++;
    return present ? <div ref={ref} data-reader={id} /> : null;
  }
  const mounted = await mount(<Reader />);
  const element = mounted.host.querySelector<HTMLDivElement>("[data-reader]");
  const request = mock(async () => {
    owner = element;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  if (element)
    Object.defineProperty(element, "requestFullscreen", { configurable: true, value: request });
  return {
    mounted,
    element,
    request,
    get latest() {
      return observed.latest!;
    },
    get renders() {
      return observed.renders;
    },
  };
}

describe("reader fullscreen ownership and lifetime", () => {
  test("another element's fullscreen is neither reported nor exited", async () => {
    const exit = platform();
    owner = document.createElement("video");
    const reader = await fullscreenReader();
    expect(reader.latest.isFullscreen).toBe(false);
    await act(async () => {
      expect(await reader.latest.toggleFullscreen()).toBe(true);
    });
    expect(reader.request).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
    expect(reader.latest.isFullscreen).toBe(true);
  });

  test("enter and exit affect only the owning reader, including external changes", async () => {
    const exit = platform();
    const first = await fullscreenReader("first");
    const second = await fullscreenReader("second");
    await act(async () => {
      await first.latest.toggleFullscreen();
    });
    expect(first.latest.isFullscreen).toBe(true);
    expect(second.latest.isFullscreen).toBe(false);
    await act(async () => {
      await first.latest.toggleFullscreen();
    });
    expect(exit).toHaveBeenCalledTimes(1);
    expect(first.latest.isFullscreen).toBe(false);
    await act(() => {
      owner = second.element;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(first.latest.isFullscreen).toBe(false);
    expect(second.latest.isFullscreen).toBe(true);
  });

  test("recognizes an already-fullscreen container at mount", async () => {
    platform();
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => document.querySelector("[data-reader]"),
    });
    const reader = await fullscreenReader();
    expect(reader.latest.isFullscreen).toBe(true);
  });

  test.each(["request", "exit"])(
    "%s rejection is returned and exposed without an unhandled promise",
    async (operation) => {
      platform();
      const reader = await fullscreenReader();
      const denied = mock(async () => {
        throw new Error("Permission denied");
      });
      if (operation === "request")
        Object.defineProperty(reader.element!, "requestFullscreen", { value: denied });
      else {
        await act(() => {
          owner = reader.element;
          document.dispatchEvent(new Event("fullscreenchange"));
        });
        Object.defineProperty(document, "exitFullscreen", { configurable: true, value: denied });
      }
      await act(async () => {
        expect(await reader.latest.toggleFullscreen()).toBe(false);
      });
      expect(reader.latest.fullscreenError?.message).toBe("Permission denied");
      expect(reader.latest.isFullscreen).toBe(operation === "exit");
    },
  );

  test("unsupported APIs and synchronous native exceptions are handled", async () => {
    platform();
    const reader = await fullscreenReader();
    Object.defineProperty(reader.element!, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
    await act(async () => {
      expect(await reader.latest.toggleFullscreen()).toBe(false);
    });
    expect(reader.latest.fullscreenError?.message).toContain("unavailable");
    Object.defineProperty(reader.element!, "requestFullscreen", {
      configurable: true,
      value: () => {
        throw "Native failure";
      },
    });
    await act(async () => {
      expect(await reader.latest.toggleFullscreen()).toBe(false);
    });
    expect(reader.latest.fullscreenError?.message).toBe("Native failure");
  });

  test("a successful newer operation ignores an older rejection", async () => {
    platform();
    const reader = await fullscreenReader();
    let reject!: (reason: Error) => void;
    Object.defineProperty(reader.element!, "requestFullscreen", {
      configurable: true,
      value: () =>
        new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    });
    let pending!: Promise<boolean>;
    await act(() => {
      pending = reader.latest.toggleFullscreen();
    });
    Object.defineProperty(reader.element!, "requestFullscreen", {
      configurable: true,
      value: reader.request,
    });
    await act(async () => {
      await reader.latest.toggleFullscreen();
    });
    await act(async () => {
      reject(new Error("Old failure"));
      expect(await pending).toBe(false);
    });
    expect(reader.latest.isFullscreen).toBe(true);
    expect(reader.latest.fullscreenError).toBeNull();
  });

  test("unmount removes listeners and ignores a late native failure", async () => {
    platform();
    const reader = await fullscreenReader();
    let reject!: (reason: Error) => void;
    Object.defineProperty(reader.element!, "requestFullscreen", {
      configurable: true,
      value: () =>
        new Promise<void>((_resolve, rejectPromise) => {
          reject = rejectPromise;
        }),
    });
    let pending!: Promise<boolean>;
    await act(() => {
      pending = reader.latest.toggleFullscreen();
    });
    await unmount(reader.mounted);
    const renders = reader.renders;
    await act(async () => {
      reject(new Error("Late failure"));
      expect(await pending).toBe(false);
      owner = reader.element;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(reader.renders).toBe(renders);
    expect(reader.latest.fullscreenError).toBeNull();
  });

  test("an absent container is a harmless no-op", async () => {
    platform();
    const reader = await fullscreenReader("absent", false);
    expect(await reader.latest.toggleFullscreen()).toBe(false);
    expect(reader.latest.fullscreenError).toBeNull();
  });
});

function tab(shiftKey = false) {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    cancelable: true,
    bubbles: true,
  });
  document.dispatchEvent(event);
  return event;
}

function Trap({
  active = true,
  onEscape,
  children,
}: {
  active?: boolean;
  onEscape?: () => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref, active, onEscape);
  return (
    <section ref={ref} data-panel="" tabIndex={-1}>
      {children}
    </section>
  );
}

const controls = (
  <>
    <button data-first="">First</button>
    <button data-last="">Last</button>
  </>
);

describe("reader modal keyboard lifecycle", () => {
  test("only the top modal handles keys and closing it restores the underlying modal", async () => {
    const lowerEscape = mock(() => {});
    const upperEscape = mock(() => {});
    const lower = await mount(<Trap onEscape={lowerEscape}>{controls}</Trap>);
    const lowerLast = lower.host.querySelector<HTMLButtonElement>("[data-last]")!;
    lowerLast.focus();
    const upper = await mount(<Trap onEscape={upperEscape}>{controls}</Trap>);
    tab(true);
    expect(document.activeElement).toBe(upper.host.querySelector("[data-last]"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(upperEscape).toHaveBeenCalledTimes(1);
    expect(lowerEscape).not.toHaveBeenCalled();
    await unmount(upper);
    expect(document.activeElement).toBe(lowerLast);
    expect(document.body.style.overflow).toBe("hidden");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(lowerEscape).toHaveBeenCalledTimes(1);
  });

  test("removing a lower modal preserves the upper scroll lock and original opener", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    extraElements.push(opener);
    opener.focus();
    document.body.style.overflow = "scroll";
    const lower = await mount(<Trap>{controls}</Trap>);
    const upper = await mount(<Trap>{controls}</Trap>);
    const focused = document.activeElement;
    await unmount(lower);
    expect(document.activeElement).toBe(focused);
    expect(document.body.style.overflow).toBe("hidden");
    await unmount(upper);
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("scroll");
  });

  test("Tab and Shift+Tab from the initial panel go to the first/last control", async () => {
    const mounted = await mount(<Trap>{controls}</Trap>);
    const panel = mounted.host.querySelector<HTMLElement>("[data-panel]")!;
    expect(document.activeElement).toBe(panel);
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(mounted.host.querySelector("[data-last]"));
    panel.focus();
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(mounted.host.querySelector("[data-first]"));
  });

  test("wraps each boundary while preserving ordinary browser tab navigation", async () => {
    const mounted = await mount(<Trap>{controls}</Trap>);
    const first = mounted.host.querySelector<HTMLButtonElement>("[data-first]")!;
    const last = mounted.host.querySelector<HTMLButtonElement>("[data-last]")!;
    first.focus();
    expect(tab().defaultPrevented).toBe(false);
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  test("skips hidden ancestors, inert regions, CSS-hidden, disabled and negative-tabindex controls", async () => {
    const mounted = await mount(
      <Trap>
        <div hidden>
          <button>Hidden ancestor</button>
        </div>
        <div style={{ display: "none" }}>
          <button>Display none</button>
        </div>
        <div style={{ visibility: "hidden" }}>
          <button>Visibility hidden</button>
        </div>
        <div inert>
          <button>Inert</button>
        </div>
        <button disabled>Disabled</button>
        <input type="hidden" />
        <button tabIndex={-2}>Negative</button>
        {controls}
      </Trap>,
    );
    tab(true);
    expect(document.activeElement).toBe(mounted.host.querySelector("[data-last]"));
    tab();
    expect(document.activeElement).toBe(mounted.host.querySelector("[data-first]"));
  });

  test("a modal with no tabbable children keeps focus on its panel", async () => {
    const mounted = await mount(
      <Trap>
        <div hidden>
          <button>Hidden</button>
        </div>
      </Trap>,
    );
    expect(tab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(mounted.host.querySelector("[data-panel]"));
    expect(tab(true).defaultPrevented).toBe(true);
  });

  test("focus lost outside the panel is recovered on the next Tab", async () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    extraElements.push(outside);
    const mounted = await mount(<Trap>{controls}</Trap>);
    outside.focus();
    expect(tab(true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(mounted.host.querySelector("[data-last]"));
  });

  test("rerender keeps focus, uses the current Escape callback and restores opener/scroll on close", async () => {
    const opener = document.createElement("button");
    document.body.append(opener);
    extraElements.push(opener);
    opener.focus();
    document.body.style.overflow = "scroll";
    const original = mock(() => {});
    const replacement = mock(() => {});
    const mounted = await mount(<Trap onEscape={original}>{controls}</Trap>);
    expect(document.body.style.overflow).toBe("hidden");
    const last = mounted.host.querySelector<HTMLButtonElement>("[data-last]")!;
    last.focus();
    await act(() => mounted.root.render(<Trap onEscape={replacement}>{controls}</Trap>));
    expect(document.activeElement).toBe(last);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(original).not.toHaveBeenCalled();
    expect(replacement).toHaveBeenCalledTimes(1);
    await act(() =>
      mounted.root.render(
        <Trap active={false} onEscape={replacement}>
          {controls}
        </Trap>,
      ),
    );
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("scroll");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(tab().defaultPrevented).toBe(false);
  });
});
